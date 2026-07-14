"use strict";

const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const ACTION_GROUP_SELECTOR = 'div[role="group"]';
const ACTION_BUTTON_HINTS =
  '[data-testid="reply"], [data-testid="retweet"], [data-testid="unretweet"], [data-testid="like"], [data-testid="unlike"], [data-testid="bookmark"], [data-testid="share"]';
const VIDEO_HINT_SELECTOR =
  '[data-testid="videoComponent"], [data-testid="videoPlayer"], [data-testid="previewInterstitial"], video, a[href*="/video/"]';
const GROK_ACTION_SELECTOR =
  '[data-testid*="grok" i], button[aria-label*="grok" i], a[aria-label*="grok" i], a[href*="/i/grok"]';
const SHARE_ACTION_SELECTOR =
  '[data-testid="share"], button[aria-label*="share" i], a[aria-label*="share" i]';
const DRIVE_FILE_PATH_RE = /\/file\/d\/([a-zA-Z0-9_-]{10,})\b/;
const DRIVE_FILE_QUERY_RE = /[?&]id=([a-zA-Z0-9_-]{10,})\b/;
const ITEM_PREFIX_X = "x:";
const ITEM_PREFIX_DRIVE = "gdrive:";
const ACTIONS_CLASS = "xvdl-actions";
const DRIVE_ACTIONS_CLASS = "xvdl-drive-actions";
const DRIVE_HOST_ATTR = "data-xvdl-drive-host";
const BTN_CLASS = "xvdl-btn";
const DRIVE_BTN_CLASS = "xvdl-btn--drive";
const BTN_ROLE = "xvdl-action";
const TOAST_CLASS = "xvdl-toast";
const DRIVE_CONTROL_LABELS = [
  'Full screen (f)',
  'Exit full screen (f)',
  'Settings',
  'Mute (m)',
  'Unmute (m)'
];

