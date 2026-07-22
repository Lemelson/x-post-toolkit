"use strict";

import {
  ITEM_PREFIX_DRIVE,
  ITEM_PREFIX_X,
  extractDriveFileId,
  extractTweetId,
  makeTweetUrl
} from "./src/background/context.js";
import { LANGUAGES, detectLanguage, translate } from "./popup-i18n.js";

const DEFAULT_MESSAGE_TIMEOUT_MS = 30 * 1000;
const TRANSCRIPT_MESSAGE_TIMEOUT_MS = 135 * 60 * 1000;
const DOWNLOAD_MESSAGE_TIMEOUT_MS = 60 * 1000;
const UI_PREFS_KEY = "videoToolkitUi";
const CLEAR_CONFIRMATION_MS = 4000;

const elements = {
  popupShell: document.getElementById("popupShell"),
  pageInfo: document.getElementById("pageInfo"),
  contextCard: document.getElementById("contextCard"),
  contextKicker: document.getElementById("contextKicker"),
  settingsStatus: document.getElementById("settingsStatus"),
  history: document.getElementById("history"),
  transcribeBtn: document.getElementById("transcribeBtn"),
  transcribeLabel: document.getElementById("transcribeLabel"),
  downloadVideoBtn: document.getElementById("downloadVideoBtn"),
  downloadTxtBtn: document.getElementById("downloadTxtBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  clearHistoryLabel: document.getElementById("clearHistoryLabel"),
  historyLimit: document.getElementById("historyLimit"),
  retentionValue: document.getElementById("retentionValue"),
  retentionUnit: document.getElementById("retentionUnit"),
  includeTitleInput: document.getElementById("includeTitleInput"),
  timestampModeSelect: document.getElementById("timestampModeSelect"),
  autoCloseSelect: document.getElementById("autoCloseSelect"),
  autoCloseCustomField: document.getElementById("autoCloseCustomField"),
  autoCloseCustomInput: document.getElementById("autoCloseCustomInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  themeButton: document.getElementById("themeButton"),
  languageButton: document.getElementById("languageButton"),
  languageFlag: document.getElementById("languageFlag"),
  languageCode: document.getElementById("languageCode"),
  languageMenu: document.getElementById("languageMenu"),
  versionLabel: document.getElementById("versionLabel"),
  copyEmailButton: document.getElementById("copyEmailButton"),
  toast: document.getElementById("toast")
};

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4M5 20h14"/></svg>',
  open: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  empty: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 14h8M8 18h5"/></svg>'
};

let uiPrefs = { theme: "dark", language: "en", tab: "home" };
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
let historyItems = [];
let clearConfirmationTimer = null;
let toastTimer = null;

boot();

async function boot() {
  await loadUiPreferences();
  applyTheme(uiPrefs.theme);
  applyTranslations();
  buildLanguageMenu();
  bindEvents();
  switchTab(uiPrefs.tab, false);
  elements.versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;
  await resolveCurrentItem();
  await refreshState();
}

function bindEvents() {
  for (const tab of document.querySelectorAll(".tab[data-tab]")) {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  }

  elements.themeButton.addEventListener("click", async () => {
    uiPrefs.theme = uiPrefs.theme === "light" ? "dark" : "light";
    applyTheme(uiPrefs.theme);
    await persistUiPreferences();
  });

  elements.languageButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = elements.languageMenu.classList.contains("hidden");
    elements.languageMenu.classList.toggle("hidden", !willOpen);
    elements.languageButton.classList.toggle("active", willOpen);
    elements.languageButton.setAttribute("aria-expanded", String(willOpen));
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#languagePicker")) {
      closeLanguageMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLanguageMenu();
      elements.languageButton.focus();
    }
  });

  elements.transcribeBtn.addEventListener("click", async () => {
    if (!currentItemId || isBusy) {
      return;
    }

    await runBusyAction(elements.transcribeBtn, async () => {
      setStatus(t("transcribing", { id: formatDisplayId(currentItemId) }));
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

      await copyTextToClipboard(response.text || "");
      setStatus(
        response.cached
          ? t("cachedCopied", { duration: formatRemainingDuration(response.cacheTtlSec) })
          : t("transcriptCopied"),
        "good"
      );
      await refreshState();
    });
  });

  elements.downloadVideoBtn.addEventListener("click", async () => {
    if (!currentItemId || isBusy) {
      return;
    }

    await runBusyAction(elements.downloadVideoBtn, async () => {
      setStatus(t("downloadingVideo", { id: formatDisplayId(currentItemId) }));
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
      setStatus(t("videoDownloadStarted"), "good");
    });
  });

  elements.downloadTxtBtn.addEventListener("click", async () => {
    if (!currentItemId || !hasCurrentTranscript || isBusy) {
      return;
    }

    await runBusyAction(elements.downloadTxtBtn, async () => {
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
      setStatus(t("transcriptDownloadStarted"), "good");
    });
  });

  elements.clearHistoryBtn.addEventListener("click", async () => {
    if (isBusy || historyItems.length === 0) {
      return;
    }
    if (!elements.clearHistoryBtn.classList.contains("is-armed")) {
      armClearHistory();
      return;
    }

    disarmClearHistory();
    await runBusyAction(elements.clearHistoryBtn, async () => {
      const response = await sendMessage({ type: "CLEAR_TRANSCRIPT_HISTORY" });
      if (!response?.ok) {
        throw new Error(response?.error || "Failed to clear history.");
      }
      setStatus(t("historyCleared"), "good");
      await refreshState();
    });
  });

  elements.autoCloseSelect.addEventListener("change", renderAutoCloseCustomField);

  elements.saveSettingsBtn.addEventListener("click", async () => {
    if (isBusy) {
      return;
    }

    await runBusyAction(elements.saveSettingsBtn, async () => {
      setSettingsStatus("");
      const maxItems = clampInt(elements.historyLimit.value, 1, 200, 10);
      const rawRetention = clampInt(elements.retentionValue.value, 1, 30, 7);
      const unit = elements.retentionUnit.value === "hours" ? "hours" : "days";
      const retentionHours = unit === "hours" ? rawRetention : rawRetention * 24;
      const autoCloseMinutes = elements.autoCloseSelect.value === "custom"
        ? clampInt(elements.autoCloseCustomInput.value, 1, 7 * 24 * 60, 5)
        : clampInt(elements.autoCloseSelect.value, 0, 60, 5);
      const response = await sendMessage({
        type: "UPDATE_TRANSCRIPT_SETTINGS",
        settings: {
          maxItems,
          retentionHours,
          includeTitle: elements.includeTitleInput.checked,
          timestampMode: elements.timestampModeSelect.value,
          autoCloseMinutes
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Failed to save settings.");
      }
      setSettingsStatus(t("settingsSaved"), "good");
      await refreshState();
    }, setSettingsStatus);
  });

  elements.copyEmailButton.addEventListener("click", async () => {
    try {
      await copyTextToClipboard(elements.copyEmailButton.dataset.copy || "");
      showToast(t("emailCopied"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    }
  });
}

async function loadUiPreferences() {
  const stored = await chrome.storage.local.get(UI_PREFS_KEY);
  const prefs = stored?.[UI_PREFS_KEY] || {};
  const cachedTheme = document.documentElement.dataset.theme;
  const theme = prefs.theme === "light" || prefs.theme === "dark"
    ? prefs.theme
    : cachedTheme === "light" || cachedTheme === "dark"
      ? cachedTheme
      : window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const language = LANGUAGES.some((item) => item.code === prefs.language) ? prefs.language : detectLanguage();
  const tab = ["home", "settings", "about"].includes(prefs.tab) ? prefs.tab : "home";
  uiPrefs = { theme, language, tab };
}

async function persistUiPreferences() {
  await chrome.storage.local.set({ [UI_PREFS_KEY]: uiPrefs });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  try {
    localStorage.setItem("videoToolkitTheme", document.documentElement.dataset.theme);
  } catch (_error) {
    // Theme persistence still works through chrome.storage.local.
  }
}

function buildLanguageMenu() {
  elements.languageMenu.textContent = "";
  for (const language of LANGUAGES) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `language-option${language.code === uiPrefs.language ? " active" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(language.code === uiPrefs.language));
    option.innerHTML = `<span>${language.flag}</span><span>${language.name}</span><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>`;
    option.addEventListener("click", async () => {
      uiPrefs.language = language.code;
      applyTranslations();
      buildLanguageMenu();
      renderCurrentContext();
      renderHistory(historyItems);
      renderActionLabel();
      disarmClearHistory();
      closeLanguageMenu();
      await persistUiPreferences();
    });
    elements.languageMenu.appendChild(option);
  }
}

function closeLanguageMenu() {
  elements.languageMenu.classList.add("hidden");
  elements.languageButton.classList.remove("active");
  elements.languageButton.setAttribute("aria-expanded", "false");
}

function applyTranslations() {
  document.documentElement.lang = uiPrefs.language;
  const language = LANGUAGES.find((item) => item.code === uiPrefs.language) || LANGUAGES[0];
  elements.languageFlag.textContent = language.flag;
  elements.languageCode.textContent = language.code.toUpperCase();

  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    const label = t(node.dataset.i18nTitle);
    node.title = label;
    node.setAttribute("aria-label", label);
  }
}

function t(key, values) {
  return translate(uiPrefs.language, key, values);
}

function switchTab(tabName, persist = true) {
  const nextTab = ["home", "settings", "about"].includes(tabName) ? tabName : "home";
  uiPrefs.tab = nextTab;
  for (const tab of document.querySelectorAll(".tab[data-tab]")) {
    const active = tab.dataset.tab === nextTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    const active = panel.id === `tab-${nextTab}`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
    if (active) {
      panel.scrollTop = 0;
    }
  }
  closeLanguageMenu();
  if (persist) {
    void persistUiPreferences();
  }
}

async function resolveCurrentItem() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) {
    clearCurrentItem();
    return;
  }

  const fromUrl = extractContextFromUrl(tab.url);
  const visibleMeta = await askPageForVisibleVideoContext(tab.id);
  const resolved = visibleMeta?.itemId ? visibleMeta : fromUrl;
  if (!resolved?.itemId) {
    clearCurrentItem();
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
  renderCurrentContext();
}

function clearCurrentItem() {
  currentItemId = null;
  currentItemUrl = null;
  currentItemTitle = "";
  currentTweetText = "";
  currentAuthorName = "";
  currentAuthorHandle = "";
  currentPlatform = "";
  currentMediaUrl = "";
  currentFileId = "";
  renderCurrentContext();
}

function renderCurrentContext() {
  const supported = Boolean(currentItemId);
  elements.contextCard.classList.toggle("is-supported", supported);
  elements.contextCard.classList.toggle("is-unsupported", !supported);
  if (!supported) {
    elements.contextKicker.textContent = t("checkingPage");
    elements.pageInfo.textContent = t("noSupportedVideo");
    return;
  }

  const platformKey = currentPlatform === "gdrive" ? "platformDrive" : "platformX";
  const platform = t(platformKey);
  elements.contextKicker.textContent = t(currentPlatform === "gdrive" ? "sourceDrive" : "sourceX");
  elements.pageInfo.textContent = currentItemTitle || t("currentVideo", {
    platform,
    id: formatDisplayId(currentItemId)
  });
  elements.pageInfo.title = elements.pageInfo.textContent;
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
  historyItems = Array.isArray(state.history) ? state.history : [];
  renderHistory(historyItems);
  hasCurrentTranscript = Boolean(state.current);
  renderActionLabel();
  applyButtonAvailability();
}

function renderActionLabel() {
  elements.transcribeLabel.textContent = hasCurrentTranscript ? t("copyExisting") : t("transcribeVideo");
}

function applyButtonAvailability() {
  elements.transcribeBtn.disabled = !currentItemId || isBusy;
  elements.downloadVideoBtn.disabled = !currentItemId || isBusy;
  elements.downloadTxtBtn.disabled = !currentItemId || !hasCurrentTranscript || isBusy;
  elements.clearHistoryBtn.disabled = historyItems.length === 0 || isBusy;
  elements.saveSettingsBtn.disabled = isBusy;
}

function renderSettings(settings) {
  const maxItems = clampInt(settings?.maxItems, 1, 200, 10);
  const retentionHours = clampInt(settings?.retentionHours, 1, 24 * 30, 24 * 7);
  elements.historyLimit.value = String(maxItems);
  elements.includeTitleInput.checked = settings?.includeTitle !== false;

  const mode = String(settings?.timestampMode || "off");
  const knownMode = Array.from(elements.timestampModeSelect.options).some((option) => option.value === mode);
  elements.timestampModeSelect.value = knownMode ? mode : "off";

  const autoCloseMinutes = clampInt(settings?.autoCloseMinutes, 0, 7 * 24 * 60, 5);
  const preset = [0, 1, 5, 15, 30, 60].includes(autoCloseMinutes);
  elements.autoCloseSelect.value = preset ? String(autoCloseMinutes) : "custom";
  elements.autoCloseCustomInput.value = String(preset ? 5 : autoCloseMinutes);
  renderAutoCloseCustomField();

  if (retentionHours % 24 === 0) {
    elements.retentionValue.value = String(Math.max(1, Math.floor(retentionHours / 24)));
    elements.retentionUnit.value = "days";
  } else {
    elements.retentionValue.value = String(retentionHours);
    elements.retentionUnit.value = "hours";
  }
}

function renderAutoCloseCustomField() {
  elements.autoCloseCustomField.hidden = elements.autoCloseSelect.value !== "custom";
}

function renderHistory(items) {
  elements.history.textContent = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.innerHTML = `${ICONS.empty}<strong>${escapeHtml(t("historyEmptyTitle"))}</strong><span>${escapeHtml(t("historyEmptyBody"))}</span>`;
    elements.history.appendChild(empty);
    applyButtonAvailability();
    return;
  }

  for (const item of items) {
    const wrapper = document.createElement("article");
    wrapper.className = "history-item";

    const main = document.createElement("div");
    main.className = "history-main";
    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = item.title || item.preview || formatDisplayId(item.itemId);
    title.title = title.textContent;
    const meta = document.createElement("div");
    meta.className = "history-meta";
    const age = document.createElement("span");
    age.textContent = formatAge(item.updatedAt);
    age.title = formatDateTime(item.updatedAt);
    meta.append(age);
    main.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "history-actions";
    actions.append(
      createHistoryAction("copy", t("copyTranscript"), (button) => copyHistoryItem(item, button)),
      createHistoryAction("download", t("downloadTxt"), (button) => downloadHistoryItem(item, button))
    );
    if (item.itemUrl) actions.append(createHistoryAction("open", t("openSource"), (button) => openHistoryItem(item.itemUrl, button)));

    wrapper.append(main, actions);
    elements.history.appendChild(wrapper);
  }
  applyButtonAvailability();
}

function createHistoryAction(icon, label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "history-action";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = ICONS[icon];
  button.addEventListener("click", () => handler(button));
  return button;
}

async function copyHistoryItem(item, button) {
  await runBusyAction(button, async () => {
    const response = await sendMessage({
      type: "GET_TRANSCRIPT_FOR_ITEM",
      itemId: item.itemId,
      itemUrl: item.itemUrl || "",
      platform: item.platform || detectPlatformFromId(item.itemId),
      format: "default"
    });
    if (!response?.ok) throw new Error(response?.error || "Transcript not found.");
    await copyTextToClipboard(response.text || "");
    setStatus(t("copiedItem", { id: formatDisplayId(item.itemId) }), "good");
  });
}

async function downloadHistoryItem(item, button) {
  await runBusyAction(button, async () => {
    const response = await sendMessage({
      type: "DOWNLOAD_ITEM_TRANSCRIPT",
      itemId: item.itemId,
      itemUrl: item.itemUrl || "",
      platform: item.platform || detectPlatformFromId(item.itemId),
      format: "default"
    });
    if (!response?.ok) throw new Error(response?.error || "Transcript download failed.");
    setStatus(t("downloadingItem", { id: formatDisplayId(item.itemId) }), "good");
  });
}

async function openHistoryItem(itemUrl, button) {
  await runBusyAction(button, async () => {
    const url = String(itemUrl || "");
    if (!url) {
      throw new Error("Source link is unavailable.");
    }
    await chrome.tabs.create({ url });
    setStatus(t("openedSource"), "good");
  });
}

function armClearHistory() {
  disarmClearHistory();
  elements.clearHistoryBtn.classList.add("is-armed");
  elements.clearHistoryLabel.textContent = t("clearConfirm");
  clearConfirmationTimer = window.setTimeout(disarmClearHistory, CLEAR_CONFIRMATION_MS);
}

function disarmClearHistory() {
  if (clearConfirmationTimer) {
    clearTimeout(clearConfirmationTimer);
    clearConfirmationTimer = null;
  }
  elements.clearHistoryBtn.classList.remove("is-armed");
  elements.clearHistoryLabel.textContent = t("clearHistory");
}

async function runBusyAction(button, action, errorTarget = setStatus) {
  if (isBusy) {
    return;
  }
  setBusy(true, button);
  try {
    await action();
  } catch (error) {
    errorTarget(error instanceof Error ? error.message : String(error), "bad");
  } finally {
    setBusy(false, button);
  }
}

function setBusy(next, activeButton) {
  isBusy = Boolean(next);
  activeButton?.classList.toggle("is-busy", isBusy);
  activeButton?.setAttribute("aria-busy", String(isBusy));
  applyButtonAvailability();
}

function setStatus(text, kind = "") {
  if (!text) return;
  showToast(text, kind === "good" ? "success" : kind === "bad" ? "error" : "info");
}

function setSettingsStatus(text, kind = "") {
  elements.settingsStatus.textContent = text || "";
  elements.settingsStatus.classList.remove("good", "bad");
  if (kind) {
    elements.settingsStatus.classList.add(kind);
  }
}

function showToast(message, type = "info") {
  if (!message) return;
  elements.toast.textContent = message;
  elements.toast.classList.remove("toast-info", "toast-success", "toast-error");
  elements.toast.classList.add(`toast-${type}`);
  elements.toast.setAttribute("role", type === "error" ? "alert" : "status");
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => elements.toast.classList.remove("visible"),
    type === "error" ? 4500 : 2800
  );
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
  document.documentElement.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy failed.");
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
  return String(itemId || "").startsWith(ITEM_PREFIX_DRIVE) ? "gdrive" : "x";
}

function extractContextFromUrl(rawUrl) {
  const url = String(rawUrl || "");
  const driveId = extractDriveFileId(url);
  if (driveId) {
    return {
      itemId: `${ITEM_PREFIX_DRIVE}${driveId}`,
      itemUrl: url,
      platform: "gdrive",
      fileId: driveId
    };
  }

  const tweetId = extractTweetId(url);
  if (tweetId) {
    return {
      itemId: `${ITEM_PREFIX_X}${tweetId}`,
      itemUrl: makeTweetUrl(tweetId),
      platform: "x"
    };
  }
  return null;
}

function formatAge(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) {
    return "";
  }
  const seconds = Math.round((value - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const [amount, unit] = absolute < 60
    ? [seconds, "second"]
    : absolute < 3600
      ? [Math.round(seconds / 60), "minute"]
      : absolute < 86400
        ? [Math.round(seconds / 3600), "hour"]
        : [Math.round(seconds / 86400), "day"];
  return new Intl.RelativeTimeFormat(uiPrefs.language, { numeric: "auto" }).format(amount, unit);
}

function formatDateTime(timestamp) {
  const value = Number(timestamp || 0);
  return value ? new Intl.DateTimeFormat(uiPrefs.language, { dateStyle: "medium", timeStyle: "short" }).format(value) : "";
}

function formatRemainingDuration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  const [amount, unit] = value >= 86400
    ? [Math.max(1, Math.ceil(value / 86400)), "day"]
    : value >= 3600
      ? [Math.max(1, Math.ceil(value / 3600)), "hour"]
      : [Math.max(1, Math.ceil(value / 60)), "minute"];
  return new Intl.NumberFormat(uiPrefs.language, { style: "unit", unit, unitDisplay: "short" }).format(amount);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
      if (!settled) {
        settled = true;
        reject(new Error(buildRuntimeTimeoutMessage(message?.type, timeout)));
      }
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
  if (["TRANSCRIBE_VIDEO_ITEM", "TRANSCRIBE_TWEET_VIDEO", "TRANSCRIBE_PAGE_VIDEO"].includes(type)) {
    return TRANSCRIPT_MESSAGE_TIMEOUT_MS;
  }
  if ([
    "DOWNLOAD_VIDEO_ITEM",
    "DOWNLOAD_TWEET_VIDEO",
    "DOWNLOAD_PAGE_VIDEO",
    "DOWNLOAD_ITEM_TRANSCRIPT",
    "DOWNLOAD_TWEET_TRANSCRIPT"
  ].includes(type)) {
    return DOWNLOAD_MESSAGE_TIMEOUT_MS;
  }
  return DEFAULT_MESSAGE_TIMEOUT_MS;
}

function buildRuntimeTimeoutMessage(type, timeoutMs) {
  const action = String(type || "").includes("TRANSCRIBE") ? "Transcription" : "Extension action";
  return `${action} did not respond within ${formatDuration(timeoutMs)}. The local transcriber may be stuck; check the extension/native-host log and retry.`;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(1, Math.ceil(Number(milliseconds || 0) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`;
}
