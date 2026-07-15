"use strict";

import { getItemContext, normalizeItemId } from "./src/background/context.js";
import { startTranscriptDownload, startVideoDownload } from "./src/background/downloads.js";
import { buildSrt, buildTranscriptOutput } from "./src/background/format.js";
import { resolveBestMedia, resolveMediaCandidates } from "./src/background/media.js";
import { debugNativeHost, runNativeTranscription } from "./src/background/native.js";
import {
  clearTranscriptHistory,
  getPrunedStore,
  isTranscriptCacheUsable,
  isTranscriptVerified,
  saveTranscriptEntry,
  updateTranscriptSettings
} from "./src/background/store.js";

const HOUR_MS = 60 * 60 * 1000;

let transcriptQueue = Promise.resolve();
const inFlightTranscripts = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return;
  }

  (async () => {
    try {
      switch (message.type) {
        case "DOWNLOAD_TWEET_VIDEO":
        case "DOWNLOAD_VIDEO_ITEM":
        case "DOWNLOAD_PAGE_VIDEO":
          sendResponse(await handleDownloadMessage(message));
          return;
        case "TRANSCRIBE_TWEET_VIDEO":
        case "TRANSCRIBE_VIDEO_ITEM":
        case "TRANSCRIBE_PAGE_VIDEO":
          sendResponse(await handleTranscriptMessage(message, sender));
          return;
        case "DEBUG_NATIVE_HOST":
          sendResponse(await debugNativeHost());
          return;
        case "GET_POPUP_STATE":
          sendResponse(await getPopupState(message));
          return;
        case "GET_TRANSCRIPT_FOR_TWEET":
        case "GET_TRANSCRIPT_FOR_ITEM":
          sendResponse(await getTranscriptForItem(message));
          return;
        case "DOWNLOAD_TWEET_TRANSCRIPT":
        case "DOWNLOAD_ITEM_TRANSCRIPT":
          sendResponse(await downloadTranscriptForItem(message));
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
        code: error?.code ? String(error.code) : undefined,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  return true;
});

async function handleDownloadMessage(message) {
  const context = getItemContext(message);
  const media = await resolveBestMedia(context, "download");
  const downloadId = await startVideoDownload(context, media);

  return {
    ok: true,
    itemId: context.itemId,
    platform: context.platform,
    source: media.source,
    bitrate: media.bitrate || null,
    url: media.url,
    downloadId
  };
}

async function handleTranscriptMessage(message, sender) {
  const context = getItemContext(message);
  const tabId = sender?.tab?.id;
  const onProgress = Number.isInteger(tabId)
    ? (stage) => sendProgressToTab(tabId, context.itemId, stage)
    : null;
  const now = Date.now();
  const store = await getPrunedStore();
  const cached = store.byId?.[context.itemId] || null;
  const cacheTtlMs = getCacheTtlMs(store.settings);

  if (isTranscriptCacheUsable(cached, now, cacheTtlMs)) {
    const leftMs = cacheTtlMs - (now - Number(cached.updatedAt || 0));
    const merged = mergeEntryMeta(cached, context);
    if (shouldPatchMeta(cached, context)) {
      await saveTranscriptEntry(merged, store.settings);
    }

    return {
      ok: true,
      cached: true,
      itemId: context.itemId,
      platform: context.platform,
      text: buildTranscriptOutput(merged, store.settings),
      chars: Number(cached.chars || 0),
      preview: String(cached.preview || ""),
      cacheTtlSec: Math.max(0, Math.floor(leftMs / 1000))
    };
  }
  if (cached?.text && now - Number(cached.updatedAt || 0) < cacheTtlMs) {
    onProgress?.({ stage: "invalid-cache" });
  }

  if (!inFlightTranscripts.has(context.itemId) && inFlightTranscripts.size > 0) {
    onProgress?.({ stage: "queued" });
  }

  await badgeJobStarted();

  try {
    const result = await enqueueTranscript(context, store.settings, onProgress);
    await badgeJobFinished(true);
    return result;
  } catch (error) {
    await badgeJobFinished(false);
    throw error;
  }
}

function enqueueTranscript(context, settings, onProgress) {
  const existing = inFlightTranscripts.get(context.itemId);
  if (existing) {
    return existing;
  }

  const job = transcriptQueue.then(() => runTranscriptJob(context, settings, onProgress));
  transcriptQueue = job.catch(() => undefined);

  const tracked = job.finally(() => {
    inFlightTranscripts.delete(context.itemId);
  });
  inFlightTranscripts.set(context.itemId, tracked);
  return tracked;
}

async function runTranscriptJob(context, settings, onProgress) {
  const now = Date.now();
  const store = await getPrunedStore(settings);
  const cached = store.byId?.[context.itemId] || null;
  const cacheTtlMs = getCacheTtlMs(store.settings);
  if (isTranscriptCacheUsable(cached, now, cacheTtlMs)) {
    const merged = mergeEntryMeta(cached, context);
    return {
      ok: true,
      cached: true,
      itemId: context.itemId,
      platform: context.platform,
      text: buildTranscriptOutput(merged, store.settings),
      chars: Number(cached.chars || 0),
      preview: String(cached.preview || ""),
      cacheTtlSec: Math.max(0, Math.floor((cacheTtlMs - (now - Number(cached.updatedAt || 0))) / 1000))
    };
  }

  const candidates = await resolveMediaCandidates(context, "transcript");
  const transcriptResult = await transcribeWithFallback(context, candidates, onProgress);
  const media = transcriptResult.media;
  const transcript = transcriptResult.transcript;
  const entry = {
    itemId: context.itemId,
    platform: context.platform,
    itemUrl: context.itemUrl,
    title: context.title,
    tweetText: context.tweetText,
    authorName: context.authorName,
    authorHandle: context.authorHandle,
    text: transcript.text,
    sentences: transcript.sentences,
    preview: transcript.preview,
    chars: transcript.charCount,
    source: media.source,
    bitrate: media.bitrate || null,
    validationVersion: transcript.validationVersion,
    expectedDurationMs: transcript.expectedDurationMs,
    audioDurationMs: transcript.audioDurationMs,
    transcriptEndMs: transcript.transcriptEndMs,
    complete: transcript.complete,
    updatedAt: Date.now()
  };

  if (!isTranscriptVerified(entry)) {
    const error = new Error(
      "Native host returned an incomplete or unverified transcript. Reinstall the native host and retry."
    );
    error.code = "UNVERIFIED_TRANSCRIPT";
    throw error;
  }

  await saveTranscriptEntry(entry, store.settings);

  return {
    ok: true,
    cached: false,
    itemId: context.itemId,
    platform: context.platform,
    source: media.source,
    bitrate: media.bitrate || null,
    text: buildTranscriptOutput(
      {
        title: context.title,
        tweetText: context.tweetText,
        authorName: context.authorName,
        authorHandle: context.authorHandle,
        platform: context.platform,
        text: transcript.text,
        sentences: transcript.sentences
      },
      store.settings
    ),
    chars: transcript.charCount,
    preview: transcript.preview,
    complete: transcript.complete,
    expectedDurationMs: transcript.expectedDurationMs,
    audioDurationMs: transcript.audioDurationMs,
    transcriptEndMs: transcript.transcriptEndMs
  };
}

async function getPopupState(message) {
  const requestedId = normalizeItemId(
    message?.itemId || message?.tweetId || "",
    message?.platform,
    message?.itemUrl || message?.tweetUrl || message?.pageUrl || ""
  );
  const store = await getPrunedStore();
  const candidate = requestedId ? store.byId?.[requestedId] : null;
  const current = isTranscriptVerified(candidate) ? candidate : null;
  const now = Date.now();
  const cacheTtlMs = getCacheTtlMs(store.settings);

  return {
    ok: true,
    itemId: requestedId || null,
    cacheTtlSec: Math.floor(cacheTtlMs / 1000),
    settings: store.settings,
    current: current
      ? {
          itemId: current.itemId,
          itemUrl: String(current.itemUrl || ""),
          title: String(current.title || ""),
          tweetText: String(current.tweetText || ""),
          authorName: String(current.authorName || ""),
          authorHandle: String(current.authorHandle || ""),
          platform: String(current.platform || ""),
          chars: Number(current.chars || 0),
          preview: String(current.preview || ""),
          hasTimestamps: Array.isArray(current.sentences) && current.sentences.length > 0,
          updatedAt: Number(current.updatedAt || 0),
          cachedFresh: isTranscriptCacheUsable(current, now, cacheTtlMs)
        }
      : null,
    history: store.history.filter((item) => isTranscriptVerified(store.byId?.[item.itemId])).map((item) => ({
      itemId: item.itemId,
      itemUrl: String(item.itemUrl || ""),
      title: String(item.title || ""),
      tweetText: String(item.tweetText || ""),
      authorName: String(item.authorName || ""),
      authorHandle: String(item.authorHandle || ""),
      platform: String(item.platform || ""),
      chars: Number(item.chars || 0),
      preview: String(item.preview || ""),
      hasTimestamps:
        item.hasTimestamps === true ||
        (Array.isArray(store.byId?.[item.itemId]?.sentences) && store.byId[item.itemId].sentences.length > 0),
      updatedAt: Number(item.updatedAt || 0)
    }))
  };
}

function getCacheTtlMs(settings) {
  return Math.max(1, Number(settings?.retentionHours || 0)) * HOUR_MS;
}

async function getTranscriptForItem(message) {
  const context = getItemContext(message);
  const store = await getPrunedStore();
  const entry = store.byId?.[context.itemId] || null;
  if (!isTranscriptVerified(entry)) {
    return { ok: false, error: "A verified complete transcript is not available for this video." };
  }

  const text = renderTranscriptText(entry, store.settings, message?.format);
  if (text === null) {
    return { ok: false, error: "No timestamps are stored for this transcript. Re-run it to capture them." };
  }

  return {
    ok: true,
    itemId: context.itemId,
    itemUrl: String(entry.itemUrl || ""),
    title: String(entry.title || ""),
    tweetText: String(entry.tweetText || ""),
    authorName: String(entry.authorName || ""),
    authorHandle: String(entry.authorHandle || ""),
    platform: String(entry.platform || context.platform || ""),
    text,
    chars: Number(entry.chars || 0),
    preview: String(entry.preview || ""),
    updatedAt: Number(entry.updatedAt || 0)
  };
}

async function downloadTranscriptForItem(message) {
  const context = getItemContext(message);
  const store = await getPrunedStore();
  const entry = store.byId?.[context.itemId] || null;
  if (!isTranscriptVerified(entry)) {
    return { ok: false, error: "No verified complete transcript is available for this video yet." };
  }

  const format = String(message?.format || "default");
  const text = renderTranscriptText(entry, store.settings, format);
  if (text === null) {
    return { ok: false, error: "No timestamps are stored for this transcript. Re-run it to capture them." };
  }

  const extension = format === "srt" ? ".srt" : ".txt";
  const downloadId = await startTranscriptDownload(context, text, entry.title, extension);
  return { ok: true, itemId: context.itemId, downloadId };
}

// Returns null when the requested format needs timestamps that the entry
// does not have (older cache entries recorded before sentence storage).
function renderTranscriptText(entry, settings, format) {
  const kind = String(format || "default");
  if (kind === "srt" || kind === "timestamps") {
    if (!Array.isArray(entry.sentences) || !entry.sentences.length) {
      return null;
    }
    if (kind === "srt") {
      return buildSrt(entry.sentences);
    }
  }
  if (kind === "clean" || kind === "timestamps") {
    return buildTranscriptOutput(entry, settings, kind);
  }
  return buildTranscriptOutput(entry, settings);
}

function shouldPatchMeta(entry, meta) {
  return (
    (!entry.title && !!meta.title) ||
    (!entry.tweetText && !!meta.tweetText) ||
    (!entry.authorName && !!meta.authorName) ||
    (!entry.authorHandle && !!meta.authorHandle) ||
    (!entry.itemUrl && !!meta.itemUrl) ||
    (!entry.platform && !!meta.platform)
  );
}

function mergeEntryMeta(entry, meta) {
  const merged = { ...entry, itemId: meta.itemId || entry.itemId };
  for (const key of ["itemUrl", "title", "tweetText", "authorName", "authorHandle", "platform"]) {
    if (meta?.[key]) {
      merged[key] = meta[key];
    }
  }
  return merged;
}

function sendProgressToTab(tabId, itemId, progress) {
  const details = progress && typeof progress === "object"
    ? progress
    : { stage: String(progress || "") };
  try {
    chrome.tabs.sendMessage(
      tabId,
      {
        ...details,
        type: "XVDL_PROGRESS",
        itemId,
        stage: String(details.stage || "")
      },
      () => void chrome.runtime.lastError
    );
  } catch (_error) {
    // The tab may have navigated or closed; progress toasts are best-effort.
  }
}

// The badge is shared across all tabs; count active jobs so queued
// transcripts do not clear or overwrite each other's status.
let activeBadgeJobs = 0;

async function setGlobalBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

async function badgeJobStarted() {
  activeBadgeJobs += 1;
  await setGlobalBadge("TXT", "#1d9bf0");
}

async function badgeJobFinished(_ok) {
  activeBadgeJobs = Math.max(0, activeBadgeJobs - 1);
  if (activeBadgeJobs > 0) {
    return;
  }
  // Service-worker timers are not durable. Clear immediately once the last
  // job finishes so an OK/ERR badge cannot remain stuck after worker shutdown.
  await chrome.action.setBadgeText({ text: "" });
}

async function transcribeWithFallback(context, candidates, onProgress) {
  let lastError = null;

  for (const media of candidates) {
    try {
      const transcript = await runNativeTranscription(context.itemId, media.url, {
        onProgress,
        expectedDurationMs: media.durationMs
      });
      return { media, transcript };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (
        lastError.code === "FFMPEG_TIMEOUT" ||
        lastError.code === "DOWNLOAD_FAILED" ||
        lastError.code === "INCOMPLETE_AUDIO" ||
        (media.source.endsWith(":audio") && lastError.code === "COMMAND_FAILED")
      ) {
        continue;
      }
      if (!isRecoverableAudioError(lastError)) {
        throw lastError;
      }
    }
  }

  if (lastError) {
    const error = new Error(`No usable audio stream found across video variants. Last error: ${lastError.message}`);
    error.code = lastError.code || "NO_USABLE_AUDIO";
    throw error;
  }
  throw new Error("No video candidates available for transcript.");
}

function isRecoverableAudioError(error) {
  const text = String(error?.message || "").toLowerCase();
  if (!text) {
    return false;
  }

  return (
    text.includes("does not contain any stream") ||
    text.includes("stream specifier") ||
    text.includes("error opening output file") ||
    text.includes("invalid argument") ||
    text.includes("ffmpeg timed out")
  );
}