injectStyles();
scanPage();
observeDom();
wireClickHandler();
wireRuntimeHandler();
observeRouteChanges();
setInterval(() => scanPage(), 1500);

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
  `;
  document.documentElement.appendChild(style);
}

function scanPage(root = document) {
  if (isDrivePage()) {
    injectDriveButtons();
    return;
  }

  const tweets = root.querySelectorAll(TWEET_SELECTOR);
  for (const tweet of tweets) {
    injectTweetButtons(tweet);
  }
}

function observeDom() {
  const observer = new MutationObserver((mutations) => {
    if (isDrivePage()) {
      injectDriveButtons();
      return;
    }

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }

        const found = new Set();
        if (node.matches?.(TWEET_SELECTOR)) {
          found.add(node);
        }
        const closest = node.closest?.(TWEET_SELECTOR);
        if (closest) {
          found.add(closest);
        }
        const nestedTweets = node.querySelectorAll?.(TWEET_SELECTOR) || [];
        for (const tweet of nestedTweets) {
          found.add(tweet);
        }

        for (const tweet of found) {
          injectTweetButtons(tweet);
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function observeRouteChanges() {
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) {
      return;
    }
    lastUrl = location.href;
    scanPage();
  }, 700);
}

function injectTweetButtons(tweet) {
  if (!(tweet instanceof Element)) {
    return;
  }
  if (!hasVideoCandidate(tweet)) {
    return;
  }

  const meta = extractTweetMeta(tweet);
  if (!meta.itemId) {
    return;
  }

  const existing = tweet.querySelector(`.${ACTIONS_CLASS}`);
  if (existing) {
    syncButtonsMeta(existing, meta);
    return;
  }

  const actions = createActionWrapper(meta, "compact");

  if (insertNearGrok(tweet, actions)) {
    return;
  }

  const actionBar = findActionBar(tweet);
  if (!actionBar) {
    return;
  }
  insertInActionBar(actionBar, actions);
}

function injectDriveButtons() {
  const existing = document.querySelector(`.${DRIVE_ACTIONS_CLASS}`);
  const video = getPrimaryVideoElement();
  const meta = extractDriveMeta(video);

  if (!meta.itemId) {
    existing?.remove();
    return;
  }

  let wrapper = existing;
  if (!wrapper) {
    wrapper = createActionWrapper(meta, "drive");
  } else {
    syncButtonsMeta(wrapper, meta);
  }

  const inlineTarget = findDriveInlineTarget();
  if (inlineTarget?.container) {
    wrapper.dataset.placement = "inline";
    insertDriveInline(wrapper, inlineTarget.container, inlineTarget.beforeNode);
    return;
  }

  // Fallback: overlay on the player area
  const host = findDriveOverlayHost(video);
  if (!host) {
    return;
  }

  if (getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }
  host.setAttribute(DRIVE_HOST_ATTR, "1");
  wrapper.dataset.placement = "overlay";

  if (wrapper.parentElement !== host) {
    host.appendChild(wrapper);
  }
}

function createActionWrapper(meta, variant) {
  const actions = document.createElement("div");
  actions.className = variant === "drive" ? DRIVE_ACTIONS_CLASS : ACTIONS_CLASS;
  actions.setAttribute("data-testid", "xvdl-actions");
  actions.dataset.variant = variant;

  if (variant !== "drive") {
    actions.appendChild(createActionButton("download", meta, variant));
  }
  actions.appendChild(createActionButton("transcript", meta, variant));
  return actions;
}

function createActionButton(action, meta, variant) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = variant === "drive" ? `${BTN_CLASS} ${DRIVE_BTN_CLASS}` : BTN_CLASS;
  btn.dataset.role = BTN_ROLE;
  btn.dataset.action = action;
  btn.dataset.variant = variant;
  btn.dataset.state = "idle";
  applyMetaToButton(btn, meta);
  btn.title = getButtonTitle(action);
  btn.setAttribute("aria-label", btn.title);
  renderButtonContent(btn, action, "idle");
  return btn;
}

function syncButtonsMeta(wrapper, meta) {
  const buttons = wrapper.querySelectorAll(`.${BTN_CLASS}`);
  for (const button of buttons) {
    applyMetaToButton(button, meta);
  }
}

function applyMetaToButton(button, meta) {
  button.dataset.itemId = meta.itemId || "";
  button.dataset.itemUrl = meta.itemUrl || "";
  button.dataset.title = meta.title || "";
  button.dataset.platform = meta.platform || "";
  button.dataset.mediaUrl = meta.mediaUrl || "";
  button.dataset.fileId = meta.fileId || "";
}

function hasVideoCandidate(tweet) {
  return !!tweet.querySelector(VIDEO_HINT_SELECTOR);
}

function findActionBar(tweet) {
  const groups = Array.from(tweet.querySelectorAll(ACTION_GROUP_SELECTOR));
  for (const group of groups) {
    if (group.querySelector(ACTION_BUTTON_HINTS)) {
      return group;
    }
  }
  return groups.length ? groups[groups.length - 1] : null;
}

function insertNearGrok(tweet, wrapper) {
  const grok = tweet.querySelector(GROK_ACTION_SELECTOR);
  if (!grok) {
    return false;
  }

  const group = grok.closest('div[role="group"]');
  if (!group) {
    return false;
  }

  let target = grok;
  while (target && target.parentElement && target.parentElement !== group) {
    target = target.parentElement;
  }
  if (!target || target.parentElement !== group) {
    return false;
  }

  group.insertBefore(wrapper, target);
  return true;
}

function insertInActionBar(actionBar, wrapper) {
  const grokTarget = findActionTarget(actionBar, GROK_ACTION_SELECTOR);
  if (grokTarget) {
    actionBar.insertBefore(wrapper, grokTarget);
    return;
  }

  const shareTarget = findActionTarget(actionBar, SHARE_ACTION_SELECTOR);
  if (shareTarget) {
    actionBar.insertBefore(wrapper, shareTarget);
    return;
  }

  actionBar.appendChild(wrapper);
}

function findActionTarget(actionBar, selector) {
  const found = actionBar.querySelector(selector);
  if (!found) {
    return null;
  }
  let node = found;
  while (node && node.parentElement && node.parentElement !== actionBar) {
    node = node.parentElement;
  }
  if (node && node.parentElement === actionBar) {
    return node;
  }
  return found;
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

    const meta =
      button.dataset.platform === "gdrive"
        ? extractDriveMeta(getPrimaryVideoElement())
        : extractTweetMeta(button.closest(TWEET_SELECTOR));

    const payload = {
      type: action === "transcript" ? "TRANSCRIBE_VIDEO_ITEM" : "DOWNLOAD_VIDEO_ITEM",
      itemId,
      itemUrl: meta.itemUrl || button.dataset.itemUrl || location.href,
      title: meta.title || button.dataset.title || "",
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
      platform: payload.platform,
      mediaUrl: payload.mediaUrl,
      fileId: payload.fileId
    });

    setState(button, action, "loading");
    chrome.runtime.sendMessage(payload, async (response) => {
      if (chrome.runtime.lastError) {
        setState(button, action, "error");
        const msg = `Failed: ${chrome.runtime.lastError.message}`;
        button.title = msg;
        showToast(msg, "error");
        resetLater(button, action);
        return;
      }

      if (!response?.ok) {
        setState(button, action, "error");
        const msg = `Failed: ${response?.error || "unknown error"}`;
        button.title = msg;
        showToast(msg, "error");
        resetLater(button, action);
        return;
      }

      setState(button, action, "done");
      if (action === "transcript") {
        if (response.cached) {
          const ttlMin = Math.max(1, Math.ceil(Number(response.cacheTtlSec || 0) / 60));
          try {
            await copyTextToClipboard(response.text || "");
            button.title = "Cached transcript copied to clipboard";
            showToast(`Cached transcript copied to clipboard. Cache active for ~${ttlMin} min.`, "success");
          } catch (error) {
            setState(button, action, "error");
            const msg = `Transcript is cached, but clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`;
            button.title = msg;
            showToast(msg, "error");
          }
        } else {
          button.title = "Transcript copied to clipboard";
          showToast("Transcript copied to clipboard", "success");
        }
      } else {
        button.title = `Downloading... (${response.source})`;
      }
      resetLater(button, action);
    });
  });
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
  chrome.runtime.sendMessage({ type: "DEBUG_NATIVE_HOST" }, (response) => {
    if (chrome.runtime.lastError) {
      const msg = `Debug failed: ${chrome.runtime.lastError.message}`;
      setState(button, action, "error");
      button.title = msg;
      showToast(msg, "error", 12000);
      resetLater(button, action);
      return;
    }

    setState(button, action, response?.ok ? "done" : "error");
    const text = response?.ok
      ? `Native host OK\nextensionId: ${response.extensionId}\nmodel: ${response.ping?.model || "unknown"}`
      : `Native host FAIL\nextensionId: ${response?.extensionId || "unknown"}\n${response?.error || "unknown error"}`;
    showToast(text, response?.ok ? "success" : "error", 14000);
    resetLater(button, action);
  });
}

function wireRuntimeHandler() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || (message.type !== "GET_VISIBLE_VIDEO_CONTEXT" && message.type !== "GET_VISIBLE_VIDEO_TWEET")) {
      return;
    }

    const meta = getVisibleVideoContext();
    sendResponse({
      ok: !!meta?.itemId,
      itemId: meta?.itemId || null,
      itemUrl: meta?.itemUrl || null,
      title: meta?.title || "",
      platform: meta?.platform || "",
      mediaUrl: meta?.mediaUrl || "",
      fileId: meta?.fileId || ""
    });
  });
}

function getVisibleVideoContext() {
  if (isDrivePage()) {
    return extractDriveMeta(getPrimaryVideoElement());
  }
  return getFirstVisibleTweetMeta();
}

function getFirstVisibleTweetMeta() {
  const tweets = document.querySelectorAll(TWEET_SELECTOR);
  for (const tweet of tweets) {
    const rect = tweet.getBoundingClientRect();
    const isVisible = rect.bottom > 0 && rect.top < window.innerHeight;
    if (!isVisible) {
      continue;
    }
    if (!hasVideoCandidate(tweet)) {
      continue;
    }
    const meta = extractTweetMeta(tweet);
    if (meta.itemId) {
      return meta;
    }
  }
  return {
    itemId: null,
    itemUrl: null,
    title: "",
    platform: "x",
    mediaUrl: "",
    fileId: ""
  };
}

function extractTweetMeta(tweetEl) {
  if (!(tweetEl instanceof Element)) {
    return { itemId: null, itemUrl: null, title: "", platform: "x", mediaUrl: "", fileId: "" };
  }

  const sourceId = extractTweetSourceId(tweetEl);
  const title = extractTweetText(tweetEl);
  if (!sourceId) {
    return { itemId: null, itemUrl: null, title, platform: "x", mediaUrl: "", fileId: "" };
  }

  return {
    itemId: `${ITEM_PREFIX_X}${sourceId}`,
    itemUrl: makeTweetUrl(sourceId),
    title,
    platform: "x",
    mediaUrl: "",
    fileId: ""
  };
}

function extractTweetSourceId(tweetEl) {
  const timeAnchor = tweetEl.querySelector("a time")?.closest("a");
  if (timeAnchor && typeof timeAnchor.href === "string") {
    const match = timeAnchor.href.match(/status\/(\d{8,30})/);
    if (match) {
      return match[1];
    }
  }

  const anchors = tweetEl.querySelectorAll('a[href*="/status/"]');
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(/status\/(\d{8,30})/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function extractTweetText(tweetEl) {
  const textNode = tweetEl.querySelector('[data-testid="tweetText"]');
  if (!textNode) {
    return "";
  }

  const raw = typeof textNode.innerText === "string" && textNode.innerText
    ? textNode.innerText
    : textNode.textContent || "";

  return String(raw)
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 600);
}

function makeTweetUrl(tweetId) {
  return `https://x.com/i/web/status/${tweetId}`;
}

