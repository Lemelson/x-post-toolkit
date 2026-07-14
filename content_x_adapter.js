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
      },
      getButtonContext(button) {
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

      const existing = tweet.querySelector(`.${api.ACTIONS_CLASS}`);
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
  });
})();
