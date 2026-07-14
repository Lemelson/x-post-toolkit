"use strict";

const ACTIONS_CLASS = "xvdl-actions";
const DRIVE_ACTIONS_CLASS = "xvdl-drive-actions";
const BTN_CLASS = "xvdl-btn";
const DRIVE_BTN_CLASS = "xvdl-btn--drive";
const BTN_ROLE = "xvdl-action";
const TOAST_CLASS = "xvdl-toast";
const DEFAULT_MESSAGE_TIMEOUT_MS = 60 * 1000;
const DEBUG_MESSAGE_TIMEOUT_MS = 15 * 1000;
const TRANSCRIPT_MESSAGE_TIMEOUT_MS = 135 * 60 * 1000;
// Keep the current stage visible for the same window as the request. Success,
// failure, or the request timeout replaces it with a terminal toast.
const PROGRESS_TOAST_DURATION_MS = TRANSCRIPT_MESSAGE_TIMEOUT_MS;

const PROGRESS_TOASTS = {
  downloading: { text: "Downloading audio…", kind: "info" },
  downloaded: { text: "Audio downloaded", kind: "step" },
  transcribing: { text: "Audio verified. Transcribing…", kind: "work" },
  "invalid-cache": { text: "Cached transcript is incomplete or unverified. Starting again…", kind: "step" },
  "retrying-download": { text: "Audio download was interrupted. Retrying…", kind: "step" },
  "retrying-transcription": { text: "Transcription was interrupted. Retrying…", kind: "step" }
};
let progressTransitionTimer = null;

const adapterApi = {
  ACTIONS_CLASS,
  DRIVE_ACTIONS_CLASS,
  BTN_CLASS,
  DRIVE_BTN_CLASS,
  BTN_ROLE,
  createActionWrapper,
  syncButtonsMeta,
  applyMetaToButton
};

const siteAdapters = (globalThis.XVDL_SITE_ADAPTER_FACTORIES || [])
  .map((factory) => factory(adapterApi))
  .filter(Boolean);

injectStyles();
scanPage();
observeDom();
wireClickHandler();
wireRuntimeHandler();
// Safety net for anything the MutationObserver misses (e.g. attribute-only
// player swaps); the observer handles the common cases, so keep this rare.
setInterval(() => scheduleScan(), 5000);