function isDrivePage() {
  return location.hostname === "drive.google.com";
}

function extractDriveMeta(videoEl) {
  const title = extractDriveTitle();
  const itemUrl = extractDriveCanonicalUrl() || location.href;
  const fileId = discoverDriveFileId(videoEl, itemUrl);
  const fallbackKey = `page_${hashString(itemUrl || title || "drive")}`;

  return {
    itemId: `${ITEM_PREFIX_DRIVE}${fileId || fallbackKey}`,
    itemUrl,
    title,
    platform: "gdrive",
    mediaUrl: buildDriveDirectUrl(fileId),
    fileId: fileId || ""
  };
}

function extractDriveTitle() {
  const metaTitle =
    document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") ||
    "";
  const heading =
    document.querySelector('h1, [aria-label][role="heading"]')?.textContent ||
    document.querySelector("[data-tooltip]")?.getAttribute("data-tooltip") ||
    "";
  const title = metaTitle || heading || document.title || "";
  return String(title)
    .replace(/\s*-\s*Google Drive\s*$/i, "")
    .trim()
    .slice(0, 180);
}

function extractDriveCanonicalUrl() {
  return (
    document.querySelector('link[rel="canonical"]')?.href ||
    document.querySelector('meta[property="og:url"]')?.getAttribute("content") ||
    document.querySelector('meta[name="twitter:url"]')?.getAttribute("content") ||
    location.href
  );
}

