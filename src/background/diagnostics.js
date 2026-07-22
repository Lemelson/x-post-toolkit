"use strict";

// TODO(PRODUCTION): Remove this temporary [DEBUG-XVDL-PERF] logger and its
// chrome.storage.local data before the extension is shipped to production.
export const PERF_LOG_PREFIX = "[DEBUG-XVDL-PERF]";
export const PERF_LOG_KEY = "xvdlTemporaryPerfDiagnosticsV1";
export const PERF_LOG_MAX_TRACES = 30;

let storageWriteQueue = Promise.resolve();

export function createPerfTrace(itemId, now = Date.now()) {
  const startedAt = finiteTimestamp(now);
  return {
    version: 1,
    traceId: `${String(itemId || "unknown")}:${startedAt}`,
    itemId: String(itemId || "unknown"),
    startedAt,
    events: []
  };
}

export function markPerfTrace(trace, event, details = {}, now = Date.now()) {
  if (!trace || !Array.isArray(trace.events)) {
    return null;
  }

  const at = finiteTimestamp(now);
  const entry = {
    event: String(event || "unknown"),
    at,
    elapsedMs: Math.max(0, at - Number(trace.startedAt || at)),
    details: sanitizePerfDetails(details)
  };
  trace.events.push(entry);

  try {
    console.info(PERF_LOG_PREFIX, trace.itemId, entry.event, entry.elapsedMs, entry.details);
  } catch (_error) {
    // Diagnostics must never affect transcription.
  }
  return entry;
}

export async function persistPerfTrace(trace) {
  if (!trace?.traceId) {
    return;
  }
  await withStorageWrite(async () => {
    const data = await chrome.storage.local.get([PERF_LOG_KEY]);
    const traces = addTraceToLog(data?.[PERF_LOG_KEY], trace);
    await chrome.storage.local.set({ [PERF_LOG_KEY]: traces });
  });
}

export function addTraceToLog(value, trace) {
  const traces = normalizeTraceLog(value).filter((item) => item.traceId !== trace.traceId);
  return [structuredCloneSafe(trace), ...traces].slice(0, PERF_LOG_MAX_TRACES);
}

export function sanitizePerfDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }

  const safe = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string") {
      safe[key] = value.slice(0, 160);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      safe[key] = value;
    }
  }
  return safe;
}

function normalizeTraceLog(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && item.traceId)
    : [];
}

function withStorageWrite(operation) {
  const next = storageWriteQueue.then(operation, operation);
  storageWriteQueue = next.catch(() => undefined);
  return next;
}

function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : Date.now();
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
