"use strict";

const ACTIONS_CLASS = "xvdl-actions";
const DRIVE_ACTIONS_CLASS = "xvdl-drive-actions";
const BTN_CLASS = "xvdl-btn";
const DRIVE_BTN_CLASS = "xvdl-btn--drive";
const BTN_ROLE = "xvdl-action";
const TOAST_CLASS = "xvdl-toast";
const TASK_STACK_CLASS = "xvdl-task-stack";
const TASK_CARD_CLASS = "xvdl-task-card";
const DEFAULT_MESSAGE_TIMEOUT_MS = 60 * 1000;
const DEBUG_MESSAGE_TIMEOUT_MS = 15 * 1000;
const TRANSCRIPT_MESSAGE_TIMEOUT_MS = 135 * 60 * 1000;

const TRANSCRIPT_STAGES = {
  queued: { text: "Waiting in queue", kind: "queued" },
  downloading: { text: "Downloading audio…", kind: "work" },
  downloaded: { text: "Audio downloaded", kind: "step" },
  "waiting-transcription": { text: "Audio ready — waiting for transcription", kind: "queued" },
  transcribing: { text: "Transcribing…", kind: "work" },
  "invalid-cache": { text: "Refreshing saved transcript…", kind: "step" },
  "retrying-download": { text: "Retrying audio download…", kind: "step" },
  "retrying-transcription": { text: "Retrying transcription…", kind: "step" }
};
const ETA_STAGES = new Set(["downloading", "transcribing"]);
const transcriptTasks = new Map();
let etaTickTimer = null;
let autoCloseTickTimer = null;

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
wireTaskPanelHandler();
document.addEventListener("fullscreenchange", scheduleScan);
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
    .${ACTIONS_CLASS}[data-variant="player"] {
      gap: 0;
      margin: 0;
      flex: 0 0 auto;
    }
    .${ACTIONS_CLASS}[data-variant="player"] .${BTN_CLASS} {
      width: 34px;
      min-width: 34px;
      height: 34px;
      color: #fff;
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
    .${TASK_STACK_CLASS} {
      position: fixed;
      top: 12px;
      right: 16px;
      z-index: 2147483647;
      width: min(390px, calc(100vw - 24px));
      max-height: calc(100dvh - 24px);
      overflow-x: hidden;
      overflow-y: auto;
      display: grid;
      gap: 10px;
      padding: 2px;
      pointer-events: none;
      scrollbar-width: thin;
      scrollbar-color: rgba(113, 118, 123, 0.5) transparent;
    }
    .${TASK_CARD_CLASS} {
      --xvdl-accent: rgb(29, 155, 240);
      pointer-events: auto;
      position: relative;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.13);
      border-radius: 16px;
      padding: 13px;
      color: rgb(231, 233, 234);
      background: rgba(22, 24, 28, 0.94);
      box-shadow: 0 14px 38px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(18px) saturate(120%);
      -webkit-backdrop-filter: blur(18px) saturate(120%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      animation: xvdl-task-enter 240ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .${TASK_CARD_CLASS}[data-kind="done"] { --xvdl-accent: rgb(0, 186, 124); }
    .${TASK_CARD_CLASS}[data-kind="error"] { --xvdl-accent: rgb(244, 33, 46); }
    .${TASK_CARD_CLASS}[data-kind="step"],
    .${TASK_CARD_CLASS}[data-kind="queued"] { --xvdl-accent: rgb(255, 179, 0); }
    .${TASK_CARD_CLASS}::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: var(--xvdl-accent);
    }
    .xvdl-task-head {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 9px;
    }
    .xvdl-task-avatar {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      object-fit: cover;
      background: rgb(47, 51, 54);
    }
    .xvdl-task-avatar-fallback {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: rgb(231, 233, 234);
      font-size: 14px;
      font-weight: 700;
    }
    .xvdl-task-author {
      min-width: 0;
      line-height: 1.2;
    }
    .xvdl-task-author-name {
      display: block;
      overflow: hidden;
      color: rgb(231, 233, 234);
      font-size: 14px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .xvdl-task-author-handle {
      display: block;
      overflow: hidden;
      margin-top: 2px;
      color: rgb(113, 118, 123);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .xvdl-task-auto-close {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: rgb(139, 152, 165);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .xvdl-task-auto-close::before {
      width: 6px;
      height: 6px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: var(--xvdl-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--xvdl-accent) 18%, transparent);
      content: "";
    }
    .xvdl-task-auto-close[hidden] { display: none; }
    .xvdl-task-close,
    .xvdl-task-action {
      appearance: none;
      border: 0;
      color: inherit;
      background: transparent;
      cursor: pointer;
      font: inherit;
    }
    .xvdl-task-close {
      width: 30px;
      height: 30px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: rgb(139, 152, 165);
      transition: color 160ms ease, background-color 160ms ease, transform 160ms ease;
    }
    .xvdl-task-close:hover {
      color: rgb(231, 233, 234);
      background: rgba(255, 255, 255, 0.08);
    }
    .xvdl-task-close:active,
    .xvdl-task-action:active { transform: scale(0.97); }
    .xvdl-task-close svg,
    .xvdl-task-action svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .xvdl-task-post {
      appearance: none;
      display: -webkit-box;
      width: 100%;
      overflow: hidden;
      border: 0;
      padding: 0;
      margin: 11px 0 10px;
      color: rgb(231, 233, 234);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.42;
      text-align: left;
      white-space: pre-wrap;
      word-break: break-word;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 4;
    }
    .xvdl-task-post[data-expanded="true"] {
      display: block;
      overflow: visible;
      -webkit-line-clamp: unset;
    }
    .xvdl-task-post:focus-visible {
      outline: 2px solid rgba(29, 155, 240, 0.65);
      outline-offset: 3px;
      border-radius: 3px;
    }
    .xvdl-task-status {
      display: flex;
      align-items: center;
      gap: 7px;
      min-height: 28px;
      padding-top: 9px;
      border-top: 1px solid rgba(255, 255, 255, 0.09);
      color: rgb(139, 152, 165);
      font-size: 12px;
      font-weight: 600;
    }
    .xvdl-task-status[hidden] { display: none; }
    .xvdl-task-status[hidden] + .xvdl-task-actions { margin-top: 0; }
    .xvdl-task-status-dot {
      width: 7px;
      height: 7px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: var(--xvdl-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--xvdl-accent) 18%, transparent);
    }
    .${TASK_CARD_CLASS}[data-kind="work"] .xvdl-task-status-dot {
      animation: xvdl-task-pulse 1.5s ease-in-out infinite;
    }
    .xvdl-task-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 9px;
    }
    .xvdl-task-actions[hidden] { display: none; }
    .xvdl-task-action {
      min-height: 30px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      padding: 0 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: rgb(231, 233, 234);
      background: rgba(255, 255, 255, 0.055);
      font-size: 12px;
      font-weight: 650;
      transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease;
    }
    .xvdl-task-action:hover {
      border-color: rgba(29, 155, 240, 0.55);
      background: rgba(29, 155, 240, 0.13);
    }
    .xvdl-task-action:disabled {
      cursor: wait;
    }
    .xvdl-task-action:disabled:hover {
      border-color: rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.055);
    }
    .xvdl-task-action[data-task-action="copy"] {
      border-color: rgba(0, 186, 124, 0.32);
      color: rgb(125, 222, 183);
    }
    .xvdl-task-action[data-action-state="done"] {
      border-color: rgba(0, 186, 124, 0.48);
      color: rgb(125, 222, 183);
      background: rgba(0, 186, 124, 0.12);
    }
    .xvdl-task-action[data-action-state="error"] {
      border-color: rgba(244, 33, 46, 0.48);
      color: rgb(255, 127, 136);
      background: rgba(244, 33, 46, 0.1);
    }
    .xvdl-task-action[data-action-state="working"] svg {
      animation: xvdl-task-spin 0.85s linear infinite;
    }
    .xvdl-task-action:focus-visible,
    .xvdl-task-close:focus-visible {
      outline: 2px solid rgba(29, 155, 240, 0.65);
      outline-offset: 2px;
    }
    @keyframes xvdl-task-enter {
      from { opacity: 0; transform: translate3d(18px, 0, 0) scale(0.985); }
      to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
    }
    @keyframes xvdl-task-pulse {
      0%, 100% { opacity: 0.55; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.12); }
    }
    @keyframes xvdl-task-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .${TASK_CARD_CLASS},
      .${TASK_CARD_CLASS}[data-kind="work"] .xvdl-task-status-dot,
      .xvdl-task-action[data-action-state="working"] svg { animation: none; }
    }
    @media (max-width: 720px) {
      .${TASK_STACK_CLASS} {
        top: 10px;
        right: 10px;
        width: calc(100vw - 20px);
        max-height: calc(100dvh - 20px);
      }
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
  button.dataset.avatarUrl = meta.avatarUrl || "";
  button.dataset.platform = meta.platform || "";
  button.dataset.mediaUrl = meta.mediaUrl || "";
  button.dataset.fileId = meta.fileId || "";
  if (adapterId || meta.adapterId) {
    button.dataset.adapterId = adapterId || meta.adapterId;
  }
}