function discoverDriveFileId(videoEl, canonicalUrl) {
  // Check data-doc-id attribute on player container (most reliable)
  const docIdEl = document.querySelector('[data-doc-id]');
  if (docIdEl) {
    const docId = docIdEl.getAttribute('data-doc-id');
    if (docId && docId.length >= 10) {
      return docId;
    }
  }

  const candidates = [
    location.href,
    canonicalUrl,
    document.querySelector('meta[property="og:video"]')?.getAttribute("content") || "",
    document.querySelector('meta[property="og:url"]')?.getAttribute("content") || "",
    document.querySelector('link[rel="canonical"]')?.href || "",
    videoEl?.currentSrc || "",
    videoEl?.src || ""
  ];

  for (const link of document.querySelectorAll('a[href*="/file/d/"], a[href*="id="]')) {
    candidates.push(link.href || "");
    if (candidates.length > 24) {
      break;
    }
  }

  for (const candidate of candidates) {
    const fileId = extractDriveFileId(candidate);
    if (fileId) {
      return fileId;
    }
  }

  const headHtml = document.head?.innerHTML || "";
  const pathMatch = headHtml.match(DRIVE_FILE_PATH_RE);
  if (pathMatch) {
    return pathMatch[1];
  }
  const queryMatch = headHtml.match(DRIVE_FILE_QUERY_RE);
  return queryMatch ? queryMatch[1] : "";
}

