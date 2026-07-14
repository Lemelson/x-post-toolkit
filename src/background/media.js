"use strict";

import { buildDriveDownloadUrl, normalizeMediaUrl } from "./context.js";

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

export async function resolveMp4Candidates(tweetId) {
  const errors = [];

  try {
    return await getFromSyndication(tweetId);
  } catch (error) {
    errors.push(`syndication: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`No downloadable MP4 found (${errors.join("; ")}).`);
}

export async function getFromSyndication(tweetId) {
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

export function collectMp4Variants(payload) {
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
