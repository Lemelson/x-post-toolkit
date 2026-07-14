"use strict";

export const TWEET_ID_RE = /\b(\d{8,30})\b/;
export const DRIVE_FILE_PATH_RE = /\/file\/d\/([a-zA-Z0-9_-]{10,})\b/;
export const DRIVE_FILE_QUERY_RE = /[?&]id=([a-zA-Z0-9_-]{10,})\b/;
export const ITEM_PREFIX_X = "x:";
export const ITEM_PREFIX_DRIVE = "gdrive:";

export function getItemContext(message) {
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

export function detectPlatform(message) {
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

export function normalizeItemId(input, platformHint, rawUrl, driveFileIdHint, titleHint) {
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

export function parseItemId(itemId) {
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

export function extractTweetId(input) {
  const text = String(input || "");
  const statusMatch = text.match(/status\/(\d{8,30})/);
  if (statusMatch) {
    return statusMatch[1];
  }
  const rawMatch = text.match(TWEET_ID_RE);
  return rawMatch ? rawMatch[1] : null;
}

export function extractDriveFileId(input) {
  const text = String(input || "");
  const pathMatch = text.match(DRIVE_FILE_PATH_RE);
  if (pathMatch) {
    return pathMatch[1];
  }
  const queryMatch = text.match(DRIVE_FILE_QUERY_RE);
  return queryMatch ? queryMatch[1] : null;
}

export function deriveDriveFileIdFromItemId(itemId) {
  const parsed = parseItemId(itemId);
  if (parsed.platform !== "gdrive") {
    return "";
  }
  return /^[a-zA-Z0-9_-]{10,}$/.test(parsed.sourceId) ? parsed.sourceId : "";
}

export function normalizeItemUrl(platform, sourceId, rawUrl, driveFileId) {
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

export function makeTweetUrl(tweetId) {
  return `https://x.com/i/web/status/${tweetId}`;
}

export function buildDriveViewUrl(fileId, rawUrl) {
  const url = new URL(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`);
  const resourceKey = tryGetSearchParam(rawUrl, "resourcekey");
  if (resourceKey) {
    url.searchParams.set("resourcekey", resourceKey);
  }
  return url.toString();
}

export function buildDriveDownloadUrl(fileId, rawUrl) {
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

export function tryGetSearchParam(rawUrl, key) {
  try {
    const url = new URL(String(rawUrl || ""));
    return url.searchParams.get(key) || "";
  } catch (_error) {
    return "";
  }
}

export function normalizeMediaUrl(rawUrl) {
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

export function buildTitleSnippet(text) {
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

export function hashString(value) {
  let hash = 0;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function sanitizeFilename(value) {
  const text = String(value || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return text || "video";
}

export function guessExtension(rawUrl, fallback) {
  try {
    const url = new URL(String(rawUrl || ""));
    const match = url.pathname.match(/(\.[a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : fallback;
  } catch (_error) {
    return fallback;
  }
}