function injectStyles() {
  if (document.getElementById("xvdl-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "xvdl-style";
  style.textContent = `
    .${ACTIONS_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 2px;
    }
    .${DRIVE_ACTIONS_CLASS} {
      display: flex;
      align-items: center;
      gap: 4px;
      pointer-events: auto;
    }
    .${DRIVE_ACTIONS_CLASS}[data-placement="inline"] {
      position: static;
      margin-right: 8px;
      flex: 0 0 auto;
    }
    .${DRIVE_ACTIONS_CLASS}[data-placement="overlay"] {
      position: absolute;
      right: 136px;
      bottom: 12px;
      z-index: 2147483646;
    }
    .${BTN_CLASS} {
      appearance: none;
      border: 0;
      padding: 0;
      margin: 0;
      width: 34px;
      height: 34px;
      border-radius: 999px;
      background: transparent;
      color: rgb(113, 118, 123);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background-color .15s ease-in-out, color .15s ease-in-out, border-color .15s ease-in-out;
    }
    .${DRIVE_BTN_CLASS} {
      width: 34px;
      min-width: 34px;
      height: 34px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(15, 20, 25, 0.82);
      color: #fff;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
    }
    .${BTN_CLASS}:hover {
      background: rgba(29, 155, 240, 0.13);
      color: rgb(29, 155, 240);
    }
    .${DRIVE_BTN_CLASS}:hover {
      background: rgba(29, 155, 240, 0.2);
      border-color: rgba(29, 155, 240, 0.45);
      color: #fff;
    }
    .${BTN_CLASS}:focus-visible {
      outline: 2px solid rgba(29, 155, 240, 0.5);
      outline-offset: 2px;
    }
    .${BTN_CLASS}[data-state="loading"] {
      color: rgb(255, 255, 255);
      background: rgb(29, 155, 240);
      cursor: wait;
    }
    .${BTN_CLASS}[data-state="done"] {
      color: rgb(0, 186, 124);
      background: rgba(0, 186, 124, 0.15);
    }
    .${DRIVE_BTN_CLASS}[data-state="done"] {
      color: #fff;
      background: rgba(0, 186, 124, 0.55);
      border-color: rgba(0, 186, 124, 0.6);
    }
    .${BTN_CLASS}[data-state="error"] {
      color: rgb(244, 33, 46);
      background: rgba(244, 33, 46, 0.15);
    }
    .${DRIVE_BTN_CLASS}[data-state="error"] {
      color: #fff;
      background: rgba(244, 33, 46, 0.55);
      border-color: rgba(244, 33, 46, 0.6);
    }
    .${BTN_CLASS}[data-state="loading"] svg {
      animation: xvdl-spin 0.9s linear infinite;
    }
    .${BTN_CLASS} svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
      flex: 0 0 auto;
    }
    @keyframes xvdl-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .${TOAST_CLASS} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      max-width: min(460px, calc(100vw - 24px));
      background: rgba(15, 20, 25, 0.96);
      color: #fff;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.35;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .${TOAST_CLASS}[data-kind="error"] {
      border: 1px solid rgba(244, 33, 46, 0.55);
    }
    .${TOAST_CLASS}[data-kind="success"] {
      border: 1px solid rgba(0, 186, 124, 0.45);
    }
    .${TOAST_CLASS}[data-kind="info"] {
      border: 1px solid rgba(29, 155, 240, 0.6);
    }
    .${TOAST_CLASS}[data-kind="step"] {
      border: 1px solid rgba(255, 179, 0, 0.65);
    }
    .${TOAST_CLASS}[data-kind="work"] {
      border: 1px solid rgba(157, 101, 255, 0.65);
    }
  `;
  document.documentElement.appendChild(style);
}

function getActiveAdapters() {
  return siteAdapters.filter((adapter) => {
    try {
      return adapter.match();
    } catch (_error) {
      return false;
    }
  });
}

function scanPage(root = document) {
  for (const adapter of getActiveAdapters()) {
    adapter.scan(root);
  }
}

// SPA mutations arrive in bursts (X re-renders whole timeline chunks), so
// coalesce them into one scan per animation frame instead of scanning per node.
let scanQueued = false;

function scheduleScan() {
  if (scanQueued) {
    return;
  }
  scanQueued = true;
  window.requestAnimationFrame(() => {
    scanQueued = false;
    scanPage();
  });
}

function observeDom() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        scheduleScan();
        return;
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function createActionWrapper(meta, variant, adapterId) {
  const actions = document.createElement("div");
  actions.className = variant === "drive" ? DRIVE_ACTIONS_CLASS : ACTIONS_CLASS;
  actions.setAttribute("data-testid", "xvdl-actions");
  actions.dataset.variant = variant;
  actions.dataset.adapterId = adapterId || meta.adapterId || meta.platform || "";

  if (variant !== "drive") {
    actions.appendChild(createActionButton("download", meta, variant, adapterId));
  }
  actions.appendChild(createActionButton("transcript", meta, variant, adapterId));
  return actions;
}

function createActionButton(action, meta, variant, adapterId) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = variant === "drive" ? `${BTN_CLASS} ${DRIVE_BTN_CLASS}` : BTN_CLASS;
  btn.dataset.role = BTN_ROLE;
  btn.dataset.action = action;
  btn.dataset.variant = variant;
  btn.dataset.state = "idle";
  applyMetaToButton(btn, meta, adapterId);
  btn.title = getButtonTitle(action);
  btn.setAttribute("aria-label", btn.title);
  renderButtonContent(btn, action, "idle");
  return btn;
}

function syncButtonsMeta(wrapper, meta) {
  const buttons = wrapper.querySelectorAll(`.${BTN_CLASS}`);
  for (const button of buttons) {
    applyMetaToButton(button, meta, wrapper.dataset.adapterId || "");
  }
}

function applyMetaToButton(button, meta, adapterId = "") {
  button.dataset.itemId = meta.itemId || "";
  button.dataset.itemUrl = meta.itemUrl || "";
  button.dataset.title = meta.title || "";
  button.dataset.tweetText = meta.tweetText || "";
  button.dataset.authorName = meta.authorName || "";
  button.dataset.authorHandle = meta.authorHandle || "";
  button.dataset.platform = meta.platform || "";
  button.dataset.mediaUrl = meta.mediaUrl || "";
  button.dataset.fileId = meta.fileId || "";
  if (adapterId || meta.adapterId) {
    button.dataset.adapterId = adapterId || meta.adapterId;
  }
}

function wireClickHandler() {
  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest(`.${BTN_CLASS}`) : null;
    if (!button || button.dataset.role !== BTN_ROLE) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const itemId = button.dataset.itemId;
    const action = button.dataset.action;
    if (!itemId || !action || button.dataset.state === "loading") {
      return;
    }

    const adapter = getAdapterForButton(button);
    const meta = adapter?.getButtonContext?.(button) || {};
    const payload = {
      type: action === "transcript" ? "TRANSCRIBE_VIDEO_ITEM" : "DOWNLOAD_VIDEO_ITEM",
      itemId,
      itemUrl: meta.itemUrl || button.dataset.itemUrl || location.href,
      title: meta.title || button.dataset.title || "",
      tweetText: meta.tweetText || button.dataset.tweetText || "",
      authorName: meta.authorName || button.dataset.authorName || "",
      authorHandle: meta.authorHandle || button.dataset.authorHandle || "",
      platform: meta.platform || button.dataset.platform || "",
      mediaUrl: meta.mediaUrl || button.dataset.mediaUrl || "",
      fileId: meta.fileId || button.dataset.fileId || ""
    };

    if (action === "transcript" && event.shiftKey) {
      runDebug(button, action);
      return;
    }

    applyMetaToButton(button, {
      itemId,
      itemUrl: payload.itemUrl,
      title: payload.title,
      tweetText: payload.tweetText,
      authorName: payload.authorName,
      authorHandle: payload.authorHandle,
      platform: payload.platform,
      mediaUrl: payload.mediaUrl,
      fileId: payload.fileId
    }, button.dataset.adapterId || "");

    setState(button, action, "loading");
    if (action === "transcript") {
      showProgressToast("downloading");
    }
    sendRuntimeMessage(payload)
      .then(async (response) => {
        if (!response?.ok) {
          setState(button, action, "error");
          const code = response?.code ? ` [${response.code}]` : "";
          const msg = `Failed${code}: ${response?.error || "unknown error"}\nLog: ~/Library/Logs/xvdl-native-host.log`;
          button.title = msg;
          showToast(msg, "error");
          resetLater(button, action);
          return;
        }

        setState(button, action, "done");
        if (action === "transcript") {
          if (response.cached) {
            try {
              await copyTextToClipboard(response.text || "");
              button.title = "Cached transcript copied to clipboard";
              showToast(
                `Verified saved transcript copied. Kept for ${formatRemainingDuration(response.cacheTtlSec)}.`,
                "success"
              );
            } catch (error) {
              setState(button, action, "error");
              const msg = `Transcript is cached, but clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`;
              button.title = msg;
              showToast(msg, "error");
            }
          } else {
            try {
              await copyTextToClipboard(response.text || "");
              button.title = "Transcript copied to clipboard";
              showToast("Full transcript verified, saved, and copied to clipboard", "success");
            } catch (error) {
              setState(button, action, "error");
              const msg = `Transcript is saved, but clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`;
              button.title = msg;
              showToast(msg, "error");
            }
          }
        } else {
          button.title = `Downloading... (${response.source})`;
          showToast(`Download started (${response.source})`, "success");
        }
        resetLater(button, action);
      })
      .catch((error) => {
        setState(button, action, "error");
        const msg = `Failed: ${error instanceof Error ? error.message : String(error)}`;
        button.title = msg;
        showToast(msg, "error");
        resetLater(button, action);
      });
  });
}

