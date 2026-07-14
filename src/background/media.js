"use strict";

import { buildDriveDownloadUrl, normalizeMediaUrl } from "./context.js";

export const MEDIA_FETCH_TIMEOUT_MS = 20 * 1000;

export async function resolveBestMedia(context, purpose) {
  const candidates = await resolveMediaCandidates(context, purpose);
  return candidates[0];
}

export async function resolveMediaCandidates(context, purpose) {
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
      durationMs: Number(media?.durationMs || 0),
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
    const xCandidates = await resolveMp4Candidates(context.sourceId, purpose);
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

export async function resolveMp4Candidates(tweetId, purpose = "download") {
  const errors = [];

  try {
    return await getFromSyndication(tweetId, { purpose });
  } catch (error) {
    errors.push(`syndication: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`No downloadable MP4 found (${errors.join("; ")}).`);
}

// The syndication CDN expects a token derived from the tweet ID (the same
// formula Twitter's own embed widget uses); a wrong token 404s on some tweets.
export function syndicationToken(tweetId) {
  const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  return token || "x";
}

export async function getFromSyndication(tweetId, options = {}) {
  const url = new URL("https://cdn.syndication.twimg.com/tweet-result");
  url.searchParams.set("id", tweetId);
  url.searchParams.set("token", syndicationToken(tweetId));

  const res = await fetchWithTimeout(
    url.toString(),
    {
      method: "GET",
      credentials: "omit"
    },
    options.timeoutMs
  );

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const payload = await res.json();
  const variants = collectMp4Variants(payload);
  if (!variants.length) {
    throw new Error("no MP4 variants in response");
  }

  const purpose = options.purpose === "transcript" ? "transcript" : "download";
  let audioInfo = null;
  if (purpose === "transcript") {
    audioInfo = await resolveBestAudioCandidate(payload, options.timeoutMs);
    for (const variant of variants) {
      variant.audioBitrate = audioInfo?.audioBitrates.get(extractVariantResolution(variant.url)) || 0;
    }
  }

  const compareVariants =
    purpose === "transcript" && audioInfo
      ? compareTranscriptVariantPriority
      : compareVariantPriority;
  variants.sort(compareVariants);
  const candidates = variants.map((variant) => ({
    source: variant.source || "cdn.syndication",
    url: variant.url,
    bitrate: variant.bitrate || 0,
    audioBitrate: variant.audioBitrate || 0,
    durationMs: variant.durationMs || 0,
    filenameHint: tweetId
  }));

  if (purpose === "transcript" && audioInfo?.candidate) {
    const audioCandidate = {
      ...audioInfo.candidate,
      filenameHint: tweetId
    };
    if (candidates[0]?.audioBitrate >= audioCandidate.bitrate) {
      candidates.splice(1, 0, audioCandidate);
    } else {
      candidates.unshift(audioCandidate);
    }
  }

  return candidates;
}

export async function fetchWithTimeout(url, init = {}, timeoutMs = MEDIA_FETCH_TIMEOUT_MS) {
  const timeout = sanitizeTimeout(timeoutMs, MEDIA_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Media lookup timed out after ${formatDuration(timeout)}.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeTimeout(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function formatDuration(ms) {
  const sec = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  return `${Math.ceil(sec / 60)} min`;
}

export function collectMp4Variants(payload) {
  const seen = new Set();
  const result = [];

  const push = (url, bitrate, source, durationMs) => {
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
      durationMs: Number.isFinite(Number(durationMs)) ? Number(durationMs) : 0,
      source: source || "cdn.syndication",
      rank: sourceRank(source || "cdn.syndication")
    });
  };

  const collectFromVariants = (variants, source, durationMs = 0) => {
    if (!Array.isArray(variants)) {
      return;
    }
    for (const variant of variants) {
      if (!variant || variant.content_type !== "video/mp4") {
        continue;
      }
      push(variant.url, variant.bitrate, source, durationMs);
    }
  };

  const collectFromMediaDetails = (mediaDetails, source) => {
    if (!Array.isArray(mediaDetails)) {
      return;
    }
    for (const media of mediaDetails) {
      collectFromVariants(
        media?.video_info?.variants,
        source,
        media?.video_info?.duration_millis
      );
    }
  };

  const collectFromTweetNode = (node, source) => {
    if (!node || typeof node !== "object") {
      return;
    }
    collectFromMediaDetails(node.mediaDetails, source);
    collectFromVariants(node?.video?.variants, source, node?.video?.duration_millis);
  };

  collectFromTweetNode(payload, "cdn.syndication");
  collectFromTweetNode(payload?.quoted_tweet, "cdn.syndication:quoted");
  collectFromTweetNode(payload?.retweeted_tweet, "cdn.syndication:retweeted");

  if (!result.length) {
    walkForVideoInfo(payload, collectFromVariants, collectFromMediaDetails);
  }

  return result;
}

export function collectHlsMasters(payload) {
  const seen = new Set();
  const result = [];

  const collectFromVariants = (variants, source, durationMs = 0) => {
    if (!Array.isArray(variants)) {
      return;
    }
    for (const variant of variants) {
      const url = String(variant?.url || "");
      if (variant?.content_type !== "application/x-mpegURL" || !url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      result.push({
        url,
        durationMs: Number.isFinite(Number(durationMs)) ? Number(durationMs) : 0,
        source: source || "cdn.syndication",
        rank: sourceRank(source || "cdn.syndication")
      });
    }
  };

  const collectFromMediaDetails = (mediaDetails, source) => {
    if (!Array.isArray(mediaDetails)) {
      return;
    }
    for (const media of mediaDetails) {
      collectFromVariants(
        media?.video_info?.variants,
        source,
        media?.video_info?.duration_millis
      );
    }
  };

  const collectFromTweetNode = (node, source) => {
    if (!node || typeof node !== "object") {
      return;
    }
    collectFromMediaDetails(node.mediaDetails, source);
    collectFromVariants(node?.video?.variants, source, node?.video?.duration_millis);
  };

  collectFromTweetNode(payload, "cdn.syndication");
  collectFromTweetNode(payload?.retweeted_tweet, "cdn.syndication:retweeted");
  collectFromTweetNode(payload?.quoted_tweet, "cdn.syndication:quoted");
  result.sort((a, b) => a.rank - b.rank);
  return result;
}

export function collectAudioPlaylists(playlistText, masterUrl) {
  const seen = new Set();
  const result = [];

  for (const line of String(playlistText || "").split(/\r?\n/)) {
    if (!line.startsWith("#EXT-X-MEDIA:") || !/(?:^|,)TYPE=AUDIO(?:,|$)/.test(line)) {
      continue;
    }

    const uri = line.match(/(?:^|,)URI="([^"]+)"/)?.[1] || "";
    if (!uri) {
      continue;
    }

    let url;
    try {
      url = new URL(uri, masterUrl).toString();
    } catch (_error) {
      continue;
    }
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);

    const bitrateText =
      line.match(/(?:^|,)GROUP-ID="[^"]*?(\d{4,9})"/)?.[1] ||
      uri.match(/\/(\d{4,9})(?:\/|$)/)?.[1] ||
      "0";
    result.push({
      url,
      bitrate: Number(bitrateText) || 0
    });
  }

  result.sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  return result;
}

export function collectStreamAudioBitrates(playlistText) {
  const result = new Map();
  for (const line of String(playlistText || "").split(/\r?\n/)) {
    if (!line.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }
    const resolution = line.match(/(?:^|,)RESOLUTION=(\d+x\d+)(?:,|$)/)?.[1] || "";
    const audioGroup = line.match(/(?:^|,)AUDIO="[^"]*?(\d{4,9})"/)?.[1] || "";
    if (resolution && audioGroup) {
      result.set(resolution, Number(audioGroup) || 0);
    }
  }
  return result;
}

async function resolveBestAudioCandidate(payload, timeoutMs) {
  const masters = collectHlsMasters(payload);
  for (const master of masters) {
    try {
      const response = await fetchWithTimeout(
        master.url,
        {
          method: "GET",
          credentials: "omit"
        },
        timeoutMs
      );
      if (!response.ok) {
        continue;
      }
      const playlistText = await response.text();
      const playlists = collectAudioPlaylists(playlistText, master.url);
      if (playlists.length) {
        return {
          candidate: {
            source: `${master.source}:audio`,
            url: playlists[0].url,
            bitrate: playlists[0].bitrate,
            durationMs: master.durationMs
          },
          audioBitrates: collectStreamAudioBitrates(playlistText)
        };
      }
    } catch (_error) {
      // MP4 transcript candidates remain available as a fallback.
    }
  }
  return null;
}

function extractVariantResolution(url) {
  return String(url || "").match(/\/(\d+x\d+)\//)?.[1] || "";
}

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

export function sourceRank(source) {
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

export function compareVariantPriority(a, b) {
  const ar = Number.isFinite(a?.rank) ? a.rank : sourceRank(a?.source);
  const br = Number.isFinite(b?.rank) ? b.rank : sourceRank(b?.source);
  if (ar !== br) {
    return ar - br;
  }
  return Number(b?.bitrate || 0) - Number(a?.bitrate || 0);
}

export function compareTranscriptVariantPriority(a, b) {
  const ar = Number.isFinite(a?.rank) ? a.rank : sourceRank(a?.source);
  const br = Number.isFinite(b?.rank) ? b.rank : sourceRank(b?.source);
  if (ar !== br) {
    return ar - br;
  }
  const audioDifference = Number(b?.audioBitrate || 0) - Number(a?.audioBitrate || 0);
  if (audioDifference !== 0) {
    return audioDifference;
  }
  return Number(a?.bitrate || 0) - Number(b?.bitrate || 0);
}