function wireClickHandler() {
  // X's modal player handles clicks inside its control bar and can stop them
  // before they bubble to document. Capture our delegated actions first so
  // the same buttons work in both the timeline and the player overlay.
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
      avatarUrl: meta.avatarUrl || button.dataset.avatarUrl || "",
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
      avatarUrl: payload.avatarUrl,
      platform: payload.platform,
      mediaUrl: payload.mediaUrl,
      fileId: payload.fileId
    }, button.dataset.adapterId || "");

    setState(button, action, "loading");
    if (action === "transcript") {
      upsertTranscriptTask(payload, "downloading");
    }
    sendRuntimeMessage(payload)
      .then(async (response) => {
        recordTemporaryPerfEvent(response, itemId, "content_response_received", {
          cached: response?.cached === true,
          chars: Number(response?.chars || 0)
        });
        if (!response?.ok) {
          setState(button, action, "error");
          const code = response?.code ? ` [${response.code}]` : "";
          const msg = `Failed${code}: ${response?.error || "unknown error"}\nLog: ~/Library/Logs/xvdl-native-host.log`;
          button.title = msg;
          if (action === "transcript") {
            failTranscriptTask(itemId, msg);
          } else {
            showToast(msg, "error");
          }
          resetLater(button, action);
          return;
        }

        setState(button, action, "done");
        if (action === "transcript") {
          completeTranscriptTask(itemId, response.text || "", response.cached === true);
          const slowAsrWarning = response.slowAsr
            ? "Ready · Spokenly was unusually slow — restart it before the next transcript"
            : "";
          recordTemporaryPerfEvent(response, itemId, "content_task_completed");
          if (response.cached) {
            try {
              recordTemporaryPerfEvent(response, itemId, "clipboard_copy_started");
              await copyTextToClipboard(response.text || "");
              recordTemporaryPerfEvent(response, itemId, "clipboard_copy_finished");
              button.title = slowAsrWarning || "Cached transcript copied to clipboard";
              setTranscriptTaskFeedback(itemId, slowAsrWarning || "Transcript ready", 0, slowAsrWarning ? "step" : "done");
            } catch (error) {
              recordTemporaryPerfEvent(response, itemId, "clipboard_copy_failed", {
                message: error instanceof Error ? error.message : String(error)
              });
              const msg = `Transcript is cached, but clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`;
              button.title = msg;
              setTranscriptTaskFeedback(itemId, "Ready · use Copy transcript to try again", 0, "error");
            }
          } else {
            try {
              recordTemporaryPerfEvent(response, itemId, "clipboard_copy_started");
              await copyTextToClipboard(response.text || "");
              recordTemporaryPerfEvent(response, itemId, "clipboard_copy_finished");
              button.title = slowAsrWarning || "Transcript copied to clipboard";
              setTranscriptTaskFeedback(itemId, slowAsrWarning || "Ready · copied to clipboard", 0, slowAsrWarning ? "step" : "done");
            } catch (error) {
              recordTemporaryPerfEvent(response, itemId, "clipboard_copy_failed", {
                message: error instanceof Error ? error.message : String(error)
              });
              const msg = `Transcript is saved, but clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`;
              button.title = msg;
              setTranscriptTaskFeedback(itemId, "Ready · use Copy transcript to try again", 0, "error");
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
        if (action === "transcript") {
          failTranscriptTask(itemId, msg);
        } else {
          showToast(msg, "error");
        }
        resetLater(button, action);
      });
  }, true);
}

