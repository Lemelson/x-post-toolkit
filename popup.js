"use strict";

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

let currentTweetId = null;
let currentTweetUrl = null;
let currentTweetText = "";
let isBusy = false;

boot();

async function boot() {
  await resolveCurrentTweet();
  await refreshState();
  bindEvents();
}

function bindEvents() {
  transcribeBtn.addEventListener("click", async () => {
    if (!currentTweetId || isBusy) {
      return;
    }

    await runBusyAction(async () => {
      setStatus(`Transcribing ${currentTweetId}...`);
      const response = await sendMessage({
        type: "TRANSCRIBE_TWEET_VIDEO",
        tweetId: currentTweetId,
        tweetUrl: currentTweetUrl || makeTweetUrl(currentTweetId),
        tweetText: currentTweetText || ""
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Transcription failed.");
      }

      if (response.cached) {
        const ttlMin = Math.max(1, Math.ceil(Number(response.cacheTtlSec || 0) / 60));
        setStatus(`Already transcribed. Cache still active for ~${ttlMin} min.`, "good");
      } else {
        setStatus("Transcript copied to clipboard.", "good");
      }

      await refreshState();
    });
  });

  downloadVideoBtn.addEventListener("click", async () => {
    if (!currentTweetId || isBusy) {
      return;
    }

    await runBusyAction(async () => {
      setStatus(`Starting video download for ${currentTweetId}...`);
      const response = await sendMessage({
        type: "DOWNLOAD_TWEET_VIDEO",
        tweetId: currentTweetId,
        tweetUrl: currentTweetUrl || makeTweetUrl(currentTweetId),
        tweetText: currentTweetText || ""
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Video download failed.");
      }

      setStatus("Video download started.", "good");
    });
  });

  downloadTxtBtn.addEventListener("click", async () => {
    if (!currentTweetId || isBusy) {
      return;
    }

    await runBusyAction(async () => {
      const response = await sendMessage({
        type: "DOWNLOAD_TWEET_TRANSCRIPT",
        tweetId: currentTweetId
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

async function resolveCurrentTweet() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) {
    currentTweetId = null;
    currentTweetUrl = null;
    currentTweetText = "";
    pageInfoEl.textContent = "Current page: unavailable";
    return;
  }

  const fromUrl = extractTweetId(tab.url);
  const visibleMeta = await askPageForVisibleTweetMeta(tab.id);

  if (fromUrl) {
    currentTweetId = fromUrl;
    currentTweetUrl = makeTweetUrl(fromUrl);
    currentTweetText = visibleMeta?.tweetId === fromUrl ? String(visibleMeta.tweetText || "") : "";
    pageInfoEl.textContent = `Current tweet: ${fromUrl}`;
    return;
  }

  if (visibleMeta?.tweetId) {
    currentTweetId = visibleMeta.tweetId;
    currentTweetUrl = visibleMeta.tweetUrl || makeTweetUrl(visibleMeta.tweetId);
    currentTweetText = String(visibleMeta.tweetText || "");
    pageInfoEl.textContent = `Current tweet: ${visibleMeta.tweetId}`;
    return;
  }

  currentTweetId = null;
  currentTweetUrl = null;
  currentTweetText = "";
  pageInfoEl.textContent = "Current page: no visible video tweet found";
}

async function refreshState() {
  const state = await sendMessage({ type: "GET_POPUP_STATE", tweetId: currentTweetId || "" });
  if (!state?.ok) {
    setStatus(state?.error || "Failed to load popup state.", "bad");
    return;
  }

  renderSettings(state.settings || {});
  renderHistory(state.history || []);

  transcribeBtn.disabled = !currentTweetId || isBusy;
  downloadVideoBtn.disabled = !currentTweetId || isBusy;
  downloadTxtBtn.disabled = !currentTweetId || !state.current || isBusy;
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
    title.textContent = item.title || item.preview || "(no post text)";
    wrapper.appendChild(title);

    const row = document.createElement("div");
    row.className = "row";

    const when = document.createElement("div");
    when.className = "age";
    when.textContent = `${formatAge(item.updatedAt)} • ${formatDateTime(item.updatedAt)}`;

    const id = document.createElement("div");
    id.className = "id";
    id.textContent = item.tweetId;

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
    copyBtn.addEventListener("click", () => copyHistoryItem(item.tweetId));

    const txtBtn = document.createElement("button");
    txtBtn.textContent = "TXT";
    txtBtn.addEventListener("click", () => downloadHistoryItem(item.tweetId));

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => openHistoryItem(item.tweetUrl, item.tweetId));

    const linkBtn = document.createElement("button");
    linkBtn.textContent = "Link";
    linkBtn.addEventListener("click", () => copyHistoryLink(item.tweetUrl, item.tweetId));

    actions.appendChild(copyBtn);
    actions.appendChild(txtBtn);
    actions.appendChild(openBtn);
    actions.appendChild(linkBtn);

    wrapper.appendChild(actions);
    historyEl.appendChild(wrapper);
  }
}

async function copyHistoryItem(tweetId) {
  await runBusyAction(async () => {
    const response = await sendMessage({ type: "GET_TRANSCRIPT_FOR_TWEET", tweetId });
    if (!response?.ok) {
      throw new Error(response?.error || "Transcript not found.");
    }

    await navigator.clipboard.writeText(response.text || "");
    setStatus(`Copied transcript for ${tweetId}.`, "good");
  });
}

async function downloadHistoryItem(tweetId) {
  await runBusyAction(async () => {
    const response = await sendMessage({ type: "DOWNLOAD_TWEET_TRANSCRIPT", tweetId });
    if (!response?.ok) {
      throw new Error(response?.error || "Transcript download failed.");
    }

    setStatus(`Downloading transcript for ${tweetId}.`, "good");
  });
}

async function openHistoryItem(tweetUrl, tweetId) {
  await runBusyAction(async () => {
    const url = normalizeTweetUrl(tweetUrl, tweetId);
    await chrome.tabs.create({ url });
    setStatus("Opened post.", "good");
  });
}

async function copyHistoryLink(tweetUrl, tweetId) {
  await runBusyAction(async () => {
    const url = normalizeTweetUrl(tweetUrl, tweetId);
    await navigator.clipboard.writeText(url);
    setStatus("Post link copied.", "good");
  });
}

function normalizeTweetUrl(tweetUrl, fallbackTweetId) {
  const id = extractTweetId(tweetUrl) || extractTweetId(fallbackTweetId || "");
  return id ? makeTweetUrl(id) : String(tweetUrl || "");
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
  transcribeBtn.disabled = isBusy || !currentTweetId;
  downloadVideoBtn.disabled = isBusy || !currentTweetId;
  downloadTxtBtn.disabled = isBusy || !currentTweetId;
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

  const d = new Date(n);
  return d.toLocaleString();
}

function extractTweetId(text) {
  const match = String(text || "").match(/status\/(\d{8,30})/);
  return match ? match[1] : null;
}

function makeTweetUrl(tweetId) {
  return `https://x.com/i/web/status/${tweetId}`;
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

async function askPageForVisibleTweetMeta(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GET_VISIBLE_VIDEO_TWEET" });
    return response?.ok ? response : null;
  } catch (_error) {
    return null;
  }
}

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}
