"use strict";

import {
  buildTitleSnippet,
  buildTweetText,
  deriveDriveFileIdFromItemId,
  extractDriveFileId,
  normalizeItemId,
  normalizeItemUrl,
  normalizeAuthorHandle,
  parseItemId
} from "./context.js";
import { sanitizeSentences, sanitizeTimestampMode } from "./format.js";

export const STORE_KEY_BY_ID = "transcriptsByTweetId";
export const STORE_KEY_HISTORY = "transcriptHistory";
export const STORE_KEY_SETTINGS = "transcriptSettings";
const STORE_KEY_RETENTION_MIGRATED = "transcriptRetentionWeekMigrated";

export const DEFAULT_SETTINGS = {
  maxItems: 10,
  retentionHours: 24 * 7,
  includeTitle: true,
  timestampMode: "off"
};
export const TRANSCRIPT_VALIDATION_VERSION = 1;

export async function clearTranscriptHistory() {
  await chrome.storage.local.set({
    [STORE_KEY_BY_ID]: {},
    [STORE_KEY_HISTORY]: []
  });
  return { ok: true };
}

export async function updateTranscriptSettings(message) {
  const current = await getSettings();
  const next = sanitizeSettings({
    ...current,
    ...message?.settings
  });

  await chrome.storage.local.set({
    [STORE_KEY_SETTINGS]: next,
    [STORE_KEY_RETENTION_MIGRATED]: true
  });
  await getPrunedStore(next);

  return { ok: true, settings: next };
}

export async function getSettings() {
  const data = await chrome.storage.local.get([
    STORE_KEY_SETTINGS,
    STORE_KEY_RETENTION_MIGRATED
  ]);
  const raw = data?.[STORE_KEY_SETTINGS];
  const shouldMigrateOldDefault =
    data?.[STORE_KEY_RETENTION_MIGRATED] !== true &&
    raw &&
    Number(raw.retentionHours) === 72;
  const settings = sanitizeSettings(
    shouldMigrateOldDefault ? { ...raw, retentionHours: DEFAULT_SETTINGS.retentionHours } : raw
  );

  if (data?.[STORE_KEY_RETENTION_MIGRATED] !== true) {
    await chrome.storage.local.set({
      ...(shouldMigrateOldDefault ? { [STORE_KEY_SETTINGS]: settings } : {}),
      [STORE_KEY_RETENTION_MIGRATED]: true
    });
  }

  return settings;
}

export function sanitizeSettings(raw) {
  const fallback = DEFAULT_SETTINGS;
  const maxItems = clampInt(raw?.maxItems, 1, 200, fallback.maxItems);
  const retentionHours = clampInt(raw?.retentionHours, 1, 24 * 30, fallback.retentionHours);
  const includeTitle = raw?.includeTitle === undefined ? fallback.includeTitle : raw.includeTitle === true;
  const timestampMode = sanitizeTimestampMode(raw?.timestampMode);
  return { maxItems, retentionHours, includeTitle, timestampMode };
}

export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const i = Math.floor(n);
  return Math.min(max, Math.max(min, i));
}

export async function getStore() {
  const data = await chrome.storage.local.get([STORE_KEY_BY_ID, STORE_KEY_HISTORY]);
  return {
    byId: data?.[STORE_KEY_BY_ID] && typeof data[STORE_KEY_BY_ID] === "object" ? data[STORE_KEY_BY_ID] : {},
    history: Array.isArray(data?.[STORE_KEY_HISTORY]) ? data[STORE_KEY_HISTORY] : []
  };
}

export async function getPrunedStore(settingsOverride) {
  const settings = settingsOverride || (await getSettings());
  const store = await getStore();
  const normalized = normalizeStore(store, settings);

  if (normalized.changed) {
    await chrome.storage.local.set({
      [STORE_KEY_BY_ID]: normalized.byId,
      [STORE_KEY_HISTORY]: normalized.history
    });
  }

  return {
    settings,
    byId: normalized.byId,
    history: normalized.history
  };
}

export function normalizeStore(store, settings, now = Date.now()) {
  const cutoff = now - settings.retentionHours * 60 * 60 * 1000;
  const map = new Map();

  for (const [key, value] of Object.entries(store.byId || {})) {
    const normalized = normalizeEntry({
      ...value,
      itemId: value?.itemId || key,
      tweetId: value?.tweetId || key
    }, now);
    if (!normalized) {
      continue;
    }
    map.set(normalized.itemId, normalized);
  }

  for (const item of store.history || []) {
    const normalized = normalizeEntry(item, now);
    if (!normalized) {
      continue;
    }

    const existing = map.get(normalized.itemId) || { ...normalized, text: "" };
    map.set(
      normalized.itemId,
      normalizeEntry({
        ...existing,
        ...normalized,
        text: existing.text || normalized.text || "",
        sentences: existing.sentences?.length ? existing.sentences : normalized.sentences,
        validationVersion: existing.validationVersion || normalized.validationVersion,
        expectedDurationMs: existing.expectedDurationMs || normalized.expectedDurationMs,
        audioDurationMs: existing.audioDurationMs || normalized.audioDurationMs,
        transcriptEndMs: existing.transcriptEndMs || normalized.transcriptEndMs,
        complete: existing.complete || normalized.complete
      }, now)
    );
  }

  const entries = Array.from(map.values())
    .filter(Boolean)
    .filter((entry) => Number(entry.updatedAt || 0) >= cutoff)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

  const byId = {};

  for (const entry of entries) {
    byId[entry.itemId] = entry;
  }
  const history = entries
    .slice(0, settings.maxItems)
    .map((entry) => historyEntryFromRecord(entry));

  const changed =
    Object.keys(byId).length !== Object.keys(store.byId || {}).length ||
    history.length !== (store.history || []).length ||
    hasDifference(byId, store.byId || {}) ||
    hasDifference(history, store.history || []);

  return { byId, history, changed };
}

