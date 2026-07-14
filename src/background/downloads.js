"use strict";

import { guessExtension, sanitizeFilename } from "./context.js";

export async function startVideoDownload(context, media) {
  const stem = buildFileStem(context, context.title || media.filenameHint || context.sourceId, media.bitrate);
  const extension = guessExtension(media.url, ".mp4");
  return chrome.downloads.download({
    url: media.url,
    filename: `${stem}${extension}`,
    conflictAction: "uniquify",
    saveAs: false
  });
}

export async function startTranscriptDownload(context, text, title, extension = ".txt") {
  const stem = buildFileStem(context, title || context.title || context.sourceId, null);
  const ext = extension === ".srt" ? ".srt" : ".txt";
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  return chrome.downloads.download({
    url,
    filename: `${stem}_transcript${ext}`,
    conflictAction: "uniquify",
    saveAs: false
  });
}

export function buildFileStem(context, label, bitrate) {
  const safeLabel = sanitizeFilename(label || context.sourceId || "video");
  if (context.platform === "x") {
    return `x_${sanitizeFilename(context.sourceId || safeLabel)}${bitrate ? `_${bitrate}` : ""}`;
  }
  return `gdrive_${safeLabel}${bitrate ? `_${bitrate}` : ""}`;
}
