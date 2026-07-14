"use strict";

import { getItemContext, normalizeItemId } from "./src/background/context.js";
import { startTranscriptDownload, startVideoDownload } from "./src/background/downloads.js";
import { resolveBestMedia, resolveMediaCandidates } from "./src/background/media.js";
import { debugNativeHost, runNativeTranscription } from "./src/background/native.js";
import {
  clearTranscriptHistory,
  getPrunedStore,
  saveTranscriptEntry,
  updateTranscriptSettings
} from "./src/background/store.js";

const CACHE_TTL_MS = 30 * 60 * 1000;

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
        case "DOWNLOAD_VIDEO_ITEM":
        case "DOWNLOAD_PAGE_VIDEO":
          sendResponse(await handleDownloadMessage(message));
          return;
        case "TRANSCRIBE_TWEET_VIDEO":
        case "TRANSCRIBE_VIDEO_ITEM":
        case "TRANSCRIBE_PAGE_VIDEO":
          sendResponse(await handleTranscriptMessage(message));
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

async function handleTranscriptMessage(message) {
  const context = getItemContext(message);
  const now = Date.now();
  const store = await getPrunedStore();
  const cached = store.byId?.[context.itemId] || null;

  if (cached?.text && now - Number(cached.updatedAt || 0) < CACHE_TTL_MS) {
    const leftMs = CACHE_TTL_MS - (now - Number(cached.updatedAt || 0));
    if (shouldPatchMeta(cached, context)) {
      await saveTranscriptEntry({ ...cached, ...context, itemId: context.itemId }, store.settings);
    }

    return {
      ok: true,
      cached: true,
      itemId: context.itemId,
      platform: context.platform,
      text: String(cached.text || ""),
      chars: Number(cached.chars || 0),
      preview: String(cached.preview || ""),
      cacheTtlSec: Math.max(0, Math.floor(leftMs / 1000))
    };
  }

  await setGlobalBadge("TXT", "#1d9bf0");

  try {
    const result = await enqueueTranscript(context, store.settings);
    await setGlobalBadge("OK", "#00ba7c");
    clearGlobalBadgeLater(3200);
    return result;
  } catch (error) {
    await setGlobalBadge("ERR", "#f4212e");
    clearGlobalBadgeLater(4200);
    throw error;
  }
}

function enqueueTranscript(context, settings) {
  const existing = inFlightTranscripts.get(context.itemId);
  if (existing) {
    return existing;
  }

  const job = transcriptQueue.then(() => runTranscriptJob(context, settings));
  transcriptQueue = job.catch(() => undefined);

  const tracked = job.finally(() => {
    inFlightTranscripts.delete(context.itemId);
  });
  inFlightTranscripts.set(context.itemId, tracked);
  return tracked;
}

async function runTranscriptJob(context, settings) {
  const now = Date.now();
  const store = await getPrunedStore(settings);
  const cached = store.byId?.[context.itemId] || null;
  if (cached?.text && now - Number(cached.updatedAt || 0) < CACHE_TTL_MS) {
    return {
      ok: true,
      cached: true,
      itemId: context.itemId,
      platform: context.platform,
      text: String(cached.text || ""),
      chars: Number(cached.chars || 0),
      preview: String(cached.preview || ""),
      cacheTtlSec: Math.max(0, Math.floor((CACHE_TTL_MS - (now - Number(cached.updatedAt || 0))) / 1000))
    };
  }

  const candidates = await resolveMediaCandidates(context, "transcript");
  const transcriptResult = await transcribeWithFallback(context, candidates);
  const media = transcriptResult.media;
  const transcript = transcriptResult.transcript;

  await saveTranscriptEntry(
    {
      itemId: context.itemId,
      platform: context.platform,
      itemUrl: context.itemUrl,
      title: context.title,
      text: transcript.text,
      preview: transcript.preview,
      chars: transcript.charCount,
      source: media.source,
      bitrate: media.bitrate || null,
      updatedAt: now
    },
    store.settings
  );

  return {
    ok: true,
    cached: false,
    itemId: context.itemId,
    platform: context.platform,
    source: media.source,
    bitrate: media.bitrate || null,
    chars: transcript.charCount,
    preview: transcript.preview
  };
}

async function getPopupState(message) {
  const requestedId = normalizeItemId(
    message?.itemId || message?.tweetId || "",
    message?.platform,
    message?.itemUrl || message?.tweetUrl || message?.pageUrl || ""
  );
  const store = await getPrunedStore();
  const current = requestedId ? store.byId?.[requestedId] : null;
  const now = Date.now();

  return {
    ok: true,
    itemId: requestedId || null,
    cacheTtlSec: Math.floor(CACHE_TTL_MS / 1000),
    settings: store.settings,
    current: current
      ? {
          itemId: current.itemId,
          itemUrl: String(current.itemUrl || ""),
          title: String(current.title || ""),
          platform: String(current.platform || ""),
          chars: Number(current.chars || 0),
          preview: String(current.preview || ""),
          updatedAt: Number(current.updatedAt || 0),
          cachedFresh: now - Number(current.updatedAt || 0) < CACHE_TTL_MS
        }
      : null,
    history: store.history.map((item) => ({
      itemId: item.itemId,
      itemUrl: String(item.itemUrl || ""),
      title: String(item.title || ""),
      platform: String(item.platform || ""),
      chars: Number(item.chars || 0),
      preview: String(item.preview || ""),
      updatedAt: Number(item.updatedAt || 0)
    }))
  };
}

async function getTranscriptForItem(message) {
  const context = getItemContext(message);
  const store = await getPrunedStore();
  const entry = store.byId?.[context.itemId] || null;
  if (!entry?.text) {
    return { ok: false, error: "Transcript not found for this video." };
  }

  return {
    ok: true,
    itemId: context.itemId,
    itemUrl: String(entry.itemUrl || ""),
    title: String(entry.title || ""),
    platform: String(entry.platform || context.platform || ""),
    text: String(entry.text),
    chars: Number(entry.chars || 0),
    preview: String(entry.preview || ""),
    updatedAt: Number(entry.updatedAt || 0)
  };
}

async function downloadTranscriptForItem(message) {
  const context = getItemContext(message);
  const store = await getPrunedStore();
  const entry = store.byId?.[context.itemId] || null;
  if (!entry?.text) {
    return { ok: false, error: "No transcript available for this video yet." };
  }

  const downloadId = await startTranscriptDownload(context, String(entry.text), entry.title);
  return { ok: true, itemId: context.itemId, downloadId };
}

function shouldPatchMeta(entry, meta) {
  return (
    (!entry.title && !!meta.title) ||
    (!entry.itemUrl && !!meta.itemUrl) ||
    (!entry.platform && !!meta.platform)
  );
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

async function transcribeWithFallback(context, candidates) {
  let lastError = null;

  for (const media of candidates) {
    try {
      const transcript = await runNativeTranscription(context.itemId, media.url);
      return { media, transcript };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRecoverableAudioError(lastError)) {
        throw lastError;
      }
    }
  }

  if (lastError) {
    throw new Error(`No usable audio stream found across video variants. Last error: ${lastError.message}`);
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
    text.includes("invalid argument")
  );
}