export function normalizeEntry(entry, now = Date.now()) {
  const driveFileId = extractDriveFileId(entry?.fileId || "") || extractDriveFileId(entry?.itemUrl || entry?.tweetUrl || "");
  const itemId = normalizeItemId(
    entry?.itemId || entry?.tweetId || "",
    entry?.platform,
    entry?.itemUrl || entry?.tweetUrl || "",
    driveFileId,
    entry?.title || ""
  );
  if (!itemId) {
    return null;
  }

  const parsed = parseItemId(itemId);
  const itemUrl = normalizeItemUrl(
    parsed.platform,
    parsed.sourceId,
    entry?.itemUrl || entry?.tweetUrl || "",
    driveFileId || deriveDriveFileIdFromItemId(itemId)
  );
  const title = buildTitleSnippet(entry?.title || "");
  const tweetText = buildTweetText(entry?.tweetText || "");
  const preview = String(entry?.preview || "").slice(0, 600);

  return {
    itemId,
    itemUrl,
    fileId: driveFileId || deriveDriveFileIdFromItemId(itemId),
    platform: parsed.platform,
    title,
    tweetText,
    authorName: buildTitleSnippet(entry?.authorName || ""),
    authorHandle: normalizeAuthorHandle(entry?.authorHandle || ""),
    text: String(entry?.text || ""),
    sentences: sanitizeSentences(entry?.sentences),
    preview,
    chars: Number(entry?.chars || 0),
    source: entry?.source || null,
    bitrate: Number(entry?.bitrate || 0),
    validationVersion: Number(entry?.validationVersion || 0),
    expectedDurationMs: Number(entry?.expectedDurationMs || 0),
    audioDurationMs: Number(entry?.audioDurationMs || 0),
    transcriptEndMs: Number(entry?.transcriptEndMs || 0),
    complete: entry?.complete === true,
    updatedAt: Number(entry?.updatedAt || now)
  };
}

export function isTranscriptCacheUsable(entry, now, ttlMs) {
  const updatedAt = Number(entry?.updatedAt || 0);
  const ageMs = Number(now || Date.now()) - updatedAt;
  if (!isTranscriptVerified(entry) || !updatedAt || ageMs < 0 || ageMs >= Number(ttlMs || 0)) {
    return false;
  }
  return true;
}

export function isTranscriptVerified(entry) {
  if (!entry?.text || entry.complete !== true) {
    return false;
  }
  if (Number(entry.validationVersion || 0) < TRANSCRIPT_VALIDATION_VERSION) {
    return false;
  }
  const audioDurationMs = Number(entry.audioDurationMs || 0);
  const expectedDurationMs = Number(entry.expectedDurationMs || 0);
  if (audioDurationMs <= 0) {
    return false;
  }
  if (expectedDurationMs > 0 && audioDurationMs < expectedDurationMs * 0.98) {
    return false;
  }
  const transcriptEndMs = Number(entry.transcriptEndMs || 0);
  const charCount = Number(entry.chars || String(entry.text || "").length);
  if (audioDurationMs >= 120000) {
    if (charCount < 200) {
      return false;
    }
    const requiredEndMs = Math.max(Math.floor(audioDurationMs * 0.8), audioDurationMs - 120000);
    if (transcriptEndMs < requiredEndMs) {
      return false;
    }
  }
  return true;
}

export function historyEntryFromRecord(entry) {
  return {
    itemId: entry.itemId,
    itemUrl: String(entry.itemUrl || ""),
    platform: String(entry.platform || ""),
    title: String(entry.title || ""),
    tweetText: String(entry.tweetText || ""),
    authorName: String(entry.authorName || ""),
    authorHandle: String(entry.authorHandle || ""),
    preview: String(entry.preview || "").slice(0, 600),
    chars: Number(entry.chars || 0),
    hasTimestamps: Array.isArray(entry.sentences) && entry.sentences.length > 0,
    updatedAt: Number(entry.updatedAt || 0)
  };
}

export function hasDifference(a, b) {
  try {
    return JSON.stringify(a) !== JSON.stringify(b);
  } catch (_error) {
    return true;
  }
}

export async function saveTranscriptEntry(entry, settingsOverride) {
  const normalized = normalizeEntry(entry);
  if (!normalized) {
    return;
  }

  const settings = settingsOverride || (await getSettings());
  const store = await getStore();
  const byId = {
    ...store.byId,
    [normalized.itemId]: normalized
  };

  const history = [
    historyEntryFromRecord(normalized),
    ...(store.history || []).filter((item) => normalizeItemId(item?.itemId || item?.tweetId || "", item?.platform, item?.itemUrl || item?.tweetUrl || "") !== normalized.itemId)
  ];

  const next = normalizeStore({ byId, history }, settings);
  await chrome.storage.local.set({
    [STORE_KEY_BY_ID]: next.byId,
    [STORE_KEY_HISTORY]: next.history
  });
}