// TODO(PRODUCTION): Remove this temporary [DEBUG-XVDL-PERF] reporting path
// together with src/background/diagnostics.js before production release.
function recordTemporaryPerfEvent(response, itemId, event, details = {}) {
  const traceId = String(response?.debugTraceId || "");
  if (!traceId) {
    return;
  }

  try {
    console.info("[DEBUG-XVDL-PERF]", itemId, traceId, event, details);
  } catch (_error) {
    // Diagnostics must never affect the transcript result.
  }
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
      updateTranscriptTaskProgress(message.itemId, message.stage, message);
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
      avatarUrl: meta?.avatarUrl || "",
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
    avatarUrl: "",
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

function resetLater(button, action) {
  window.setTimeout(() => {
    setState(button, action, "idle");
    button.title = getButtonTitle(action);
  }, 2400);
}

function wireTaskPanelHandler() {
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("[data-task-action][data-task-id]")
      : null;
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleTaskPanelAction(target.dataset.taskId || "", target.dataset.taskAction || "");
  });
}

function upsertTranscriptTask(meta, stage = "queued") {
  const itemId = String(meta?.itemId || "");
  if (!itemId) {
    return null;
  }

  let task = transcriptTasks.get(itemId);
  if (!task) {
    task = {
      itemId,
      meta: { ...meta },
      text: "",
      status: "",
      baseStatus: "",
      kind: "queued",
      done: false,
      expanded: false,
      stage: "queued",
      stageStartedAt: 0,
      estimatedTotalMs: 0,
      feedbackTimer: null,
      actionFeedback: null,
      actionFeedbackTimer: null,
      autoCloseAt: 0,
      card: null
    };
    transcriptTasks.set(itemId, task);
  } else {
    task.meta = { ...task.meta, ...meta };
    task.text = "";
    task.done = false;
    task.expanded = false;
    window.clearTimeout(task.feedbackTimer);
    window.clearTimeout(task.actionFeedbackTimer);
    task.actionFeedback = null;
    task.autoCloseAt = 0;
    syncAutoCloseTicker();
  }

  applyTranscriptTaskStage(task, stage);
  renderTranscriptTask(task);
  return task;
}

