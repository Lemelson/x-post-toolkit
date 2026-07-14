"use strict";

import {
  ITEM_PREFIX_DRIVE,
  ITEM_PREFIX_X,
  extractDriveFileId,
  extractTweetId,
  makeTweetUrl
} from "./src/background/context.js";

const pageInfoEl = document.getElementById("pageInfo");
const statusEl = document.getElementById("status");
const historyEl = document.getElementById("history");
const transcribeBtn = document.getElementById("transcribeBtn");
const downloadVideoBtn = document.getElementById("downloadVideoBtn");
const downloadTxtBtn = document.getElementById("downloadTxtBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyLimitInput = document.getElementById("historyLimit");
const retentionValueInput = document.getElementById("retentionValue");
const retentionUnitSelect = document.getElementById("retentionUnit");
const includeTitleInput = document.getElementById("includeTitleInput");
const timestampModeSelect = document.getElementById("timestampModeSelect");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

const DEFAULT_MESSAGE_TIMEOUT_MS = 30 * 1000;
const TRANSCRIPT_MESSAGE_TIMEOUT_MS = 135 * 60 * 1000;
const DOWNLOAD_MESSAGE_TIMEOUT_MS = 60 * 1000;

let currentItemId = null;
let currentItemUrl = null;
let currentItemTitle = "";
let currentTweetText = "";
let currentAuthorName = "";
let currentAuthorHandle = "";
let currentPlatform = "";
let currentMediaUrl = "";
let currentFileId = "";
let hasCurrentTranscript = false;
let isBusy = false;

boot();

async function boot() {
  await resolveCurrentItem();
  await refreshState();
  bindEvents();
}

function bindEvents() {
  transcribeBtn.addEventListener("click", async () => {
    if (!currentItemId || isBusy) {
      return;
    }

    await runBusyAction(async () => {
      setStatus(`Transcribing ${formatDisplayId(currentItemId)}...`);
      const response = await sendMessage({
        type: "TRANSCRIBE_VIDEO_ITEM",
        itemId: currentItemId,
        itemUrl: currentItemUrl || "",
        title: currentItemTitle || "",
        tweetText: currentTweetText || "",
        authorName: currentAuthorName || "",
        authorHandle: currentAuthorHandle || "",
        platform: currentPlatform || "",
        mediaUrl: currentMediaUrl || "",
        fileId: currentFileId || ""
      });

      if (!response?.ok) {
        const code = response?.code ? ` [${response.code}]` : "";
        throw new Error(`${response?.error || "Transcription failed."}${code}`);
      }

      if (response.cached) {
        await copyTextToClipboard(response.text || "");
        setStatus(
          `Verified saved transcript copied. Kept for ${formatRemainingDuration(response.cacheTtlSec)}.`,
          "good"
        );
      } else {
        await copyTextToClipboard(response.text || "");
        setStatus("Full transcript verified, saved, and copied to clipboard.", "good");
      }

      await refreshState();
    });
  });

  downloadVideoBtn.addEventListener("click", async () => {
    if (!currentItemId || isBusy) {
      return;
    }

    await runBusyAction(async () => {
      setStatus(`Starting video download for ${formatDisplayId(currentItemId)}...`);
      const response = await sendMessage({
        type: "DOWNLOAD_VIDEO_ITEM",
        itemId: currentItemId,
        itemUrl: currentItemUrl || "",
        title: currentItemTitle || "",
        tweetText: currentTweetText || "",
        authorName: currentAuthorName || "",
        authorHandle: currentAuthorHandle || "",
        platform: currentPlatform || "",
        mediaUrl: currentMediaUrl || "",
        fileId: currentFileId || ""
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Video download failed.");
      }

      setStatus("Video download started.", "good");
    });
  });

  downloadTxtBtn.addEventListener("click", async () => {
    if (!currentItemId || isBusy) {
      return;
    }

    await runBusyAction(async () => {
      const response = await sendMessage({
        type: "DOWNLOAD_ITEM_TRANSCRIPT",
        itemId: currentItemId,
        itemUrl: currentItemUrl || "",
        platform: currentPlatform || "",
        fileId: currentFileId || ""
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Transcript download failed.");
      }

      setStatus("Transcript .txt download started.", "good");
    });
  });

  clearHistoryBtn.addEventListener("click", async () => {
    if (isBusy) {
      return;
    }

    await runBusyAction(async () => {
      const response = await sendMessage({ type: "CLEAR_TRANSCRIPT_HISTORY" });
      if (!response?.ok) {
        throw new Error(response?.error || "Failed to clear history.");
      }

      setStatus("History cleared.", "good");
      await refreshState();
    });
  });

  saveSettingsBtn.addEventListener("click", async () => {
    if (isBusy) {
      return;
    }

    await runBusyAction(async () => {
      const maxItems = clampInt(historyLimitInput.value, 1, 200, 10);
      const rawRetention = clampInt(retentionValueInput.value, 1, 30, 3);
      const unit = retentionUnitSelect.value === "hours" ? "hours" : "days";
      const retentionHours = unit === "hours" ? rawRetention : rawRetention * 24;

      const response = await sendMessage({
        type: "UPDATE_TRANSCRIPT_SETTINGS",
        settings: {
          maxItems,
          retentionHours,
          includeTitle: includeTitleInput.checked,
          timestampMode: timestampModeSelect.value
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Failed to save settings.");
      }

      setStatus("Settings saved.", "good");
      await refreshState();
    });
  });
}

async function resolveCurrentItem() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) {
    clearCurrentItem("Current page: unavailable");
    return;
  }

  const fromUrl = extractContextFromUrl(tab.url);
  const visibleMeta = await askPageForVisibleVideoContext(tab.id);
  const resolved = visibleMeta?.itemId ? visibleMeta : fromUrl;

  if (!resolved?.itemId) {
    clearCurrentItem("Current page: no supported video found");
    return;
  }

  currentItemId = resolved.itemId;
  currentItemUrl = resolved.itemUrl || tab.url;
  currentItemTitle = String(resolved.title || "");
  currentTweetText = String(resolved.tweetText || "");
  currentAuthorName = String(resolved.authorName || "");
  currentAuthorHandle = String(resolved.authorHandle || "");
  currentPlatform = resolved.platform || detectPlatformFromId(resolved.itemId);
  currentMediaUrl = String(resolved.mediaUrl || "");
  currentFileId = String(resolved.fileId || "");

  const platformLabel = currentPlatform === "gdrive" ? "Google Drive" : "X";
  const displayId = formatDisplayId(currentItemId);
  pageInfoEl.textContent = `Current video: ${platformLabel} • ${displayId}`;
}

function clearCurrentItem(text) {
  currentItemId = null;
  currentItemUrl = null;
  currentItemTitle = "";
  currentTweetText = "";
  currentAuthorName = "";
  currentAuthorHandle = "";
  currentPlatform = "";
  currentMediaUrl = "";
  currentFileId = "";
  pageInfoEl.textContent = text;
}

async function refreshState() {
  const state = await sendMessage({
    type: "GET_POPUP_STATE",
    itemId: currentItemId || "",
    itemUrl: currentItemUrl || "",
    platform: currentPlatform || ""
  });

  if (!state?.ok) {
    setStatus(state?.error || "Failed to load popup state.", "bad");
    return;
  }

  renderSettings(state.settings || {});
  renderHistory(state.history || []);

  hasCurrentTranscript = !!state.current;
  transcribeBtn.textContent = hasCurrentTranscript ? "Copy Existing Transcript" : "Transcript Current";
  applyButtonAvailability();
}

function applyButtonAvailability() {
  transcribeBtn.disabled = !currentItemId || isBusy;
  downloadVideoBtn.disabled = !currentItemId || isBusy;
  downloadTxtBtn.disabled = !currentItemId || !hasCurrentTranscript || isBusy;
  clearHistoryBtn.disabled = isBusy;
  saveSettingsBtn.disabled = isBusy;
}

function renderSettings(settings) {
  const maxItems = clampInt(settings?.maxItems, 1, 200, 10);
  const retentionHours = clampInt(settings?.retentionHours, 1, 24 * 30, 24 * 7);

  historyLimitInput.value = String(maxItems);
  includeTitleInput.checked = settings?.includeTitle !== false;

  const mode = String(settings?.timestampMode || "off");
  const knownMode = Array.from(timestampModeSelect.options).some((option) => option.value === mode);
  timestampModeSelect.value = knownMode ? mode : "off";

  if (retentionHours % 24 === 0) {
    retentionValueInput.value = String(Math.max(1, Math.floor(retentionHours / 24)));
    retentionUnitSelect.value = "days";
  } else {
    retentionValueInput.value = String(retentionHours);
    retentionUnitSelect.value = "hours";
  }
}

function renderHistory(items) {
  historyEl.textContent = "";

  if (!items.length) {
    historyEl.textContent = "No transcripts yet.";
    return;
  }

  for (const item of items) {
    const wrapper = document.createElement("div");
    wrapper.className = "item";

    const title = document.createElement("div");
    title.className = "title-snippet";
    title.textContent = item.title || item.preview || "(no title)";
    wrapper.appendChild(title);

    const row = document.createElement("div");
    row.className = "row";

    const when = document.createElement("div");
    when.className = "age";
    when.textContent = `${formatAge(item.updatedAt)} • ${formatDateTime(item.updatedAt)}`;

    const id = document.createElement("div");
    id.className = "id";
    id.textContent = formatDisplayId(item.itemId);

    row.appendChild(when);
    row.appendChild(id);
    wrapper.appendChild(row);

    const preview = document.createElement("div");
    preview.className = "preview";
    preview.textContent = item.preview || "(no preview)";
    wrapper.appendChild(preview);

    const actions = document.createElement("div");
    actions.className = "actions";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.title = "Copy transcript (uses your output settings)";
    copyBtn.addEventListener("click", () => copyHistoryItem(item.itemId, item.itemUrl, item.platform, "default"));
    actions.appendChild(copyBtn);

    if (item.hasTimestamps) {
      const tsBtn = document.createElement("button");
      tsBtn.textContent = "⏱ Copy";
      tsBtn.title = "Copy transcript with timecodes";
      tsBtn.addEventListener("click", () => copyHistoryItem(item.itemId, item.itemUrl, item.platform, "timestamps"));
      actions.appendChild(tsBtn);
    }

    const txtBtn = document.createElement("button");
    txtBtn.textContent = "TXT";
    txtBtn.title = "Download .txt (uses your output settings)";
    txtBtn.addEventListener("click", () => downloadHistoryItem(item.itemId, item.itemUrl, item.platform, "default"));
    actions.appendChild(txtBtn);

    if (item.hasTimestamps) {
      const srtBtn = document.createElement("button");
      srtBtn.textContent = "SRT";
      srtBtn.title = "Download subtitles (.srt)";
      srtBtn.addEventListener("click", () => downloadHistoryItem(item.itemId, item.itemUrl, item.platform, "srt"));
      actions.appendChild(srtBtn);
    }

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => openHistoryItem(item.itemUrl));
    actions.appendChild(openBtn);

    const linkBtn = document.createElement("button");
    linkBtn.textContent = "Link";
    linkBtn.addEventListener("click", () => copyHistoryLink(item.itemUrl));
    actions.appendChild(linkBtn);

    wrapper.appendChild(actions);
    historyEl.appendChild(wrapper);
  }
}

async function copyHistoryItem(itemId, itemUrl, platform, format = "default") {
  await runBusyAction(async () => {
    const response = await sendMessage({
      type: "GET_TRANSCRIPT_FOR_ITEM",
      itemId,
      itemUrl: itemUrl || "",
      platform: platform || detectPlatformFromId(itemId),
      format
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Transcript not found.");
    }

    await copyTextToClipboard(response.text || "");
    const label = format === "timestamps" ? "timestamped transcript" : "transcript";
    setStatus(`Copied ${label} for ${formatDisplayId(itemId)}.`, "good");
  });
}

async function downloadHistoryItem(itemId, itemUrl, platform, format = "default") {
  await runBusyAction(async () => {
    const response = await sendMessage({
      type: "DOWNLOAD_ITEM_TRANSCRIPT",
      itemId,
      itemUrl: itemUrl || "",
      platform: platform || detectPlatformFromId(itemId),
      format
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Transcript download failed.");
    }

    const label = format === "srt" ? "subtitles" : "transcript";
    setStatus(`Downloading ${label} for ${formatDisplayId(itemId)}.`, "good");
  });
}

async function openHistoryItem(itemUrl) {
  await runBusyAction(async () => {
    const url = String(itemUrl || "");
    if (!url) {
      throw new Error("Source link is unavailable.");
    }

    await chrome.tabs.create({ url });
    setStatus("Opened source page.", "good");
  });
}

async function copyHistoryLink(itemUrl) {
  await runBusyAction(async () => {
    const url = String(itemUrl || "");
    if (!url) {
      throw new Error("Source link is unavailable.");
    }

    await copyTextToClipboard(url);
    setStatus("Source link copied.", "good");
  });
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) {
    throw new Error("Nothing to copy.");
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
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

function formatDisplayId(itemId) {
  const text = String(itemId || "");
  if (text.startsWith(ITEM_PREFIX_DRIVE)) {
    return `drive:${text.slice(ITEM_PREFIX_DRIVE.length).slice(0, 12)}`;
  }
  if (text.startsWith(ITEM_PREFIX_X)) {
    return text.slice(ITEM_PREFIX_X.length);
  }
  return text || "unknown";
}

function detectPlatformFromId(itemId) {
  const text = String(itemId || "");
  if (text.startsWith(ITEM_PREFIX_DRIVE)) {
    return "gdrive";
  }
  return "x";
}

function extractContextFromUrl(rawUrl) {
  const url = String(rawUrl || "");
  const driveId = extractDriveFileId(url);
  if (driveId) {
    return {
      itemId: `${ITEM_PREFIX_DRIVE}${driveId}`,
      itemUrl: url,
      title: "",
      tweetText: "",
      authorName: "",
      authorHandle: "",
      platform: "gdrive",
      mediaUrl: ""
    };
  }

  const tweetId = extractTweetId(url);
  if (tweetId) {
    return {
      itemId: `${ITEM_PREFIX_X}${tweetId}`,
      itemUrl: makeTweetUrl(tweetId),
      title: "",
      tweetText: "",
      authorName: "",
      authorHandle: "",
      platform: "x",
      mediaUrl: ""
    };
  }

  return null;
}

async function runBusyAction(fn) {
  if (isBusy) {
    return;
  }

  setBusy(true);
  try {
    await fn();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "bad");
  } finally {
    setBusy(false);
  }
}

function setBusy(next) {
  isBusy = !!next;
  applyButtonAvailability();
}

function setStatus(text, kind = "") {
  statusEl.textContent = text || "";
  statusEl.classList.remove("good", "bad");
  if (kind) {
    statusEl.classList.add(kind);
  }
}

function formatAge(ts) {
  const n = Number(ts || 0);
  if (!n) {
    return "";
  }

  const sec = Math.max(1, Math.floor((Date.now() - n) / 1000));
  if (sec < 60) {
    return `${sec}s ago`;
  }

  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }

  const hrs = Math.floor(min / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }

  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDateTime(ts) {
  const n = Number(ts || 0);
  if (!n) {
    return "";
  }

  return new Date(n).toLocaleString();
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

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }

  const i = Math.floor(n);
  return Math.min(max, Math.max(min, i));
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function askPageForVisibleVideoContext(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GET_VISIBLE_VIDEO_CONTEXT" });
    return response?.ok ? response : null;
  } catch (_error) {
    return null;
  }
}

async function sendMessage(message) {
  const timeout = getRuntimeMessageTimeoutMs(message?.type);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(buildRuntimeTimeoutMessage(message?.type, timeout)));
    }, timeout);

    chrome.runtime.sendMessage(message, (response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function getRuntimeMessageTimeoutMs(type) {
  if (
    type === "TRANSCRIBE_VIDEO_ITEM" ||
    type === "TRANSCRIBE_TWEET_VIDEO" ||
    type === "TRANSCRIBE_PAGE_VIDEO"
  ) {
    return TRANSCRIPT_MESSAGE_TIMEOUT_MS;
  }

  if (
    type === "DOWNLOAD_VIDEO_ITEM" ||
    type === "DOWNLOAD_TWEET_VIDEO" ||
    type === "DOWNLOAD_PAGE_VIDEO" ||
    type === "DOWNLOAD_ITEM_TRANSCRIPT" ||
    type === "DOWNLOAD_TWEET_TRANSCRIPT"
  ) {
    return DOWNLOAD_MESSAGE_TIMEOUT_MS;
  }

  return DEFAULT_MESSAGE_TIMEOUT_MS;
}

function buildRuntimeTimeoutMessage(type, timeoutMs) {
  const action = String(type || "").includes("TRANSCRIBE") ? "Transcription" : "Extension action";
  return `${action} did not respond within ${formatDuration(timeoutMs)}. The local transcriber may be stuck; check the extension/native-host log and retry.`;
}

function formatDuration(ms) {
  const sec = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  return `${Math.ceil(sec / 60)} min`;
}
