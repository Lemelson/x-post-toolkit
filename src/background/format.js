"use strict";

export const TIMESTAMP_MODES = ["off", "s10", "s30", "s60", "all"];
export const TIMESTAMP_INTERVALS_MS = {
  s10: 10 * 1000,
  s30: 30 * 1000,
  s60: 60 * 1000
};
export const DEFAULT_TIMESTAMP_MODE = "off";
// Fallback interval for explicit "copy with timestamps" requests when the
// global setting is "off".
export const FALLBACK_TIMESTAMP_MODE = "s30";

export function sanitizeTimestampMode(value) {
  const text = String(value || "").trim();
  return TIMESTAMP_MODES.includes(text) ? text : DEFAULT_TIMESTAMP_MODE;
}

export function sanitizeSentences(raw, maxSentences = 8000) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result = [];
  for (const item of raw) {
    const text = String(item?.text || "").trim();
    const startMs = Number(item?.startMs);
    const endMs = Number(item?.endMs);
    if (!text || !Number.isFinite(startMs) || startMs < 0) {
      continue;
    }
    result.push({
      text,
      startMs: Math.floor(startMs),
      endMs: Number.isFinite(endMs) && endMs >= startMs ? Math.floor(endMs) : Math.floor(startMs)
    });
    if (result.length >= maxSentences) {
      break;
    }
  }
  return result;
}

export function formatTimestamp(ms) {
  const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hours = Math.floor(totalSec / 3600);
  const mm = String(min).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${min}:${ss}`;
}

export function buildTimestampedText(sentences, mode) {
  const list = sanitizeSentences(sentences);
  if (!list.length) {
    return "";
  }

  if (mode === "all") {
    return list.map((s) => `[${formatTimestamp(s.startMs)}] ${s.text}`).join("\n");
  }

  const intervalMs = TIMESTAMP_INTERVALS_MS[mode] || TIMESTAMP_INTERVALS_MS[FALLBACK_TIMESTAMP_MODE];
  const blocks = [];
  let current = null;

  for (const sentence of list) {
    if (!current || sentence.startMs >= current.startMs + intervalMs) {
      current = { startMs: sentence.startMs, parts: [] };
      blocks.push(current);
    }
    current.parts.push(sentence.text);
  }

  return blocks
    .map((block) => `[${formatTimestamp(block.startMs)}] ${block.parts.join(" ")}`)
    .join("\n");
}

// format: "default" (respect settings), "clean" (plain text), "timestamps"
// (force timecodes even when the global setting is off).
export function buildTranscriptOutput(entry, settings, format = "default") {
  const title = String(entry?.title || "").trim();
  const tweetText = String(entry?.tweetText || "").trim();
  const plain = String(entry?.text || "");
  const sentences = sanitizeSentences(entry?.sentences);
  const settingsMode = sanitizeTimestampMode(settings?.timestampMode);

  let mode = "off";
  if (format === "timestamps") {
    mode = settingsMode === "off" ? FALLBACK_TIMESTAMP_MODE : settingsMode;
  } else if (format !== "clean") {
    mode = settingsMode;
  }

  let body = plain;
  if (mode !== "off" && sentences.length) {
    body = buildTimestampedText(sentences, mode) || plain;
  }

  const includeTitle = settings?.includeTitle !== false;
  if (includeTitle && tweetText) {
    const author = formatAuthorLine(entry);
    const header = [
      author,
      `Above is tweet text:\n${tweetText}`,
      `Below is video transcript:\n${body}`
    ].filter(Boolean);
    return header.join("\n\n");
  }
  if (includeTitle && title) {
    return `${title}\n\n${body}`;
  }
  return body;
}

export function formatAuthorLine(entry) {
  const name = String(entry?.authorName || "").trim();
  const handle = String(entry?.authorHandle || "").trim();
  if (name && handle) {
    return `Tweet author: ${name} (${handle})`;
  }
  if (name) {
    return `Tweet author: ${name}`;
  }
  if (handle) {
    return `Tweet author: ${handle}`;
  }
  return "";
}

export function buildSrt(sentences) {
  const list = sanitizeSentences(sentences);
  return list
    .map((sentence, index) => {
      const endMs = sentence.endMs > sentence.startMs ? sentence.endMs : sentence.startMs + 2000;
      return [
        String(index + 1),
        `${formatSrtTime(sentence.startMs)} --> ${formatSrtTime(endMs)}`,
        sentence.text,
        ""
      ].join("\n");
    })
    .join("\n");
}

export function formatSrtTime(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0)));
  const msPart = total % 1000;
  const totalSec = Math.floor(total / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hours = Math.floor(totalSec / 3600);
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return `${pad(hours)}:${pad(min)}:${pad(sec)},${pad(msPart, 3)}`;
}