function updateTranscriptTaskProgress(itemId, stage, details = {}) {
  const task = transcriptTasks.get(String(itemId || ""));
  if (!task) {
    return;
  }

  applyTranscriptTaskStage(task, stage, details);
  renderTranscriptTask(task);
}

function applyTranscriptTaskStage(task, stage, details = {}) {
  const stageInfo = TRANSCRIPT_STAGES[String(stage || "")] || TRANSCRIPT_STAGES.queued;
  const attempt = Number(details.attempt || 0);
  const maxAttempts = Number(details.maxAttempts || 0);
  const suffix = attempt > 1 && maxAttempts > 1 ? ` (${attempt}/${maxAttempts})` : "";
  task.stage = String(stage || "queued");
  task.stageStartedAt = Date.now();
  task.estimatedTotalMs = Math.max(0, Number(details.estimatedTotalMs || 0));
  task.baseStatus = `${stageInfo.text}${suffix}`;
  task.status = formatTaskStatus(task);
  task.kind = stageInfo.kind;
  syncEtaTicker();
}

function completeTranscriptTask(itemId, text, cached) {
  const task = transcriptTasks.get(String(itemId || ""));
  if (!task) {
    return;
  }

  task.text = String(text || "");
  task.status = cached ? "Saved transcript ready" : "Transcript ready";
  task.kind = "done";
  task.done = true;
  task.stage = "done";
  task.estimatedTotalMs = 0;
  syncEtaTicker();
  renderTranscriptTask(task);
  scheduleTaskAutoClose(task);
}