function getAdapterForButton(button) {
  const adapterId = button.dataset.adapterId || "";
  const platform = button.dataset.platform || "";
  return siteAdapters.find((adapter) => adapter.id === adapterId || adapter.platform === platform) || null;
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) {
    throw new Error("Cached transcript is empty.");
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (_error) {
      // Fall through to execCommand for content-script contexts where async
      // clipboard access can be blocked after the extension message round trip.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  document.documentElement.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("document.execCommand('copy') returned false.");
    }
  } finally {
    textarea.remove();
  }
}

function runDebug(button, action) {
  setState(button, action, "loading");
  sendRuntimeMessage({ type: "DEBUG_NATIVE_HOST" }, DEBUG_MESSAGE_TIMEOUT_MS)
    .then((response) => {
      setState(button, action, response?.ok ? "done" : "error");
      const text = response?.ok
        ? `Native host OK\nextensionId: ${response.extensionId}\nmodel: ${response.ping?.model || "unknown"}`
        : `Native host FAIL\nextensionId: ${response?.extensionId || "unknown"}\n${response?.error || "unknown error"}`;
      showToast(text, response?.ok ? "success" : "error", 14000);
      resetLater(button, action);
    })
    .catch((error) => {
      const msg = `Debug failed: ${error instanceof Error ? error.message : String(error)}`;
      setState(button, action, "error");
      button.title = msg;
      showToast(msg, "error", 12000);
      resetLater(button, action);
    });
}

