"use strict";

const TWEET_ID_RE = /\b(\d{8,30})\b/;
const NATIVE_HOST_NAME = "com.xvdl.transcriber";
const CACHE_TTL_MS = 30 * 60 * 1000;
const STORE_KEY_BY_ID = "transcriptsByTweetId";
const STORE_KEY_HISTORY = "transcriptHistory";
const STORE_KEY_SETTINGS = "transcriptSettings";
const DEFAULT_SETTINGS = {
  maxItems: 10,
  retentionHours: 72
};

let transcriptQueue = Promise.resolve();
const inFlightTranscripts = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) {
    return;
  }

  (async () => {
    try {
      switch (message.type) {
        case "DOWNLOAD_TWEET_VIDEO":
          sendResponse(await handleDownloadMessage(message));
          return;
        case "TRANSCRIBE_TWEET_VIDEO":
          sendResponse(await handleTranscriptMessage(message));
          return;
        case "DEBUG_NATIVE_HOST":
          sendResponse(await debugNativeHost());
          return;
        case "GET_POPUP_STATE":
          sendResponse(await getPopupState(message));
          return;
        case "GET_TRANSCRIPT_FOR_TWEET":
          sendResponse(await getTranscriptForTweet(message));
          return;
        case "DOWNLOAD_TWEET_TRANSCRIPT":
          sendResponse(await downloadTranscriptForTweet(message));
          return;
        case "CLEAR_TRANSCRIPT_HISTORY":
          sendResponse(await clearTranscriptHistory());
          return;
        case "UPDATE_TRANSCRIPT_SETTINGS":
          sendResponse(await updateTranscriptSettings(message));
          return;
        default:
          sendResponse({ ok: false, error: `Unsupported message type: ${message.type}` });
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  return true;
});

async function handleDownloadMessage(message) {
  const tweetId = extractTweetId(message.tweetId || message.tweetUrl || "");
  if (!tweetId) {
    throw new Error("Could not detect tweet ID.");
  }

  const media = await resolveBestMp4(tweetId);
  const downloadId = await startVideoDownload(tweetId, media);

  return {
    ok: true,
    tweetId,
    source: media.source,
    bitrate: media.bitrate || null,
    url: media.url,
    downloadId
  };
}

async function handleTranscriptMessage(message) {
  const tweetId = extractTweetId(message.tweetId || message.tweetUrl || "");
  if (!tweetId) {
    throw new Error("Could not detect tweet ID.");
  }

  const meta = extractTweetMeta(message, tweetId);
  const now = Date.now();
  const store = await getPrunedStore();
  const cached = store.byId?.[tweetId] || null;

  if (cached && now - Number(cached.updatedAt || 0) < CACHE_TTL_MS) {
    const leftMs = CACHE_TTL_MS - (now - Number(cached.updatedAt || 0));
    if (shouldPatchMeta(cached, meta)) {
      await saveTranscriptEntry({ ...cached, ...meta, tweetId }, store.settings);
    }

    return {
      ok: true,
      cached: true,
      tweetId,
      chars: Number(cached.chars || 0),
      preview: String(cached.preview || ""),
      cacheTtlSec: Math.max(0, Math.floor(leftMs / 1000))
    };
  }

  await setGlobalBadge("TXT", "#1d9bf0");

  try {
    const result = await enqueueTranscript(tweetId, meta, store.settings);
    await setGlobalBadge("OK", "#00ba7c");
    clearGlobalBadgeLater(3200);
    return result;
  } catch (error) {
    await setGlobalBadge("ERR", "#f4212e");
    clearGlobalBadgeLater(4200);
    throw error;
  }
}

function enqueueTranscript(tweetId, meta, settings) {
  const existing = inFlightTranscripts.get(tweetId);
  if (existing) {
    return existing;
  }

  const job = transcriptQueue.then(() => runTranscriptJob(tweetId, meta, settings));
  transcriptQueue = job.catch(() => undefined);

  const tracked = job.finally(() => {
    inFlightTranscripts.delete(tweetId);
  });
  inFlightTranscripts.set(tweetId, tracked);
  return tracked;
}

async function runTranscriptJob(tweetId, meta, settings) {
  const now = Date.now();
  const store = await getPrunedStore(settings);
  const cached = store.byId?.[tweetId] || null;
  if (cached && now - Number(cached.updatedAt || 0) < CACHE_TTL_MS) {
    return {
      ok: true,
      cached: true,
      tweetId,
      chars: Number(cached.chars || 0),
      preview: String(cached.preview || ""),
      cacheTtlSec: Math.max(0, Math.floor((CACHE_TTL_MS - (now - Number(cached.updatedAt || 0))) / 1000))
    };
  }

  const media = await resolveBestMp4(tweetId);
  const transcript = await runNativeTranscription(tweetId, media.url);

  await saveTranscriptEntry(
    {
      tweetId,
      text: transcript.text,
      preview: transcript.preview,
      chars: transcript.charCount,
      source: media.source,
      bitrate: media.bitrate || null,
      updatedAt: now,
      tweetUrl: meta.tweetUrl,
      title: meta.title
    },
    store.settings
  );

  return {
    ok: true,
    cached: false,
    tweetId,
    source: media.source,
    bitrate: media.bitrate || null,
    chars: transcript.charCount,
    preview: transcript.preview
  };
}

async function getPopupState(message) {
  const tweetId = extractTweetId(message?.tweetId || "");
  const store = await getPrunedStore();
  const current = tweetId ? store.byId?.[tweetId] : null;
  const now = Date.now();

  return {
    ok: true,
    tweetId: tweetId || null,
    cacheTtlSec: Math.floor(CACHE_TTL_MS / 1000),
    settings: store.settings,
    current: current
      ? {
          tweetId: current.tweetId,
          title: String(current.title || ""),
          tweetUrl: String(current.tweetUrl || makeTweetUrl(current.tweetId)),
          chars: Number(current.chars || 0),
          preview: String(current.preview || ""),
          updatedAt: Number(current.updatedAt || 0),
          cachedFresh: now - Number(current.updatedAt || 0) < CACHE_TTL_MS
        }
      : null,
    history: store.history.map((item) => ({
      tweetId: item.tweetId,
      title: String(item.title || ""),
      tweetUrl: String(item.tweetUrl || makeTweetUrl(item.tweetId)),
      chars: Number(item.chars || 0),
      preview: String(item.preview || ""),
      updatedAt: Number(item.updatedAt || 0)
    }))
  };
}

async function getTranscriptForTweet(message) {
  const tweetId = extractTweetId(message?.tweetId || "");
  if (!tweetId) {
    return { ok: false, error: "Could not detect tweet ID." };
  }

  const store = await getPrunedStore();
  const entry = store.byId?.[tweetId] || null;
  if (!entry?.text) {
    return { ok: false, error: "Transcript not found for this tweet." };
  }

  return {
    ok: true,
    tweetId,
    title: String(entry.title || ""),
    tweetUrl: String(entry.tweetUrl || makeTweetUrl(tweetId)),
    text: String(entry.text),
    chars: Number(entry.chars || 0),
    preview: String(entry.preview || ""),
    updatedAt: Number(entry.updatedAt || 0)
  };
}

async function downloadTranscriptForTweet(message) {
  const tweetId = extractTweetId(message?.tweetId || "");
  if (!tweetId) {
    return { ok: false, error: "Could not detect tweet ID." };
  }

  const store = await getPrunedStore();
  const entry = store.byId?.[tweetId] || null;
  if (!entry?.text) {
    return { ok: false, error: "No transcript available for this tweet yet." };
  }

  const downloadId = await startTranscriptDownload(tweetId, String(entry.text));
  return { ok: true, tweetId, downloadId };
}

async function clearTranscriptHistory() {
  await chrome.storage.local.set({
    [STORE_KEY_BY_ID]: {},
    [STORE_KEY_HISTORY]: []
  });
  return { ok: true };
}

async function updateTranscriptSettings(message) {
  const current = await getSettings();
  const next = sanitizeSettings({
    ...current,
    ...message?.settings
  });

  await chrome.storage.local.set({ [STORE_KEY_SETTINGS]: next });
  await getPrunedStore(next);

  return { ok: true, settings: next };
}

function extractTweetId(input) {
  const text = String(input || "");
  const statusMatch = text.match(/status\/(\d{8,30})/);
  if (statusMatch) {
    return statusMatch[1];
  }
  const rawMatch = text.match(TWEET_ID_RE);
  return rawMatch ? rawMatch[1] : null;
}

function makeTweetUrl(tweetId) {
  return `https://x.com/i/web/status/${tweetId}`;
}

function extractTweetMeta(message, tweetId) {
  const title = buildTitleSnippet(message?.tweetText || message?.title || "");
  const urlFromInput = String(message?.tweetUrl || "");
  const parsedId = extractTweetId(urlFromInput);
  const normalizedId = parsedId || tweetId;

  return {
    title,
    tweetUrl: makeTweetUrl(normalizedId)
  };
}

function buildTitleSnippet(text) {
  const normalized = String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized.slice(0, 180);
}

function shouldPatchMeta(entry, meta) {
  return (!entry.title && !!meta.title) || (!entry.tweetUrl && !!meta.tweetUrl);
}

async function startVideoDownload(tweetId, media) {
  const filename = `x_${tweetId}_${media.bitrate || "best"}.mp4`;
  return chrome.downloads.download({
    url: media.url,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });
}

async function startTranscriptDownload(tweetId, text) {
  const filename = `x_${tweetId}_transcript.txt`;
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  return chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });
}