function failTranscriptTask(itemId, message) {
  const task = transcriptTasks.get(String(itemId || ""));
  if (!task) {
    return;
  }

  task.status = String(message || "Transcription failed").replace(/^Failed(?: \[[^\]]+\])?:\s*/i, "");
  task.kind = "error";
  task.done = false;
  task.stage = "error";
  task.estimatedTotalMs = 0;
  syncEtaTicker();
  renderTranscriptTask(task);
}

function setTranscriptTaskFeedback(itemId, text, restoreAfterMs = 0, kind = "done") {
  const task = transcriptTasks.get(String(itemId || ""));
  if (!task) {
    return;
  }

  window.clearTimeout(task.feedbackTimer);
  task.status = String(text || "");
  task.kind = kind;
  renderTranscriptTask(task);

  if (restoreAfterMs > 0) {
    task.feedbackTimer = window.setTimeout(() => {
      if (!transcriptTasks.has(task.itemId)) {
        return;
      }
      task.status = "Transcript ready";
      task.kind = "done";
      renderTranscriptTask(task);
    }, restoreAfterMs);
  }
}

function formatTaskStatus(task, now = Date.now()) {
  if (!ETA_STAGES.has(task.stage) || task.estimatedTotalMs <= 0) {
    return task.baseStatus;
  }
  const elapsedMs = Math.max(0, now - task.stageStartedAt);
  if (task.stage === "transcribing" && elapsedMs > task.estimatedTotalMs * 3) {
    return "Spokenly is unusually slow — restart Spokenly before retrying";
  }
  const remainingMs = task.estimatedTotalMs - elapsedMs;
  if (remainingMs <= 0) {
    return `${task.baseStatus} (finishing…)`;
  }
  return `${task.baseStatus} (~${formatEtaDuration(remainingMs)} left)`;
}

