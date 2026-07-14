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
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

let currentItemId = null;
let currentItemUrl = null;
let currentItemTitle = "";
let currentPlatform = "";
let currentMediaUrl = "";
let currentFileId = "";
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
        platform: currentPlatform || "",
        mediaUrl: currentMediaUrl || "",
        fileId: currentFileId || ""
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Transcription failed.");
      }

      if (response.cached) {
        const ttlMin = Math.max(1, Math.ceil(Number(response.cacheTtlSec || 0) / 60));
        await copyTextToClipboard(response.text || "");
        setStatus(`Cached transcript copied to clipboard. Cache still active for ~${ttlMin} min.`, "good");
      } else {
        setStatus("Transcript copied to clipboard.", "good");
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
          retentionHours
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

  transcribeBtn.disabled = !currentItemId || isBusy;
  downloadVideoBtn.disabled = !currentItemId || isBusy;
  downloadTxtBtn.disabled = !currentItemId || !state.current || isBusy;
  clearHistoryBtn.disabled = isBusy;
  saveSettingsBtn.disabled = isBusy;
}

function renderSettings(settings) {
  const maxItems = clampInt(settings?.maxItems, 1, 200, 10);
  const retentionHours = clampInt(settings?.retentionHours, 1, 24 * 30, 72);

  historyLimitInput.value = String(maxItems);

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
    copyBtn.addEventListener("click", () => copyHistoryItem(item.itemId, item.itemUrl, item.platform));

    const txtBtn = document.createElement("button");
    txtBtn.textContent = "TXT";
    txtBtn.addEventListener("click", () => downloadHistoryItem(item.itemId, item.itemUrl, item.platform));

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => openHistoryItem(item.itemUrl));

    const linkBtn = document.createElement("button");
    linkBtn.textContent = "Link";
    linkBtn.addEventListener("click", () => copyHistoryLink(item.itemUrl));

    actions.appendChild(copyBtn);
    actions.appendChild(txtBtn);
    actions.appendChild(openBtn);
    actions.appendChild(linkBtn);

    wrapper.appendChild(actions);
    historyEl.appendChild(wrapper);
  }
}

async function copyHistoryItem(itemId, itemUrl, platform) {
  await runBusyAction(async () => {
    const response = await sendMessage({
      type: "GET_TRANSCRIPT_FOR_ITEM",
      itemId,
      itemUrl: itemUrl || "",
      platform: platform || detectPlatformFromId(itemId)
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Transcript not found.");
    }

    await copyTextToClipboard(response.text || "");
    setStatus(`Copied transcript for ${formatDisplayId(itemId)}.`, "good");
  });
}

async function downloadHistoryItem(itemId, itemUrl, platform) {
  await runBusyAction(async () => {
    const response = await sendMessage({
      type: "DOWNLOAD_ITEM_TRANSCRIPT",
      itemId,
      itemUrl: itemUrl || "",
      platform: platform || detectPlatformFromId(itemId)
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Transcript download failed.");
    }

    setStatus(`Downloading transcript for ${formatDisplayId(itemId)}.`, "good");
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
  transcribeBtn.disabled = isBusy || !currentItemId;
  downloadVideoBtn.disabled = isBusy || !currentItemId;
  downloadTxtBtn.disabled = isBusy || !currentItemId;
  clearHistoryBtn.disabled = isBusy;
  saveSettingsBtn.disabled = isBusy;
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
  return chrome.runtime.sendMessage(message);
}
