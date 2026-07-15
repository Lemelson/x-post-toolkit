"use strict";

(function registerXAdapter() {
  const factories = globalThis.XVDL_SITE_ADAPTER_FACTORIES || [];
  globalThis.XVDL_SITE_ADAPTER_FACTORIES = factories;

  factories.push((api) => {
    const TWEET_SELECTOR = 'article[data-testid="tweet"]';
    const ACTION_GROUP_SELECTOR = 'div[role="group"]';
    const ACTION_BUTTON_HINTS =
      '[data-testid="reply"], [data-testid="retweet"], [data-testid="unretweet"], [data-testid="like"], [data-testid="unlike"], [data-testid="bookmark"], [data-testid="share"]';
    const VIDEO_HINT_SELECTOR =
      '[data-testid="videoComponent"], [data-testid="videoPlayer"], [data-testid="previewInterstitial"], video, a[href*="/video/"]';
    const VIDEO_PLAYER_SELECTOR = '[data-testid="videoPlayer"]';
    const GROK_ACTION_SELECTOR =
      '[data-testid*="grok" i], button[aria-label*="grok" i], a[aria-label*="grok" i], a[href*="/i/grok"]';
    const SHARE_ACTION_SELECTOR =
      '[data-testid="share"], button[aria-label*="share" i], a[aria-label*="share" i]';
    const ITEM_PREFIX_X = "x:";

    return {
      id: "x",
      platform: "x",
      match() {
        return location.hostname === "x.com" || location.hostname === "twitter.com";
      },
      scan(root = document) {
        const tweets = collectTweets(root);
        for (const tweet of tweets) {
          injectTweetButtons(tweet);
        }

        const players = collectVideoPlayers(root);
        for (const player of players) {
          syncPlayerButtons(player);
        }
      },
      getButtonContext(button) {
        const player = button.closest(VIDEO_PLAYER_SELECTOR);
        if (player) {
          return extractPlayerMeta(player);
        }
        return extractTweetMeta(button.closest(TWEET_SELECTOR));
      },
      getVisibleContext() {
        return getFirstVisibleTweetMeta();
      }
    };

    function collectTweets(root) {
      const found = new Set();
      if (root instanceof Element) {
        if (root.matches?.(TWEET_SELECTOR)) {
          found.add(root);
        }
        const closest = root.closest?.(TWEET_SELECTOR);
        if (closest) {
          found.add(closest);
        }
      }

      const nested = root.querySelectorAll?.(TWEET_SELECTOR) || [];
      for (const tweet of nested) {
        found.add(tweet);
      }
      return found;
    }

    function collectVideoPlayers(root) {
      const found = new Set();
      if (root instanceof Element) {
        if (root.matches?.(VIDEO_PLAYER_SELECTOR)) {
          found.add(root);
        }
        const closest = root.closest?.(VIDEO_PLAYER_SELECTOR);
        if (closest) {
          found.add(closest);
        }
      }

      const nested = root.querySelectorAll?.(VIDEO_PLAYER_SELECTOR) || [];
      for (const player of nested) {
        found.add(player);
      }
      return found;
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

      const existing = tweet.querySelector(`.${api.ACTIONS_CLASS}[data-variant="compact"]`);
      if (existing) {
        api.syncButtonsMeta(existing, meta);
        return;
      }

      const actions = api.createActionWrapper(meta, "compact", "x");

      if (insertNearGrok(tweet, actions)) {
        return;
      }

      const actionBar = findActionBar(tweet);
      if (!actionBar) {
        return;
      }
      insertInActionBar(actionBar, actions);
    }

    function syncPlayerButtons(player) {
      const existing = player.querySelector(`.${api.ACTIONS_CLASS}[data-variant="player"]`);
      if (!shouldShowPlayerButtons(player)) {
        existing?.remove();
        return;
      }

      const meta = extractPlayerMeta(player);
      if (!meta.itemId) {
        existing?.remove();
        return;
      }

      if (existing) {
        api.syncButtonsMeta(existing, meta);
        return;
      }

      const controls = findPlayerControls(player);
      if (!controls) {
        return;
      }

      const actions = api.createActionWrapper(meta, "player", "x");
      const captions = controls.querySelector('[data-testid="captions"]');
      const captionsTarget = findDirectChild(controls, captions);
      controls.insertBefore(actions, captionsTarget?.nextSibling || controls.firstChild);
    }

    function shouldShowPlayerButtons(player) {
      if (/\/status\/\d{8,30}\/video\/\d+/.test(location.pathname)) {
        return true;
      }

      const fullscreen = document.fullscreenElement;
      return !!fullscreen && (fullscreen.contains(player) || player.contains(fullscreen));
    }

    function findPlayerControls(player) {
      const buttons = Array.from(player.querySelectorAll('button, [role="button"]'));
      const anchor = player.querySelector('[data-testid="captions"]') || buttons[buttons.length - 1];
      if (!anchor) {
        return null;
      }

      let node = anchor.parentElement;
      while (node && node !== player) {
        if (node.querySelectorAll('button, [role="button"]').length >= 2) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    function findDirectChild(parent, descendant) {
      if (!parent || !descendant) {
        return null;
      }

      let node = descendant;
      while (node && node.parentElement !== parent) {
        node = node.parentElement;
      }
      return node?.parentElement === parent ? node : null;
    }

    function extractPlayerMeta(player) {
      const currentSourceId = extractStatusId(location.pathname);
      const tweet = player.closest(TWEET_SELECTOR) || findTweetBySourceId(currentSourceId);
      const meta = extractTweetMeta(tweet);
      if (meta.itemId || !currentSourceId) {
        return meta;
      }

      return {
        ...meta,
        itemId: `${ITEM_PREFIX_X}${currentSourceId}`,
        itemUrl: makeTweetUrl(currentSourceId)
      };
    }

    function findTweetBySourceId(sourceId) {
      if (!sourceId) {
        return null;
      }

      const tweets = document.querySelectorAll(TWEET_SELECTOR);
      for (const tweet of tweets) {
        if (extractTweetSourceId(tweet) === sourceId) {
          return tweet;
        }
      }
      return null;
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
        tweetText: "",
        authorName: "",
        authorHandle: "",
        avatarUrl: "",
        platform: "x",
        mediaUrl: "",
        fileId: ""
      };
    }

    function extractTweetMeta(tweetEl) {
      if (!(tweetEl instanceof Element)) {
        return emptyTweetMeta();
      }

      const sourceId = extractTweetSourceId(tweetEl);
      const tweetText = extractTweetText(tweetEl);
      const author = extractTweetAuthor(tweetEl);
      const title = tweetText;
      if (!sourceId) {
        return { ...emptyTweetMeta(), title, tweetText, ...author };
      }

      return {
        itemId: `${ITEM_PREFIX_X}${sourceId}`,
        itemUrl: makeTweetUrl(sourceId),
        title,
        tweetText,
        authorName: author.authorName,
        authorHandle: author.authorHandle,
        avatarUrl: author.avatarUrl,
        platform: "x",
        mediaUrl: "",
        fileId: ""
      };
    }

    function emptyTweetMeta() {
      return {
        itemId: null,
        itemUrl: null,
        title: "",
        tweetText: "",
        authorName: "",
        authorHandle: "",
        avatarUrl: "",
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

    function extractStatusId(value) {
      return String(value || "").match(/status\/(\d{8,30})/)?.[1] || null;
    }

    function extractTweetText(tweetEl) {
      const textNodes = Array.from(tweetEl.querySelectorAll('[data-testid="tweetText"]'))
        .filter((node) => {
          const parentTweetText = node.parentElement?.closest?.('[data-testid="tweetText"]');
          return parentTweetText === null;
        });
      if (!textNodes.length) {
        return "";
      }

      const parts = [];
      for (const node of textNodes) {
        const raw = typeof node.innerText === "string" && node.innerText
          ? node.innerText
          : node.textContent || "";
        const text = normalizeText(raw);
        if (text) {
          parts.push(text);
        }
      }

      return dedupeConsecutive(parts).join("\n\n").slice(0, 5000);
    }

    function extractTweetAuthor(tweetEl) {
      const userName = tweetEl.querySelector('[data-testid="User-Name"]');
      if (!userName) {
        return { authorName: "", authorHandle: "", avatarUrl: extractTweetAvatarUrl(tweetEl) };
      }

      const raw = typeof userName.innerText === "string" && userName.innerText
        ? userName.innerText
        : userName.textContent || "";
      const lines = normalizeText(raw).split("\n").map((line) => line.trim()).filter(Boolean);
      const authorHandle = lines.find((line) => /^@[A-Za-z0-9_]{1,15}$/.test(line)) || "";
      const authorName = lines.find((line) => {
        return line &&
          line !== authorHandle &&
          line !== "·" &&
          !/^@[A-Za-z0-9_]{1,15}$/.test(line) &&
          !/^\d+[smhdw]$/.test(line);
      }) || "";

      return { authorName, authorHandle, avatarUrl: extractTweetAvatarUrl(tweetEl) };
    }

    function extractTweetAvatarUrl(tweetEl) {
      const image = tweetEl.querySelector(
        '[data-testid="Tweet-User-Avatar"] img, [data-testid^="UserAvatar-Container-"] img, img[src*="profile_images"]'
      );
      const raw = image?.currentSrc || image?.getAttribute("src") || "";
      try {
        const url = new URL(raw, location.href);
        return /^https?:$/.test(url.protocol) ? url.toString() : "";
      } catch (_error) {
        return "";
      }
    }

    function normalizeText(value) {
      return String(value || "")
        .replace(/\r/g, "\n")
        .replace(/[ \t\f\v]+/g, " ")
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .replace(/[ \t]+([.,!?;:])/g, "$1");
    }

    function dedupeConsecutive(parts) {
      const result = [];
      for (const part of parts) {
        if (part && part !== result[result.length - 1]) {
          result.push(part);
        }
      }
      return result;
    }

    function makeTweetUrl(tweetId) {
      return `https://x.com/i/web/status/${tweetId}`;
    }
  });
})();