function formatEtaDuration(milliseconds) {
  const seconds = Math.max(1, Math.ceil(Number(milliseconds || 0) / 1000));
  if (seconds < 90) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function syncEtaTicker() {
  const hasActiveEta = Array.from(transcriptTasks.values()).some((task) => {
    return ETA_STAGES.has(task.stage) && task.estimatedTotalMs > 0;
  });
  if (hasActiveEta && etaTickTimer === null) {
    etaTickTimer = window.setInterval(updateEtaCountdowns, 1000);
    return;
  }
  if (!hasActiveEta && etaTickTimer !== null) {
    window.clearInterval(etaTickTimer);
    etaTickTimer = null;
  }
}

function updateEtaCountdowns() {
  const now = Date.now();
  for (const task of transcriptTasks.values()) {
    if (!ETA_STAGES.has(task.stage) || task.estimatedTotalMs <= 0) {
      continue;
    }
    const status = formatTaskStatus(task, now);
    if (status === task.status) {
      continue;
    }
    task.status = status;
    const ui = task.card?._xvdlTaskUi;
    if (ui) {
      ui.statusText.textContent = status;
    }
  }
}

async function scheduleTaskAutoClose(task) {
  const data = await chrome.storage.local.get("transcriptSettings").catch(() => ({}));
  if (!transcriptTasks.has(task.itemId) || !task.done) {
    return;
  }
  const rawMinutes = Number(data?.transcriptSettings?.autoCloseMinutes);
  const minutes = rawMinutes === 0
    ? 0
    : Number.isFinite(rawMinutes)
      ? Math.min(7 * 24 * 60, Math.max(1, Math.floor(rawMinutes)))
      : 5;
  if (minutes === 0) {
    return;
  }
  task.autoCloseAt = Date.now() + minutes * 60 * 1000;
  renderTranscriptTask(task);
  syncAutoCloseTicker();
}

function formatAutoCloseStatus(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Closes in ${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function syncAutoCloseTicker() {
  const hasCountdown = Array.from(transcriptTasks.values()).some((task) => task.autoCloseAt > 0);
  if (hasCountdown && autoCloseTickTimer === null) {
    autoCloseTickTimer = window.setInterval(updateAutoCloseCountdowns, 1000);
    return;
  }
  if (!hasCountdown && autoCloseTickTimer !== null) {
    window.clearInterval(autoCloseTickTimer);
    autoCloseTickTimer = null;
  }
}

function updateAutoCloseCountdowns() {
  const now = Date.now();
  for (const task of Array.from(transcriptTasks.values())) {
    if (task.autoCloseAt <= 0) {
      continue;
    }
    if (now >= task.autoCloseAt) {
      removeTranscriptTask(task);
      continue;
    }
    const ui = task.card?._xvdlTaskUi;
    if (ui) {
      ui.autoCloseText.textContent = formatAutoCloseStatus(task.autoCloseAt - now);
    }
  }
  syncAutoCloseTicker();
}

function renderTranscriptTask(task) {
  const stack = ensureTaskStack();
  if (!task.card) {
    task.card = createTranscriptTaskCard(task.itemId);
    stack.appendChild(task.card);
  }

  const ui = task.card._xvdlTaskUi;
  task.card.dataset.kind = task.kind;
  ui.authorName.textContent = task.meta.authorName || getTaskFallbackTitle(task.meta);
  ui.authorHandle.textContent = task.meta.authorHandle || getTaskFallbackHandle(task.meta);
  ui.post.textContent = task.meta.tweetText || task.meta.title || "Video transcript";
  ui.post.dataset.expanded = String(task.expanded === true);
  ui.post.setAttribute("aria-expanded", String(task.expanded === true));
  const postActionLabel = task.expanded ? "Collapse post text" : "Expand full post text";
  ui.post.title = postActionLabel;
  ui.post.setAttribute("aria-label", postActionLabel);
  const showAutoClose = task.done && task.autoCloseAt > 0;
  ui.autoCloseText.hidden = !showAutoClose;
  ui.autoCloseText.textContent = showAutoClose
    ? formatAutoCloseStatus(task.autoCloseAt - Date.now())
    : "";
  ui.statusText.textContent = task.status;
  ui.status.hidden = task.done && task.kind === "done";
  syncTaskAvatar(ui.avatarSlot, task.meta);
  renderTaskActions(ui.actions, task);
}

function ensureTaskStack() {
  let stack = document.querySelector(`.${TASK_STACK_CLASS}`);
  if (stack) {
    return stack;
  }

  stack = document.createElement("aside");
  stack.className = TASK_STACK_CLASS;
  stack.setAttribute("aria-label", "Transcription tasks");
  stack.setAttribute("aria-live", "polite");
  document.documentElement.appendChild(stack);
  return stack;
}

function createTranscriptTaskCard(itemId) {
  const card = document.createElement("section");
  card.className = TASK_CARD_CLASS;
  card.dataset.taskId = itemId;

  const head = document.createElement("div");
  head.className = "xvdl-task-head";

  const avatarSlot = document.createElement("div");
  const author = document.createElement("div");
  author.className = "xvdl-task-author";
  const authorName = document.createElement("span");
  authorName.className = "xvdl-task-author-name";
  const authorHandle = document.createElement("span");
  authorHandle.className = "xvdl-task-author-handle";
  author.append(authorName, authorHandle);

  const autoCloseText = document.createElement("span");
  autoCloseText.className = "xvdl-task-auto-close";
  autoCloseText.hidden = true;

  const close = createTaskButton(itemId, "close", "Close task", renderTaskActionIcon("close"));
  close.className = "xvdl-task-close";
  head.append(avatarSlot, author, autoCloseText, close);

  const post = document.createElement("button");
  post.type = "button";
  post.className = "xvdl-task-post";
  post.dataset.taskId = itemId;
  post.dataset.taskAction = "toggle-post";
  post.setAttribute("aria-label", "Expand full post text");

  const status = document.createElement("div");
  status.className = "xvdl-task-status";
  const statusDot = document.createElement("span");
  statusDot.className = "xvdl-task-status-dot";
  statusDot.setAttribute("aria-hidden", "true");
  const statusText = document.createElement("span");
  status.append(statusDot, statusText);

  const actions = document.createElement("div");
  actions.className = "xvdl-task-actions";
  card.append(head, post, status, actions);
  card._xvdlTaskUi = { avatarSlot, authorName, authorHandle, autoCloseText, post, status, statusText, actions };
  return card;
}

function syncTaskAvatar(slot, meta) {
  const safeUrl = getSafeImageUrl(meta?.avatarUrl);
  const current = slot.firstElementChild;
  if (safeUrl && current instanceof HTMLImageElement && current.src === safeUrl) {
    return;
  }

  slot.replaceChildren();
  if (safeUrl) {
    const image = document.createElement("img");
    image.className = "xvdl-task-avatar";
    image.src = safeUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      if (image.isConnected) {
        slot.replaceChildren(createTaskAvatarFallback(meta));
      }
    }, { once: true });
    slot.appendChild(image);
    return;
  }

  slot.appendChild(createTaskAvatarFallback(meta));
}

function createTaskAvatarFallback(meta) {
  const fallback = document.createElement("span");
  fallback.className = "xvdl-task-avatar xvdl-task-avatar-fallback";
  const source = String(meta?.authorName || meta?.authorHandle || meta?.platform || "V").replace(/^@/, "");
  fallback.textContent = source.trim().charAt(0).toUpperCase() || "V";
  fallback.setAttribute("aria-hidden", "true");
  return fallback;
}

function getSafeImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function getTaskFallbackTitle(meta) {
  return meta?.platform === "gdrive" ? "Google Drive" : "X post";
}

function getTaskFallbackHandle(meta) {
  return meta?.platform === "gdrive" ? "Video transcript" : "@x";
}

function renderTaskActions(container, task) {
  const buttons = [];
  if (task.done) {
    buttons.push(createTaskFeedbackButton(task, "copy"));
    buttons.push(createTaskFeedbackButton(task, "download"));
  }
  if (task.meta.itemUrl) {
    buttons.push(createTaskButton(task.itemId, "open", "Open original post", renderTaskActionIcon("open"), "Open post"));
  }
  container.replaceChildren(...buttons);
  container.hidden = buttons.length === 0;
}

function createTaskFeedbackButton(task, action) {
  const feedback = task.actionFeedback?.action === action ? task.actionFeedback.state : "idle";
  const content = {
    copy: {
      idle: ["Copy transcript", "Copy", "copy"],
      working: ["Copying transcript", "Copying…", "working"],
      done: ["Copied to clipboard", "Copied", "done"],
      error: ["Copy failed", "Failed", "error"]
    },
    download: {
      idle: ["Download transcript", "Download", "download"],
      working: ["Starting transcript download", "Starting…", "working"],
      done: ["Transcript download started", "Started", "done"],
      error: ["Download failed", "Failed", "error"]
    }
  }[action][feedback];
  const button = createTaskButton(task.itemId, action, content[0], renderTaskActionIcon(content[2]), content[1]);
  button.dataset.actionState = feedback;
  button.disabled = task.actionFeedback?.state === "working";
  return button;
}

function setTaskActionFeedback(task, action, state, restoreAfterMs = 0) {
  window.clearTimeout(task.actionFeedbackTimer);
  task.actionFeedback = { action, state };
  const actions = task.card?._xvdlTaskUi?.actions;
  if (actions) {
    renderTaskActions(actions, task);
  }

  if (restoreAfterMs > 0) {
    task.actionFeedbackTimer = window.setTimeout(() => {
      if (!transcriptTasks.has(task.itemId)) {
        return;
      }
      task.actionFeedback = null;
      const currentActions = task.card?._xvdlTaskUi?.actions;
      if (currentActions) {
        renderTaskActions(currentActions, task);
      }
    }, restoreAfterMs);
  }
}

function createTaskButton(itemId, action, title, icon, label = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "xvdl-task-action";
  button.dataset.taskId = itemId;
  button.dataset.taskAction = action;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = icon;
  if (label) {
    const text = document.createElement("span");
    text.textContent = label;
    button.appendChild(text);
  }
  return button;
}

function renderTaskActionIcon(action) {
  if (action === "working") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"></path></svg>';
  }
  if (action === "done") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
  }
  if (action === "error") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>';
  }
  if (action === "copy") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';
  }
  if (action === "download") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"></path><path d="m7 10 5 5 5-5"></path><path d="M5 20h14"></path></svg>';
  }
  if (action === "open") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5"></path><path d="m19 5-9 9"></path><path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"></path></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"></path></svg>';
}

