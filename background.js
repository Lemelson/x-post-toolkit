"use strict";

const TWEET_ID_RE = /\b(\d{8,30})\b/;
const DRIVE_FILE_PATH_RE = /\/file\/d\/([a-zA-Z0-9_-]{10,})\b/;
const DRIVE_FILE_QUERY_RE = /[?&]id=([a-zA-Z0-9_-]{10,})\b/;
const ITEM_PREFIX_X = "x:";
const ITEM_PREFIX_DRIVE = "gdrive:";
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

function getItemContext(message) {
  const rawUrl = String(message?.itemUrl || message?.tweetUrl || message?.pageUrl || "");
  const platform = detectPlatform(message);
  const driveFileId = platform === "gdrive" ? extractDriveFileId(message?.fileId || "") || extractDriveFileId(rawUrl) : "";
  const itemId = normalizeItemId(
    message?.itemId || message?.tweetId || message?.fileId || "",
    platform,
    rawUrl,
    driveFileId,
    message?.title || message?.tweetText || message?.fileName || ""
  );

  if (!itemId) {
    throw new Error("Could not detect video ID.");
  }

  const parsed = parseItemId(itemId);
  const title = buildTitleSnippet(message?.title || message?.tweetText || message?.fileName || "");

  return {
    itemId,
    platform: parsed.platform,
    sourceId: parsed.sourceId,
    fileId: driveFileId || deriveDriveFileIdFromItemId(itemId),
    itemUrl: normalizeItemUrl(parsed.platform, parsed.sourceId, rawUrl, driveFileId || deriveDriveFileIdFromItemId(itemId)),
    title,
    mediaUrl: normalizeMediaUrl(message?.mediaUrl || "")
  };
}

function detectPlatform(message) {
  const explicit = String(message?.platform || "").trim().toLowerCase();
  if (explicit === "x" || explicit === "twitter") {
    return "x";
  }
  if (explicit === "gdrive" || explicit === "drive" || explicit === "google-drive") {
    return "gdrive";
  }

  const raw = [
    message?.itemId,
    message?.tweetId,
    message?.fileId,
    message?.itemUrl,
    message?.tweetUrl,
    message?.pageUrl
  ]
    .map((value) => String(value || ""))
    .find(Boolean);

  if (extractDriveFileId(raw || "")) {
    return "gdrive";
  }
  return "x";
}

function normalizeItemId(input, platformHint, rawUrl, driveFileIdHint, titleHint) {
  const text = String(input || "").trim();
  if (!text && !rawUrl) {
    return null;
  }

  if (text.startsWith(ITEM_PREFIX_X) || text.startsWith(ITEM_PREFIX_DRIVE)) {
    return text;
  }

  const platform = platformHint || (extractDriveFileId(text || rawUrl) ? "gdrive" : "x");
  if (platform === "gdrive") {
    const fileId = extractDriveFileId(text) || driveFileIdHint || extractDriveFileId(rawUrl);
    if (fileId) {
      return `${ITEM_PREFIX_DRIVE}${fileId}`;
    }

    const seed = rawUrl || text || String(titleHint || "");
    return seed ? `${ITEM_PREFIX_DRIVE}page_${hashString(seed)}` : null;
  }

  const tweetId = extractTweetId(text) || extractTweetId(rawUrl);
  return tweetId ? `${ITEM_PREFIX_X}${tweetId}` : null;
}