async function setGlobalBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

function clearGlobalBadgeLater(ms) {
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
  }, ms);
}

async function runNativeTranscription(tweetId, mp4Url) {
  const response = await sendNativeMessage({
    type: "transcribe",
    tweetId,
    mp4Url,
    copyToClipboard: true
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Native transcriber failed.");
  }

  return {
    text: String(response.transcript || ""),
    charCount: Number(response.charCount || 0),
    preview: String(response.preview || "")
  };
}

async function debugNativeHost() {
  try {
    const ping = await sendNativeMessage({ type: "ping" });
    return {
      ok: true,
      extensionId: chrome.runtime.id,
      nativeHost: NATIVE_HOST_NAME,
      ping
    };
  } catch (error) {
    return {
      ok: false,
      extensionId: chrome.runtime.id,
      nativeHost: NATIVE_HOST_NAME,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function sendNativeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            [
              "Native host is unavailable.",
              `Extension ID: ${chrome.runtime.id}.`,
              "Run setup from the project folder:",
              `./scripts/install_native_host.sh ${chrome.runtime.id}`,
              chrome.runtime.lastError.message
            ].join(" ")
          )
        );
        return;
      }

      resolve(response);
    });
  });
}

async function resolveBestMp4(tweetId) {
  const errors = [];

  try {
    return await getFromSyndication(tweetId);
  } catch (error) {
    errors.push(`syndication: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`No downloadable MP4 found (${errors.join("; ")}).`);
}

async function getFromSyndication(tweetId) {
  const url = new URL("https://cdn.syndication.twimg.com/tweet-result");
  url.searchParams.set("id", tweetId);
  url.searchParams.set("token", "x");

  const res = await fetch(url.toString(), {
    method: "GET",
    credentials: "omit"
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const payload = await res.json();
  const variants = collectMp4Variants(payload);
  if (!variants.length) {
    throw new Error("no MP4 variants in response");
  }

  variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const best = variants[0];
  return {
    source: best.source || "cdn.syndication",
    url: best.url,
    bitrate: best.bitrate || 0
  };
}

function collectMp4Variants(payload) {
  const seen = new Set();
  const result = [];

  const push = (url, bitrate, source) => {
    if (typeof url !== "string" || !url.includes(".mp4")) {
      return;
    }
    if (seen.has(url)) {
      return;
    }
    seen.add(url);
    result.push({
      url,
      bitrate: Number.isFinite(Number(bitrate)) ? Number(bitrate) : 0,
      source: source || "cdn.syndication"
    });
  };

  const collectFromVariants = (variants, source) => {
    if (!Array.isArray(variants)) {
      return;
    }
    for (const variant of variants) {
      if (!variant || variant.content_type !== "video/mp4") {
        continue;
      }
      push(variant.url, variant.bitrate, source);
    }
  };

  const collectFromMediaDetails = (mediaDetails, source) => {
    if (!Array.isArray(mediaDetails)) {
      return;
    }
    for (const media of mediaDetails) {
      collectFromVariants(media?.video_info?.variants, source);
    }
  };

  const collectFromTweetNode = (node, source) => {
    if (!node || typeof node !== "object") {
      return;
    }
    collectFromMediaDetails(node.mediaDetails, source);
    collectFromVariants(node?.video?.variants, source);
  };

  collectFromTweetNode(payload, "cdn.syndication");
  collectFromTweetNode(payload?.quoted_tweet, "cdn.syndication:quoted");
  collectFromTweetNode(payload?.retweeted_tweet, "cdn.syndication:retweeted");

  if (!result.length) {
    walkForVideoInfo(payload, collectFromVariants, collectFromMediaDetails);
  }

  return result;

  function walkForVideoInfo(node, addVariants, addMediaDetails, depth = 0) {
    if (!node || depth > 6) {
      return;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 30); i += 1) {
        walkForVideoInfo(node[i], addVariants, addMediaDetails, depth + 1);
      }
      return;
    }

    if (typeof node !== "object") {
      return;
    }

    addMediaDetails(node.mediaDetails, "cdn.syndication:nested");
    addVariants(node?.video_info?.variants, "cdn.syndication:nested");
    addVariants(node?.video?.variants, "cdn.syndication:nested");

    for (const [key, value] of Object.entries(node)) {
      if (key === "entities" || key === "binding_values") {
        continue;
      }
      walkForVideoInfo(value, addVariants, addMediaDetails, depth + 1);
    }
  }
}

async function getSettings() {
  const data = await chrome.storage.local.get([STORE_KEY_SETTINGS]);
  return sanitizeSettings(data?.[STORE_KEY_SETTINGS]);
}

function sanitizeSettings(raw) {
  const fallback = DEFAULT_SETTINGS;
  const maxItems = clampInt(raw?.maxItems, 1, 200, fallback.maxItems);
  const retentionHours = clampInt(raw?.retentionHours, 1, 24 * 30, fallback.retentionHours);
  return { maxItems, retentionHours };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const i = Math.floor(n);
  return Math.min(max, Math.max(min, i));
}

async function getStore() {
  const data = await chrome.storage.local.get([STORE_KEY_BY_ID, STORE_KEY_HISTORY]);
  return {
    byId: data?.[STORE_KEY_BY_ID] && typeof data[STORE_KEY_BY_ID] === "object" ? data[STORE_KEY_BY_ID] : {},
    history: Array.isArray(data?.[STORE_KEY_HISTORY]) ? data[STORE_KEY_HISTORY] : []
  };
}

async function getPrunedStore(settingsOverride) {
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

function normalizeStore(store, settings) {
  const cutoff = Date.now() - settings.retentionHours * 60 * 60 * 1000;
  const map = new Map();

  for (const [key, value] of Object.entries(store.byId || {})) {
    const id = extractTweetId(key) || extractTweetId(value?.tweetId || "");
    if (!id) {
      continue;
    }

    const normalized = normalizeEntry({ ...value, tweetId: id });
    map.set(id, normalized);
  }

  for (const item of store.history || []) {
    const id = extractTweetId(item?.tweetId || "");
    if (!id) {
      continue;
    }

    const existing = map.get(id) || { tweetId: id, text: "" };
    map.set(
      id,
      normalizeEntry({
        ...existing,
        ...item,
        tweetId: id,
        text: existing.text || ""
      })
    );
  }

  const entries = Array.from(map.values())
    .filter((entry) => Number(entry.updatedAt || 0) >= cutoff)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, settings.maxItems);

  const byId = {};
  const history = [];

  for (const entry of entries) {
    byId[entry.tweetId] = entry;
    history.push(historyEntryFromRecord(entry));
  }

  const changed =
    Object.keys(byId).length !== Object.keys(store.byId || {}).length ||
    history.length !== (store.history || []).length ||
    hasDifference(byId, store.byId || {}) ||
    hasDifference(history, store.history || []);

  return { byId, history, changed };
}

function normalizeEntry(entry) {
  const tweetId = extractTweetId(entry?.tweetId || "") || "";
  const tweetUrl = String(entry?.tweetUrl || makeTweetUrl(tweetId));
  const title = buildTitleSnippet(entry?.title || "");
  const preview = String(entry?.preview || "").slice(0, 600);

  return {
    tweetId,
    tweetUrl,
    title,
    text: String(entry?.text || ""),
    preview,
    chars: Number(entry?.chars || 0),
    source: entry?.source || null,
    bitrate: Number(entry?.bitrate || 0),
    updatedAt: Number(entry?.updatedAt || Date.now())
  };
}

function historyEntryFromRecord(entry) {
  return {
    tweetId: entry.tweetId,
    tweetUrl: String(entry.tweetUrl || makeTweetUrl(entry.tweetId)),
    title: String(entry.title || ""),
    preview: String(entry.preview || "").slice(0, 600),
    chars: Number(entry.chars || 0),
    updatedAt: Number(entry.updatedAt || 0)
  };
}

function hasDifference(a, b) {
  try {
    return JSON.stringify(a) !== JSON.stringify(b);
  } catch (_error) {
    return true;
  }
}

async function saveTranscriptEntry(entry, settingsOverride) {
  const tweetId = extractTweetId(entry?.tweetId || "");
  if (!tweetId) {
    return;
  }

  const settings = settingsOverride || (await getSettings());
  const store = await getStore();
  const normalized = normalizeEntry({
    ...entry,
    tweetId,
    tweetUrl: entry?.tweetUrl || makeTweetUrl(tweetId)
  });

  const byId = {
    ...store.byId,
    [tweetId]: normalized
  };

  const history = [
    historyEntryFromRecord(normalized),
    ...(store.history || []).filter((item) => extractTweetId(item?.tweetId || "") !== tweetId)
  ];

  const next = normalizeStore({ byId, history }, settings);
  await chrome.storage.local.set({
    [STORE_KEY_BY_ID]: next.byId,
    [STORE_KEY_HISTORY]: next.history
  });
}
