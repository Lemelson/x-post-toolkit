"use strict";

export const ETA_STATS_KEY = "transcriptionEtaStats";
export const ETA_MAX_SAMPLES = 20;

const ETA_VERSION = 1;
const MIN_DURATION_MS = 5 * 1000;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;
const MIN_PHASE_MS = 100;
const MAX_PHASE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_RATIOS = {
  download: 0.15,
  transcription: 0.25
};

export async function getEtaStats() {
  const data = await chrome.storage.local.get([ETA_STATS_KEY]);
  return sanitizeEtaStats(data?.[ETA_STATS_KEY]);
}

export async function recordEtaSample(sample) {
  const current = await getEtaStats();
  const next = addEtaSample(current, sample);
  await chrome.storage.local.set({ [ETA_STATS_KEY]: next });
  return next;
}

export function sanitizeEtaStats(raw) {
  const samples = Array.isArray(raw?.samples)
    ? raw.samples.map(sanitizeEtaSample).filter(Boolean).slice(-ETA_MAX_SAMPLES)
    : [];
  return { version: ETA_VERSION, samples };
}

export function addEtaSample(stats, sample) {
  const current = sanitizeEtaStats(stats);
  const normalized = sanitizeEtaSample(sample);
  if (!normalized) {
    return current;
  }
  return {
    version: ETA_VERSION,
    samples: [...current.samples, normalized].slice(-ETA_MAX_SAMPLES)
  };
}

export function estimateEtaMs(stats, phase, durationMs) {
  const duration = Number(durationMs || 0);
  const fallbackRatio = DEFAULT_RATIOS[phase];
  if (!fallbackRatio || !Number.isFinite(duration) || duration < MIN_DURATION_MS) {
    return 0;
  }

  const key = phase === "download" ? "downloadElapsedMs" : "asrElapsedMs";
  const ratios = sanitizeEtaStats(stats).samples
    .map((sample) => sample[key] / sample.durationMs)
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
    .map((ratio) => clamp(ratio, 0.01, 10));
  const personalRatio = robustMean(ratios);
  const personalWeight = Math.min(1, ratios.length / 3);
  const ratio = personalRatio === null
    ? fallbackRatio
    : fallbackRatio * (1 - personalWeight) + personalRatio * personalWeight;

  return Math.round(clamp(duration * ratio, 1000, MAX_PHASE_MS));
}

export function isPhaseSlowdown(stats, phase, durationMs, elapsedMs, multiplier = 3) {
  const elapsed = Number(elapsedMs || 0);
  const expected = estimateEtaMs(stats, phase, durationMs);
  const limit = expected * Math.max(1, Number(multiplier || 3));
  return expected > 0 && Number.isFinite(elapsed) && elapsed > limit;
}

export function robustMean(values) {
  const sorted = values
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  if (sorted.length < 5) {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  const trim = Math.max(1, Math.floor(sorted.length * 0.1));
  const kept = sorted.slice(trim, sorted.length - trim);
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

function sanitizeEtaSample(sample) {
  const durationMs = Number(sample?.durationMs || sample?.audioDurationMs || 0);
  const downloadElapsedMs = Number(sample?.downloadElapsedMs || 0);
  const asrElapsedMs = Number(sample?.asrElapsedMs || 0);
  if (
    !isBetween(durationMs, MIN_DURATION_MS, MAX_DURATION_MS) ||
    !isBetween(downloadElapsedMs, MIN_PHASE_MS, MAX_PHASE_MS) ||
    !isBetween(asrElapsedMs, MIN_PHASE_MS, MAX_PHASE_MS)
  ) {
    return null;
  }
  return {
    durationMs: Math.round(durationMs),
    downloadElapsedMs: Math.round(downloadElapsedMs),
    asrElapsedMs: Math.round(asrElapsedMs),
    recordedAt: Math.max(0, Math.round(Number(sample?.recordedAt || Date.now())))
  };
}

function isBetween(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