function wireRuntimeHandler() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "XVDL_PROGRESS") {
      showProgressToast(message.stage, message);
      return;
    }

    if (!message || (message.type !== "GET_VISIBLE_VIDEO_CONTEXT" && message.type !== "GET_VISIBLE_VIDEO_TWEET")) {
      return;
    }

    const meta = getVisibleVideoContext();
    sendResponse({
      ok: !!meta?.itemId,
      itemId: meta?.itemId || null,
      itemUrl: meta?.itemUrl || null,
      title: meta?.title || "",
      tweetText: meta?.tweetText || "",
      authorName: meta?.authorName || "",
      authorHandle: meta?.authorHandle || "",
      platform: meta?.platform || "",
      mediaUrl: meta?.mediaUrl || "",
      fileId: meta?.fileId || ""
    });
  });
}

function getVisibleVideoContext() {
  for (const adapter of getActiveAdapters()) {
    const meta = adapter.getVisibleContext?.();
    if (meta?.itemId) {
      return meta;
    }
  }
  return {
    itemId: null,
    itemUrl: null,
    title: "",
    tweetText: "",
    authorName: "",
    authorHandle: "",
    platform: "",
    mediaUrl: "",
    fileId: ""
  };
}

function setState(button, action, state) {
  button.dataset.state = state;
  renderButtonContent(button, action, state);
}

function renderButtonContent(button, action, state) {
  button.innerHTML = renderButtonIcon(action, state);
}

function renderButtonIcon(action, state) {
  if (state === "loading") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>`;
  }

  if (state === "done") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>`;
  }

  if (state === "error") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;
  }

  if (action === "transcript") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16H7z"></path><path d="M9 9h6M9 13h6M9 17h4"></path></svg>`;
  }

  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="M7 11l5 5 5-5"></path><path d="M5 21h14"></path></svg>`;
}

function getButtonTitle(action) {
  return action === "transcript" ? "Transcribe and copy" : "Download video";
}

function formatRemainingDuration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  if (value >= 24 * 60 * 60) {
    const days = Math.max(1, Math.ceil(value / (24 * 60 * 60)));
    return `~${days} ${days === 1 ? "day" : "days"}`;
  }
  if (value >= 60 * 60) {
    const hours = Math.max(1, Math.ceil(value / (60 * 60)));
    return `~${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const minutes = Math.max(1, Math.ceil(value / 60));
  return `~${minutes} min`;
}

function resetLater(button, action) {
  window.setTimeout(() => {
    setState(button, action, "idle");
    button.title = getButtonTitle(action);
  }, 2400);
}

function showProgressToast(stage, details = {}) {
  const toast = PROGRESS_TOASTS[String(stage || "")];
  if (!toast) {
    return;
  }
  const attempt = Number(details.attempt || 0);
  const maxAttempts = Number(details.maxAttempts || 0);
  const suffix = attempt > 1 && maxAttempts > 1 ? ` (${attempt}/${maxAttempts})` : "";
  const text = `${toast.text}${suffix}`;

  if (stage === "transcribing") {
    window.clearTimeout(progressTransitionTimer);
    progressTransitionTimer = window.setTimeout(() => {
      progressTransitionTimer = null;
      showToast(text, toast.kind, PROGRESS_TOAST_DURATION_MS);
    }, 700);
    return;
  }

  showToast(text, toast.kind, PROGRESS_TOAST_DURATION_MS);
}

function showToast(text, kind = "error", durationMs = 6000) {
  if (progressTransitionTimer !== null) {
    window.clearTimeout(progressTransitionTimer);
    progressTransitionTimer = null;
  }

  const existing = document.querySelector(`.${TOAST_CLASS}`);
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = TOAST_CLASS;
  toast.dataset.kind = kind;
  toast.textContent = String(text || "");
  document.documentElement.appendChild(toast);

  window.setTimeout(() => {
    if (toast.isConnected) {
      toast.remove();
    }
  }, durationMs);
}

function sendRuntimeMessage(payload, timeoutMs = getRuntimeMessageTimeoutMs(payload?.type)) {
  const timeout = sanitizeTimeout(timeoutMs, DEFAULT_MESSAGE_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(buildRuntimeTimeoutMessage(payload?.type, timeout)));
    }, timeout);

    chrome.runtime.sendMessage(payload, (response) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function getRuntimeMessageTimeoutMs(type) {
  return type === "TRANSCRIBE_VIDEO_ITEM" ? TRANSCRIPT_MESSAGE_TIMEOUT_MS : DEFAULT_MESSAGE_TIMEOUT_MS;
}

function sanitizeTimeout(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function buildRuntimeTimeoutMessage(type, timeoutMs) {
  const action = type === "TRANSCRIBE_VIDEO_ITEM" ? "transcription" : "extension action";
  return `${action} did not respond within ${formatDuration(timeoutMs)}. The local transcriber may be stuck; check the extension/native-host log and retry.`;
}

function formatDuration(ms) {
  const sec = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  return `${Math.ceil(sec / 60)} min`;
}