async function handleTaskPanelAction(itemId, action) {
  const task = transcriptTasks.get(String(itemId || ""));
  if (!task) {
    return;
  }

  if (action === "toggle-post") {
    task.expanded = !task.expanded;
    renderTranscriptTask(task);
    return;
  }

  if (action === "close") {
    removeTranscriptTask(task);
    return;
  }

  if (action === "open") {
    window.open(task.meta.itemUrl, "_blank", "noopener,noreferrer");
    return;
  }

  if (!task.done) {
    return;
  }

  try {
    if (action === "copy") {
      setTaskActionFeedback(task, "copy", "working");
      const text = task.text || await fetchTranscriptTaskText(task);
      await copyTextToClipboard(text);
      task.text = text;
      setTaskActionFeedback(task, "copy", "done", 1800);
      return;
    }

    if (action === "download") {
      setTaskActionFeedback(task, "download", "working");
      const response = await sendRuntimeMessage({
        type: "DOWNLOAD_ITEM_TRANSCRIPT",
        itemId: task.itemId,
        itemUrl: task.meta.itemUrl || "",
        title: task.meta.title || "",
        tweetText: task.meta.tweetText || "",
        authorName: task.meta.authorName || "",
        authorHandle: task.meta.authorHandle || "",
        platform: task.meta.platform || ""
      });
      if (!response?.ok) {
        throw new Error(response?.error || "Could not download transcript.");
      }
      setTaskActionFeedback(task, "download", "done", 1800);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (action === "copy" || action === "download") {
      setTaskActionFeedback(task, action, "error", 2400);
    }
    setTranscriptTaskFeedback(task.itemId, message || "Action failed", 2600, "error");
  }
}

function removeTranscriptTask(task) {
  window.clearTimeout(task.feedbackTimer);
  window.clearTimeout(task.actionFeedbackTimer);
  task.autoCloseAt = 0;
  task.card?.remove();
  transcriptTasks.delete(task.itemId);
  syncEtaTicker();
  syncAutoCloseTicker();
  const stack = document.querySelector(`.${TASK_STACK_CLASS}`);
  if (stack && !transcriptTasks.size) {
    stack.remove();
  }
}

async function fetchTranscriptTaskText(task) {
  const response = await sendRuntimeMessage({
    type: "GET_TRANSCRIPT_FOR_ITEM",
    itemId: task.itemId,
    itemUrl: task.meta.itemUrl || "",
    platform: task.meta.platform || ""
  });
  if (!response?.ok || !response.text) {
    throw new Error(response?.error || "Saved transcript is unavailable.");
  }
  return String(response.text);
}

function showToast(text, kind = "error", durationMs = 6000) {
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