function buildDriveDirectUrl(fileId) {
  if (!fileId) {
    return "";
  }
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

function getPrimaryVideoElement() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (!videos.length) {
    return null;
  }

  let best = null;
  let bestScore = 0;

  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const area = visibleWidth * visibleHeight;
    if (area <= 0) {
      continue;
    }
    if (area > bestScore) {
      best = video;
      bestScore = area;
    }
  }

  return best;
}

function findDriveOverlayHost(videoEl) {
  if (!(videoEl instanceof HTMLVideoElement)) {
    return null;
  }

  let node = videoEl.parentElement;
  let best = node;
  const targetRect = videoEl.getBoundingClientRect();

  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    const rect = node.getBoundingClientRect();
    if (
      rect.width >= targetRect.width * 0.9 &&
      rect.height >= targetRect.height * 0.75
    ) {
      best = node;
    }
  }

  return best || videoEl.parentElement;
}


function findDriveInlineTarget() {
  // Find a known right-side control button by aria-label
  let anchor = null;
  for (const label of DRIVE_CONTROL_LABELS) {
    anchor = document.querySelector(`button[aria-label="${label}"], [role="button"][aria-label="${label}"]`);
    if (anchor) {
      break;
    }
  }

  if (!anchor) {
    return null;
  }

  // Walk up to find the row container that holds these buttons
  const row = findDriveControlRow(anchor);
  if (!row) {
    return null;
  }

  // Find the fullscreen button's direct child in the row to insert before it
  const fullscreenBtn = row.querySelector('button[aria-label*="full screen" i], [role="button"][aria-label*="full screen" i]');
  const beforeNode = fullscreenBtn
    ? findDirectChild(row, fullscreenBtn)
    : findDirectChild(row, anchor);

  return {
    container: row,
    beforeNode: beforeNode || null
  };
}

function findDriveControlRow(anchor) {
  let node = anchor instanceof Element ? anchor.parentElement : null;

  // Walk up at most 5 levels looking for a container with multiple control buttons
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    const buttons = node.querySelectorAll('button, [role="button"]');
    const hasMultipleControls = buttons.length >= 3;
    const rect = node.getBoundingClientRect();
    const isWideEnough = rect.width >= 120;
    const isNotTooTall = rect.height <= 120;

    if (hasMultipleControls && isWideEnough && isNotTooTall) {
      return node;
    }
  }

  return null;
}

function findDirectChild(container, node) {
  let current = node;
  while (current && current.parentElement && current.parentElement !== container) {
    current = current.parentElement;
  }
  return current && current.parentElement === container ? current : null;
}

function insertDriveInline(wrapper, container, beforeNode) {
  if (beforeNode && beforeNode.parentElement === container) {
    if (wrapper.parentElement !== container || wrapper.nextSibling !== beforeNode) {
      container.insertBefore(wrapper, beforeNode);
    }
    return;
  }

  if (wrapper.parentElement !== container) {
    container.appendChild(wrapper);
  }
}

function extractDriveFileId(input) {
  const text = String(input || "");
  const pathMatch = text.match(DRIVE_FILE_PATH_RE);
  if (pathMatch) {
    return pathMatch[1];
  }
  const queryMatch = text.match(DRIVE_FILE_QUERY_RE);
  return queryMatch ? queryMatch[1] : null;
}

function hashString(value) {
  let hash = 0;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return /^https?:$/.test(url.protocol);
  } catch (_error) {
    return false;
  }
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