function parseItemId(itemId) {
  const text = String(itemId || "");
  if (text.startsWith(ITEM_PREFIX_X)) {
    return {
      itemId: text,
      platform: "x",
      sourceId: text.slice(ITEM_PREFIX_X.length)
    };
  }
  if (text.startsWith(ITEM_PREFIX_DRIVE)) {
    return {
      itemId: text,
      platform: "gdrive",
      sourceId: text.slice(ITEM_PREFIX_DRIVE.length)
    };
  }

  const normalized = normalizeItemId(text);
  if (normalized && normalized !== text) {
    return parseItemId(normalized);
  }

  return {
    itemId: text,
    platform: "x",
    sourceId: text
  };
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

function extractDriveFileId(input) {
  const text = String(input || "");
  const pathMatch = text.match(DRIVE_FILE_PATH_RE);
  if (pathMatch) {
    return pathMatch[1];
  }
  const queryMatch = text.match(DRIVE_FILE_QUERY_RE);
  return queryMatch ? queryMatch[1] : null;
}

function deriveDriveFileIdFromItemId(itemId) {
  const parsed = parseItemId(itemId);
  if (parsed.platform !== "gdrive") {
    return "";
  }
  return /^[a-zA-Z0-9_-]{10,}$/.test(parsed.sourceId) ? parsed.sourceId : "";
}

function normalizeItemUrl(platform, sourceId, rawUrl, driveFileId) {
  const text = String(rawUrl || "").trim();

  if (platform === "gdrive") {
    const fileId = driveFileId || deriveDriveFileIdFromItemId(`${ITEM_PREFIX_DRIVE}${sourceId}`);
    if (text) {
      return text;
    }
    if (fileId) {
      return buildDriveViewUrl(fileId, text);
    }
    return "https://drive.google.com/";
  }

  return makeTweetUrl(sourceId);
}

function makeTweetUrl(tweetId) {
  return `https://x.com/i/web/status/${tweetId}`;
}

function buildDriveViewUrl(fileId, rawUrl) {
  const url = new URL(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`);
  const resourceKey = tryGetSearchParam(rawUrl, "resourcekey");
  if (resourceKey) {
    url.searchParams.set("resourcekey", resourceKey);
  }
  return url.toString();
}

function buildDriveDownloadUrl(fileId, rawUrl) {
  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", fileId);
  url.searchParams.set("export", "download");
  url.searchParams.set("confirm", "t");

  const resourceKey = tryGetSearchParam(rawUrl, "resourcekey");
  if (resourceKey) {
    url.searchParams.set("resourcekey", resourceKey);
  }

  return url.toString();
}

function tryGetSearchParam(rawUrl, key) {
  try {
    const url = new URL(String(rawUrl || ""));
    return url.searchParams.get(key) || "";
  } catch (_error) {
    return "";
  }
}

function normalizeMediaUrl(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) {
    return "";
  }

  try {
    const url = new URL(text);
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch (_error) {
    return "";
  }
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
  return (
    (!entry.title && !!meta.title) ||
    (!entry.itemUrl && !!meta.itemUrl) ||
    (!entry.platform && !!meta.platform)
  );
}

async function startVideoDownload(context, media) {
  const stem = buildFileStem(context, context.title || media.filenameHint || context.sourceId, media.bitrate);
  const extension = guessExtension(media.url, ".mp4");
  return chrome.downloads.download({
    url: media.url,
    filename: `${stem}${extension}`,
    conflictAction: "uniquify",
    saveAs: false
  });
}

async function startTranscriptDownload(context, text, title) {
  const stem = buildFileStem(context, title || context.title || context.sourceId, null);
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  return chrome.downloads.download({
    url,
    filename: `${stem}_transcript.txt`,
    conflictAction: "uniquify",
    saveAs: false
  });
}

function buildFileStem(context, label, bitrate) {
  const safeLabel = sanitizeFilename(label || context.sourceId || "video");
  if (context.platform === "x") {
    return `x_${sanitizeFilename(context.sourceId || safeLabel)}${bitrate ? `_${bitrate}` : ""}`;
  }
  return `gdrive_${safeLabel}${bitrate ? `_${bitrate}` : ""}`;
}

function hashString(value) {
  let hash = 0;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function sanitizeFilename(value) {
  const text = String(value || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return text || "video";
}

function guessExtension(rawUrl, fallback) {
  try {
    const url = new URL(String(rawUrl || ""));
    const match = url.pathname.match(/(\.[a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : fallback;
  } catch (_error) {
    return fallback;
  }
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

async function runNativeTranscription(itemId, mp4Url) {
  const response = await sendNativeMessage({
    type: "transcribe",
    itemId,
    tweetId: itemId,
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

async function resolveBestMedia(context, purpose) {
  const candidates = await resolveMediaCandidates(context, purpose);
  return candidates[0];
}

async function resolveMediaCandidates(context, purpose) {
  const candidates = [];
  const seen = new Set();

  const push = (media) => {
    const url = normalizeMediaUrl(media?.url || "");
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    candidates.push({
      source: media?.source || `${context.platform}.dom`,
      url,
      bitrate: Number(media?.bitrate || 0),
      filenameHint: media?.filenameHint || ""
    });
  };

  if (context.mediaUrl) {
    push({
      source: `${context.platform}.dom`,
      url: context.mediaUrl,
      filenameHint: context.title || context.sourceId
    });
  }

  if (context.platform === "x") {
    const xCandidates = await resolveMp4Candidates(context.sourceId);
    for (const media of xCandidates) {
      push(media);
    }
  } else if (context.platform === "gdrive" && context.fileId) {
    push({
      source: "gdrive.download",
      url: buildDriveDownloadUrl(context.fileId, context.itemUrl),
      filenameHint: context.title || context.sourceId
    });
  }

  if (!candidates.length && context.platform === "gdrive") {
    throw new Error(
      purpose === "transcript"
        ? "Google Drive video URL is not available yet. Start playback and try again."
        : "Could not resolve a downloadable Google Drive video URL."
    );
  }

  if (!candidates.length) {
    throw new Error("No downloadable MP4 found.");
  }

  return candidates;
}

async function resolveMp4Candidates(tweetId) {
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

  variants.sort(compareVariantPriority);
  return variants.map((variant) => ({
    source: variant.source || "cdn.syndication",
    url: variant.url,
    bitrate: variant.bitrate || 0,
    filenameHint: tweetId
  }));
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
      source: source || "cdn.syndication",
      rank: sourceRank(source || "cdn.syndication")
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

function sourceRank(source) {
  const text = String(source || "").toLowerCase();
  if (text === "cdn.syndication") {
    return 0;
  }
  if (text.includes(":retweeted")) {
    return 1;
  }
  if (text.includes(":quoted")) {
    return 2;
  }
  if (text.includes(":nested")) {
    return 3;
  }
  return 4;
}

function compareVariantPriority(a, b) {
  const ar = Number.isFinite(a?.rank) ? a.rank : sourceRank(a?.source);
  const br = Number.isFinite(b?.rank) ? b.rank : sourceRank(b?.source);
  if (ar !== br) {
    return ar - br;
  }
  return Number(b?.bitrate || 0) - Number(a?.bitrate || 0);
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
    const normalized = normalizeEntry({
      ...value,
      itemId: value?.itemId || key,
      tweetId: value?.tweetId || key
    });
    if (!normalized) {
      continue;
    }
    map.set(normalized.itemId, normalized);
  }

  for (const item of store.history || []) {
    const normalized = normalizeEntry(item);
    if (!normalized) {
      continue;
    }

    const existing = map.get(normalized.itemId) || { ...normalized, text: "" };
    map.set(
      normalized.itemId,
      normalizeEntry({
        ...existing,
        ...normalized,
        text: existing.text || normalized.text || ""
      })
    );
  }

  const entries = Array.from(map.values())
    .filter(Boolean)
    .filter((entry) => Number(entry.updatedAt || 0) >= cutoff)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, settings.maxItems);

  const byId = {};
  const history = [];

  for (const entry of entries) {
    byId[entry.itemId] = entry;
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
  const preview = String(entry?.preview || "").slice(0, 600);

  return {
    itemId,
    itemUrl,
    fileId: driveFileId || deriveDriveFileIdFromItemId(itemId),
    platform: parsed.platform,
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
    itemId: entry.itemId,
    itemUrl: String(entry.itemUrl || ""),
    platform: String(entry.platform || ""),
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
