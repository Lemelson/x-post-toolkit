import assert from "node:assert/strict";
import test from "node:test";

const storage = {};
const storageGetCalls = [];
const tabMessages = [];
let messageListener = null;
let nativeResponder = () => ({
  ok: true,
  transcript: "Verified transcript.",
  sentences: [
    { text: "Verified transcript.", startMs: 0, endMs: 5000 }
  ],
  charCount: 20,
  preview: "Verified transcript.",
  downloadElapsedMs: 5000,
  asrElapsedMs: 8000,
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
          queueMicrotask(async () => {
            const response = await nativeResponder(payload);
            const messages = Array.isArray(response) ? response : [response];
            for (const message of messages) {
              messageListeners[0](message);
            }
          });
        },
        disconnect() {}
      };
    },
    sendNativeMessage() {}
  },
  storage: {
    local: {
      async get(keys) {
        storageGetCalls.push(Array.isArray(keys) ? [...keys] : [keys]);
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
    sendMessage(tabId, message, callback) {
      tabMessages.push({ tabId, message: structuredClone(message) });
      callback?.();
    }
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
  storageGetCalls.length = 0;

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
  assert.match(verified.debugTraceId, /^x:12345678:/);
  assert.equal(
    storageGetCalls.filter((keys) => keys.includes("transcriptsByTweetId")).length,
    2
  );
  assert.equal(
    storage.xvdlTemporaryPerfDiagnosticsV1[0].events.some(
      (event) => event.event === "transcript_history_save_finished"
    ),
    true
  );
  assert.equal(
    storage.xvdlTemporaryPerfDiagnosticsV1[0].events.some(
      (event) => event.event === "content_response_received"
    ),
    false
  );
  assert.deepEqual(
    storage.transcriptionEtaStats.samples.map((sample) => ({
      durationMs: sample.durationMs,
      downloadElapsedMs: sample.downloadElapsedMs,
      asrElapsedMs: sample.asrElapsedMs
    })),
    [{ durationMs: 60000, downloadElapsedMs: 5000, asrElapsedMs: 8000 }]
  );

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

test("does not block transcription on a slow badge API", async () => {
  const originalSetBadgeBackgroundColor = chrome.action.setBadgeBackgroundColor;
  let releaseBadge;
  chrome.action.setBadgeBackgroundColor = () => new Promise((resolve) => {
    releaseBadge = resolve;
  });
  nativeResponder = () => ({
    ok: true,
    transcript: "Badge-independent transcript.",
    sentences: [{ text: "Badge-independent transcript.", startMs: 0, endMs: 5000 }],
    charCount: 29,
    preview: "Badge-independent transcript.",
    downloadElapsedMs: 5000,
    asrElapsedMs: 8000,
    validationVersion: 1,
    expectedDurationMs: 60000,
    audioDurationMs: 60000,
    transcriptEndMs: 5000,
    complete: true
  });

  const request = dispatchMessage({
    type: "TRANSCRIBE_VIDEO_ITEM",
    itemId: "x:44444444",
    itemUrl: "https://x.com/i/web/status/44444444",
    platform: "x"
  });
  const outcome = await Promise.race([
    request.then(() => "completed"),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 25))
  ]);

  releaseBadge?.();
  chrome.action.setBadgeBackgroundColor = originalSetBadgeBackgroundColor;
  await request;
  assert.equal(outcome, "completed");
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

test("progress messages include a personalized ETA for each phase", async () => {
  storage.transcriptionEtaStats = {
    version: 1,
    samples: [1, 2, 3].map((index) => ({
      durationMs: 60000,
      downloadElapsedMs: 6000,
      asrElapsedMs: 12000,
      recordedAt: index
    }))
  };
  tabMessages.length = 0;
  nativeResponder = () => [
    { type: "progress", stage: "downloading", expectedDurationMs: 120000 },
    { type: "progress", stage: "downloaded", downloadElapsedMs: 12000, audioDurationMs: 120000 },
    { type: "progress", stage: "transcribing", audioDurationMs: 120000 },
    {
      ok: true,
      transcript: "x".repeat(300),
      sentences: [{ text: "x".repeat(300), startMs: 0, endMs: 110000 }],
      charCount: 300,
      preview: "x".repeat(220),
      downloadElapsedMs: 12000,
      asrElapsedMs: 24000,
      validationVersion: 1,
      expectedDurationMs: 120000,
      audioDurationMs: 120000,
      transcriptEndMs: 110000,
      complete: true
    }
  ];

  const response = await dispatchMessage({
    type: "TRANSCRIBE_VIDEO_ITEM",
    itemId: "x:55555555",
    itemUrl: "https://x.com/i/web/status/55555555",
    platform: "x"
  }, { tab: { id: 7 } });

  const downloading = tabMessages.find((item) => item.message.stage === "downloading");
  const transcribing = tabMessages.find((item) => item.message.stage === "transcribing");
  assert.equal(response.ok, true);
  assert.equal(downloading.tabId, 7);
  assert.equal(downloading.message.estimatedTotalMs, 12000);
  assert.equal(downloading.message.etaSampleCount, 3);
  assert.equal(transcribing.message.estimatedTotalMs, 24000);
});

test("marks a three-times-slower ASR result and keeps it out of ETA history", async () => {
  storage.transcriptionEtaStats = {
    version: 1,
    samples: [1, 2, 3].map((recordedAt) => ({
      durationMs: 60000,
      downloadElapsedMs: 5000,
      asrElapsedMs: 5000,
      recordedAt
    }))
  };
  nativeResponder = () => ({
    ok: true,
    transcript: "Slow but verified transcript.",
    sentences: [{ text: "Slow but verified transcript.", startMs: 0, endMs: 59000 }],
    charCount: 29,
    preview: "Slow but verified transcript.",
    downloadElapsedMs: 5000,
    asrElapsedMs: 20000,
    validationVersion: 1,
    expectedDurationMs: 60000,
    audioDurationMs: 60000,
    transcriptEndMs: 59000,
    complete: true
  });

  const response = await dispatchMessage({
    type: "TRANSCRIBE_VIDEO_ITEM",
    itemId: "x:66666666",
    itemUrl: "https://x.com/i/web/status/66666666",
    platform: "x"
  });

  assert.equal(response.ok, true);
  assert.equal(response.slowAsr, true);
  assert.equal(response.expectedAsrMs, 5000);
  assert.equal(storage.transcriptionEtaStats.samples.length, 3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    storage.xvdlTemporaryPerfDiagnosticsV1[0].events.some(
      (event) => event.event === "slow_asr_detected"
    ),
    true
  );
});

test("starts independent downloads without waiting for another transcript job", async () => {
  const pendingResults = [];
  let nativeStarts = 0;
  nativeResponder = () => new Promise((resolve) => {
    nativeStarts += 1;
    pendingResults.push(resolve);
  });

  const first = dispatchMessage({
    type: "TRANSCRIBE_VIDEO_ITEM",
    itemId: "x:11111111",
    itemUrl: "https://x.com/i/web/status/11111111",
    platform: "x"
  });
  const second = dispatchMessage({
    type: "TRANSCRIBE_VIDEO_ITEM",
    itemId: "x:22222222",
    itemUrl: "https://x.com/i/web/status/22222222",
    platform: "x"
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nativeStarts, 2);

  for (const resolve of pendingResults) {
    resolve({
      ok: true,
      transcript: "Concurrent preparation verified.",
      sentences: [{ text: "Concurrent preparation verified.", startMs: 0, endMs: 5000 }],
      charCount: 32,
      preview: "Concurrent preparation verified.",
      downloadElapsedMs: 5000,
      asrElapsedMs: 8000,
      validationVersion: 1,
      expectedDurationMs: 60000,
      audioDurationMs: 60000,
      transcriptEndMs: 5000,
      complete: true
    });
  }

  const responses = await Promise.all([first, second]);
  assert.equal(responses.every((response) => response.ok), true);
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
  assert.equal(response.settings.autoCloseMinutes, 5);
  assert.equal(storage.transcriptSettings.retentionHours, 168);
  assert.equal(storage.transcriptSettings.autoCloseMinutes, 5);
  assert.equal(storage.transcriptRetentionWeekMigrated, true);
});

function dispatchMessage(message, sender = {}) {
  return new Promise((resolve) => {
    const keepChannelOpen = messageListener(message, sender, resolve);
    assert.equal(keepChannelOpen, true);
  });
}
