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
const ACTIONS_CLASS = "xvdl-actions";
const BTN_CLASS = "xvdl-btn";
const BTN_ROLE = "xvdl-action";
const TOAST_CLASS = "xvdl-toast";

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
      transition: background-color .15s ease-in-out, color .15s ease-in-out;
    }
    .${BTN_CLASS}:hover {
      background: rgba(29, 155, 240, 0.13);
      color: rgb(29, 155, 240);
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
    .${BTN_CLASS}[data-state="error"] {
      color: rgb(244, 33, 46);
      background: rgba(244, 33, 46, 0.15);
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
  const tweets = root.querySelectorAll(TWEET_SELECTOR);
  for (const tweet of tweets) {
    injectButtons(tweet);
  }
}

function observeDom() {
  const observer = new MutationObserver((mutations) => {
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
          injectButtons(tweet);
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

function injectButtons(tweet) {
  if (!(tweet instanceof Element)) {
    return;
  }
  if (tweet.querySelector(`.${ACTIONS_CLASS}`)) {
    return;
  }
  if (!hasVideoCandidate(tweet)) {
    return;
  }

  const meta = extractTweetMeta(tweet);
  if (!meta.tweetId) {
    return;
  }

  const actions = document.createElement("div");
  actions.className = ACTIONS_CLASS;
  actions.setAttribute("data-testid", "xvdl-actions");

  actions.appendChild(createActionButton("download", meta.tweetId));
  actions.appendChild(createActionButton("transcript", meta.tweetId));

  if (insertNearGrok(tweet, actions)) {
    return;
  }

  const actionBar = findActionBar(tweet);
  if (!actionBar) {
    return;
  }
  insertInActionBar(actionBar, actions);
}

function createActionButton(action, tweetId) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = BTN_CLASS;
  btn.dataset.role = BTN_ROLE;
  btn.dataset.action = action;
  btn.dataset.tweetId = tweetId;
  btn.dataset.state = "idle";
  btn.title = action === "transcript" ? "Transcribe and copy" : "Download video";
  btn.setAttribute("aria-label", btn.title);
  renderButtonIcon(btn, action, "idle");
  return btn;
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

    const tweetId = button.dataset.tweetId;
    const action = button.dataset.action;
    if (!tweetId || !action || button.dataset.state === "loading") {
      return;
    }

    const tweetEl = button.closest(TWEET_SELECTOR);
    const meta = extractTweetMeta(tweetEl);

    const messageType =
      action === "transcript" ? "TRANSCRIBE_TWEET_VIDEO" : "DOWNLOAD_TWEET_VIDEO";

    if (action === "transcript" && event.shiftKey) {
      runDebug(button, action);
      return;
    }

    setState(button, action, "loading");
    chrome.runtime.sendMessage(
      {
        type: messageType,
        tweetId,
        tweetUrl: meta.tweetUrl || makeTweetUrl(tweetId),
        tweetText: meta.tweetText || ""
      },
      (response) => {
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
          button.title = "Transcript already generated recently";
          showToast(`Already transcribed. Cache active for ~${ttlMin} min.`, "success");
        } else {
          button.title = "Transcript copied to clipboard";
          showToast("Transcript copied to clipboard", "success");
        }
      } else {
        button.title = `Downloading... (${response.source})`;
      }
      resetLater(button, action);
      }
    );
  });
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
    if (!message || message.type !== "GET_VISIBLE_VIDEO_TWEET") {
      return;
    }

    const meta = getFirstVisibleTweetMeta();
    sendResponse({
      ok: !!meta?.tweetId,
      tweetId: meta?.tweetId || null,
      tweetUrl: meta?.tweetUrl || null,
      tweetText: meta?.tweetText || ""
    });
  });
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
    if (meta.tweetId) {
      return meta;
    }
  }
  return {
    tweetId: null,
    tweetUrl: null,
    tweetText: ""
  };
}

function extractTweetMeta(tweetEl) {
  if (!(tweetEl instanceof Element)) {
    return { tweetId: null, tweetUrl: null, tweetText: "" };
  }

  const timeAnchor = tweetEl.querySelector("a time")?.closest("a");
  if (timeAnchor && typeof timeAnchor.href === "string") {
    const match = timeAnchor.href.match(/status\/(\d{8,30})/);
    if (match) {
      return {
        tweetId: match[1],
        tweetUrl: makeTweetUrl(match[1]),
        tweetText: extractTweetText(tweetEl)
      };
    }
  }

  const anchors = tweetEl.querySelectorAll('a[href*="/status/"]');
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(/status\/(\d{8,30})/);
    if (match) {
      return {
        tweetId: match[1],
        tweetUrl: makeTweetUrl(match[1]),
        tweetText: extractTweetText(tweetEl)
      };
    }
  }

  return { tweetId: null, tweetUrl: null, tweetText: extractTweetText(tweetEl) };
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

function setState(button, action, state) {
  button.dataset.state = state;
  renderButtonIcon(button, action, state);
}

function renderButtonIcon(button, action, state) {
  if (state === "loading") {
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>`;
    return;
  }

  if (state === "done") {
    button.innerHTML =
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>`;
    return;
  }

  if (state === "error") {
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;
    return;
  }

  if (action === "transcript") {
    button.innerHTML =
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16H7z"></path><path d="M9 9h6M9 13h6M9 17h4"></path></svg>`;
    return;
  }

  button.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="M7 11l5 5 5-5"></path><path d="M5 21h14"></path></svg>`;
}

function resetLater(button, action) {
  window.setTimeout(() => {
    setState(button, action, "idle");
    button.title = action === "transcript" ? "Transcribe and copy" : "Download video";
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
    toast.remove();
  }, durationMs);
}
