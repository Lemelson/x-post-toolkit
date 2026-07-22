"use strict";

export const NATIVE_HOST_NAME = "com.xvdl.transcriber";
// Default native commands can legitimately take up to 15 minutes for ffmpeg
// plus 40 minutes for ASR. Incomplete results may be retried, so keep the
// transport timeout above the worst-case default retry budget.
export const DEFAULT_NATIVE_MESSAGE_TIMEOUT_MS = 130 * 60 * 1000;
export const DEBUG_NATIVE_MESSAGE_TIMEOUT_MS = 15 * 1000;

export async function runNativeTranscription(itemId, mp4Url, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const payload = {
    type: "transcribe",
    itemId,
    tweetId: itemId,
    mp4Url,
    expectedDurationMs: Number(options.expectedDurationMs || 0),
    copyToClipboard: false
  };

  // Always use a long-lived connectNative port: it lets the host stream stage
  // updates and, unlike one-shot sendNativeMessage, an open native port keeps
  // the MV3 service worker alive for the whole (potentially long) job.
  const response = await sendNativeTranscribeWithProgress(
    { ...payload, emitProgress: !!onProgress },
    onProgress || (() => undefined)
  );

  if (!response?.ok) {
    const error = new Error(response?.error || "Native transcriber failed.");
    if (response?.code) {
      error.code = String(response.code);
    }
    throw error;
  }

  return {
    text: String(response.transcript || ""),
    sentences: Array.isArray(response.sentences) ? response.sentences : [],
    charCount: Number(response.charCount || 0),
    preview: String(response.preview || ""),
    elapsedMs: Number(response.elapsedMs || 0),
    downloadElapsedMs: Number(response.downloadElapsedMs || 0),
    queueElapsedMs: Number(response.queueElapsedMs || 0),
    asrElapsedMs: Number(response.asrElapsedMs || 0),
    validationVersion: Number(response.validationVersion || 0),
    expectedDurationMs: Number(response.expectedDurationMs || 0),
    audioDurationMs: Number(response.audioDurationMs || 0),
    transcriptEndMs: Number(response.transcriptEndMs || 0),
    complete: response.complete === true
  };
}

export async function debugNativeHost() {
  try {
    const ping = await sendNativeMessage({ type: "ping" }, { timeoutMs: DEBUG_NATIVE_MESSAGE_TIMEOUT_MS });
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

export function sendNativeTranscribeWithProgress(payload, onProgress, options = {}) {
  const timeoutMs = sanitizeTimeout(options.timeoutMs, DEFAULT_NATIVE_MESSAGE_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    let settled = false;
    let port = null;

    const cleanup = () => {
      clearTimeout(timer);
      try {
        port?.disconnect();
      } catch (_error) {
        // Port may already be gone; ignore.
      }
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(buildNativeTimeoutMessage(payload, timeoutMs)));
    }, timeoutMs);

    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(buildNativeUnavailableError(error instanceof Error ? error.message : String(error)));
      return;
    }

    port.onMessage.addListener((message) => {
      if (settled) {
        return;
      }
      if (message && message.type === "progress") {
        try {
          onProgress(message);
        } catch (_error) {
          // A failing progress callback must not abort the transcription.
        }
        return;
      }
      settled = true;
      cleanup();
      resolve(message);
    });

    port.onDisconnect.addListener(() => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const lastError = chrome.runtime.lastError;
      reject(buildNativeUnavailableError(lastError?.message || "Native host disconnected before responding."));
    });

    try {
      port.postMessage(payload);
    } catch (error) {
      settled = true;
      cleanup();
      reject(buildNativeUnavailableError(error instanceof Error ? error.message : String(error)));
    }
  });
}

function buildNativeUnavailableError(detail) {
  return new Error(
    [
      "Native host is unavailable.",
      `Extension ID: ${chrome.runtime.id}.`,
      "Run setup from the project folder:",
      `./scripts/install_native_host.sh ${chrome.runtime.id}`,
      detail
    ].join(" ")
  );
}

export function sendNativeMessage(payload, options = {}) {
  const timeoutMs = sanitizeTimeout(options.timeoutMs, DEFAULT_NATIVE_MESSAGE_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(buildNativeTimeoutMessage(payload, timeoutMs)));
    }, timeoutMs);

    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        if (chrome.runtime.lastError) {
          reject(buildNativeUnavailableError(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(buildNativeUnavailableError(error instanceof Error ? error.message : String(error)));
    }
  });
}

export function sanitizeTimeout(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

export function buildNativeTimeoutMessage(payload, timeoutMs) {
  const action = payload?.type === "ping" ? "native host ping" : "native transcriber";
  return [
    `Timed out waiting for ${action} after ${formatDuration(timeoutMs)}.`,
    "The local ffmpeg/parakeet process may be stuck.",
    "Check ~/Library/Logs/xvdl-native-host.log and retry."
  ].join(" ");
}

function formatDuration(ms) {
  const sec = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  return `${Math.ceil(sec / 60)} min`;
}
