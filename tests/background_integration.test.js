import assert from "node:assert/strict";
import test from "node:test";

const storage = {};
let messageListener = null;
let nativeResponder = () => ({
  ok: true,
  transcript: "Verified transcript.",
  sentences: [
    { text: "Verified transcript.", startMs: 0, endMs: 5000 }
  ],
  charCount: 20,
  preview: "Verified transcript.",
  validationVersion: 1,
  expectedDurationMs: 60000,
  audioDurationMs: 60000,
  transcriptEndMs: 5000,
  complete: true
});

globalThis.chrome = {
  runtime: {
    id: "test-extension",
    lastError: null,
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      }
    },
    connectNative() {
      const messageListeners = [];
      return {
        onMessage: {
          addListener(listener) {
            messageListeners.push(listener);
          }
        },
        onDisconnect: {
          addListener() {}
        },
        postMessage(payload) {
          queueMicrotask(() => messageListeners[0](nativeResponder(payload)));
        },
        disconnect() {}
      };
    },
    sendNativeMessage() {}
  },
  storage: {
    local: {
      async get(keys) {
        return Object.fromEntries(
          keys
            .filter((key) => Object.hasOwn(storage, key))
            .map((key) => [key, structuredClone(storage[key])])
        );
      },
      async set(values) {
        Object.assign(storage, structuredClone(values));
      }
    }
  },
  action: {
    async setBadgeBackgroundColor() {},
    async setBadgeText() {}
  },
  tabs: {
    sendMessage() {}
  },
  downloads: {
    async download() {
      return 1;
    }
  }
};

globalThis.fetch = async () => ({
  ok: true,
  async json() {
    return {
      mediaDetails: [
        {
          video_info: {
            duration_millis: 60000,
            variants: [
              {
                content_type: "video/mp4",
                url: "https://video.twimg.com/video/640x360/test.mp4",
                bitrate: 512000
              }
            ]
          }
        }
      ]
    };
  }
});

await import("../background.js");

test("message router transcribes an uncached item and rejects unverified native results", async () => {
  assert.equal(typeof messageListener, "function");

  const verified = await dispatchMessage({
    type: "TRANSCRIBE_VIDEO_ITEM",
    itemId: "x:12345678",
    itemUrl: "https://x.com/i/web/status/12345678",
    title: "Post title",
    platform: "x"
  });

  assert.equal(verified.ok, true);
  assert.equal(verified.cached, false);
  assert.equal(verified.text, "Post title\n\nVerified transcript.");

  nativeResponder = () => ({
    ok: true,
    transcript: "Legacy host transcript.",
    charCount: 23,
    preview: "Legacy host transcript."
  });

  const unverified = await dispatchMessage({
    type: "TRANSCRIBE_VIDEO_ITEM",
    itemId: "x:87654321",
    itemUrl: "https://x.com/i/web/status/87654321",
    platform: "x"
  });

  assert.equal(unverified.ok, false);
  assert.equal(unverified.code, "UNVERIFIED_TRANSCRIPT");
  assert.match(unverified.error, /Reinstall the native host/);
  assert.equal(storage.transcriptsByTweetId["x:87654321"], undefined);
});

test("popup state does not expose legacy entries as downloadable transcripts", async () => {
  storage.transcriptsByTweetId["x:99999999"] = {
    itemId: "x:99999999",
    itemUrl: "https://x.com/i/web/status/99999999",
    platform: "x",
    text: "Legacy transcript.",
    chars: 18,
    updatedAt: Date.now()
  };
  storage.transcriptHistory.unshift({
    itemId: "x:99999999",
    itemUrl: "https://x.com/i/web/status/99999999",
    platform: "x",
    preview: "Legacy transcript.",
    chars: 18,
    updatedAt: Date.now()
  });

  const state = await dispatchMessage({
    type: "GET_POPUP_STATE",
    itemId: "x:99999999",
    itemUrl: "https://x.com/i/web/status/99999999",
    platform: "x"
  });

  assert.equal(state.ok, true);
  assert.equal(state.current, null);
  assert.equal(state.history.some((item) => item.itemId === "x:99999999"), false);
});

test("reuses a verified transcript older than thirty minutes", async () => {
  const itemId = "x:77777777";
  storage.transcriptsByTweetId[itemId] = {
    itemId,
    itemUrl: "https://x.com/i/web/status/77777777",
    platform: "x",
    text: "Saved transcript.",
    sentences: [{ text: "Saved transcript.", startMs: 0, endMs: 5000 }],
    chars: 17,
    preview: "Saved transcript.",
    validationVersion: 1,
    expectedDurationMs: 60000,
    audioDurationMs: 60000,
    transcriptEndMs: 5000,
    complete: true,
    updatedAt: Date.now() - 50 * 60 * 1000
  };

  const response = await dispatchMessage({
    type: "TRANSCRIBE_VIDEO_ITEM",
    itemId,
    itemUrl: "https://x.com/i/web/status/77777777",
    platform: "x"
  });

  assert.equal(response.ok, true);
  assert.equal(response.cached, true);
  assert.equal(response.text, "Saved transcript.");
});

test("migrates the previous three-day default retention to one week", async () => {
  storage.transcriptSettings = {
    maxItems: 10,
    retentionHours: 72,
    includeTitle: true,
    timestampMode: "off"
  };
  delete storage.transcriptRetentionWeekMigrated;

  const response = await dispatchMessage({ type: "GET_POPUP_STATE" });

  assert.equal(response.ok, true);
  assert.equal(response.settings.retentionHours, 168);
  assert.equal(storage.transcriptSettings.retentionHours, 168);
  assert.equal(storage.transcriptRetentionWeekMigrated, true);
});

function dispatchMessage(message, sender = {}) {
  return new Promise((resolve) => {
    const keepChannelOpen = messageListener(message, sender, resolve);
    assert.equal(keepChannelOpen, true);
  });
}
