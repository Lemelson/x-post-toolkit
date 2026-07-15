import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDriveDownloadUrl,
  getItemContext,
  extractDriveFileId,
  normalizeItemId,
  sanitizeFilename
} from "../src/background/context.js";
import {
  buildSrt,
  buildTimestampedText,
  buildTranscriptOutput
} from "../src/background/format.js";
import {
  collectAudioPlaylists,
  collectMp4Variants,
  compareTranscriptVariantPriority,
  compareVariantPriority,
  getFromSyndication,
  resolveMediaCandidates,
  syndicationToken
} from "../src/background/media.js";
import {
  runNativeTranscription,
  sendNativeMessage,
  sendNativeTranscribeWithProgress
} from "../src/background/native.js";
import {
  isTranscriptCacheUsable,
  isTranscriptVerified,
  normalizeStore,
  sanitizeSettings
} from "../src/background/store.js";

test("normalizes X and Google Drive item ids", () => {
  assert.equal(
    normalizeItemId("", undefined, "https://x.com/yasminekho/status/2059261532194869747"),
    "x:2059261532194869747"
  );

  assert.equal(
    normalizeItemId("", "gdrive", "https://drive.google.com/file/d/1abcDEFghi_JklMNop/view?resourcekey=rk"),
    "gdrive:1abcDEFghi_JklMNop"
  );
});

test("extracts Drive file ids from common URL shapes", () => {
  assert.equal(
    extractDriveFileId("https://drive.google.com/file/d/1abcDEFghi_JklMNop/view"),
    "1abcDEFghi_JklMNop"
  );
  assert.equal(
    extractDriveFileId("https://drive.google.com/open?id=1abcDEFghi_JklMNop"),
    "1abcDEFghi_JklMNop"
  );
});

test("preserves full X tweet metadata separately from the title snippet", () => {
  const tweetText = [
    "@naval said this thing like, 'It's really hard to build a restaurant that's really successful.'",
    "@alexhormozi on his advice for young people:"
  ].join("\n\n");

  const context = getItemContext({
    itemId: "x:12345678",
    itemUrl: "https://x.com/tbpn/status/12345678",
    platform: "x",
    title: tweetText,
    tweetText,
    authorName: "TBPN",
    authorHandle: "tbpn"
  });

  assert.equal(context.title.length <= 180, true);
  assert.equal(context.tweetText, tweetText);
  assert.equal(context.authorName, "TBPN");
  assert.equal(context.authorHandle, "@tbpn");
});

test("preserves Drive resource keys in download URLs", () => {
  const url = new URL(buildDriveDownloadUrl(
    "1abcDEFghi_JklMNop",
    "https://drive.google.com/file/d/1abcDEFghi_JklMNop/view?resourcekey=abc123"
  ));

  assert.equal(url.hostname, "drive.usercontent.google.com");
  assert.equal(url.searchParams.get("id"), "1abcDEFghi_JklMNop");
  assert.equal(url.searchParams.get("resourcekey"), "abc123");
});

test("collects and ranks X MP4 variants by source priority then bitrate", () => {
  const variants = collectMp4Variants({
    mediaDetails: [
      {
        video_info: {
          duration_millis: 1081466,
          variants: [
            { content_type: "application/x-mpegURL", url: "https://video.twimg.com/master.m3u8" },
            { content_type: "video/mp4", url: "https://video.twimg.com/direct-low.mp4", bitrate: 256000 },
            { content_type: "video/mp4", url: "https://video.twimg.com/direct-high.mp4", bitrate: 1024000 }
          ]
        }
      }
    ],
    quoted_tweet: {
      mediaDetails: [
        {
          video_info: {
            variants: [
              { content_type: "video/mp4", url: "https://video.twimg.com/quoted-high.mp4", bitrate: 2048000 }
            ]
          }
        }
      ]
    }
  }).sort(compareVariantPriority);

  assert.deepEqual(
    variants.map((variant) => variant.url),
    [
      "https://video.twimg.com/direct-high.mp4",
      "https://video.twimg.com/direct-low.mp4",
      "https://video.twimg.com/quoted-high.mp4"
    ]
  );
});

test("selects the lightest MP4 with full-quality audio and keeps HLS as fallback", async () => {
  const previousFetch = globalThis.fetch;
  const masterUrl = "https://video.twimg.com/video/master.m3u8?v=1";
  const payload = {
    mediaDetails: [
      {
        video_info: {
          duration_millis: 1081466,
          variants: [
            { content_type: "application/x-mpegURL", url: masterUrl },
            { content_type: "video/mp4", url: "https://video.twimg.com/video/480x270/low.mp4", bitrate: 256000 },
            { content_type: "video/mp4", url: "https://video.twimg.com/video/1280x720/mid.mp4", bitrate: 2176000 },
            { content_type: "video/mp4", url: "https://video.twimg.com/video/1920x1080/high.mp4", bitrate: 10368000 }
          ]
        }
      }
    ]
  };
  const masterPlaylist = [
    "#EXTM3U",
    '#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-32000",URI="/video/audio/32000/index.m3u8"',
    '#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-128000",URI="/video/audio/128000/index.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=192378,RESOLUTION=480x270,AUDIO="audio-32000"',
    "/video/480x270/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=1648677,RESOLUTION=1280x720,AUDIO="audio-128000"',
    "/video/1280x720/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=5525514,RESOLUTION=1920x1080,AUDIO="audio-128000"',
    "/video/1920x1080/index.m3u8"
  ].join("\n");

  globalThis.fetch = async (url) => {
    if (String(url).includes("tweet-result")) {
      return {
        ok: true,
        async json() {
          return payload;
        }
      };
    }
    if (String(url) === masterUrl) {
      return {
        ok: true,
        async text() {
          return masterPlaylist;
        }
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const candidates = await getFromSyndication("12345678", { purpose: "transcript" });
    assert.deepEqual(
      candidates.map((candidate) => [candidate.bitrate, candidate.url]),
      [
        [2176000, "https://video.twimg.com/video/1280x720/mid.mp4"],
        [128000, "https://video.twimg.com/video/audio/128000/index.m3u8"],
        [10368000, "https://video.twimg.com/video/1920x1080/high.mp4"],
        [256000, "https://video.twimg.com/video/480x270/low.mp4"]
      ]
    );
    assert.equal(candidates[0].durationMs, 1081466);

    const resolved = await resolveMediaCandidates(
      {
        platform: "x",
        sourceId: "12345678",
        title: "",
        mediaUrl: ""
      },
      "transcript"
    );
    assert.equal(resolved[0].url, "https://video.twimg.com/video/1280x720/mid.mp4");
    assert.equal(resolved[0].durationMs, 1081466);
  } finally {
    restoreGlobal("fetch", previousFetch);
  }
});

test("parses audio renditions and ranks transcript MP4 fallbacks by source then ascending bitrate", () => {
  const playlists = collectAudioPlaylists(
    [
      "#EXTM3U",
      '#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-64000",URI="audio/64.m3u8"',
      '#EXT-X-MEDIA:NAME="Audio",TYPE=AUDIO,GROUP-ID="audio-128000",URI="/audio/128.m3u8"'
    ].join("\n"),
    "https://video.twimg.com/path/master.m3u8"
  );

  assert.deepEqual(
    playlists.map((playlist) => [playlist.bitrate, playlist.url]),
    [
      [128000, "https://video.twimg.com/audio/128.m3u8"],
      [64000, "https://video.twimg.com/path/audio/64.m3u8"]
    ]
  );

  const variants = [
    { source: "cdn.syndication:quoted", bitrate: 128000 },
    { source: "cdn.syndication", bitrate: 1024000, audioBitrate: 128000 },
    { source: "cdn.syndication", bitrate: 256000, audioBitrate: 32000 },
    { source: "cdn.syndication", bitrate: 512000, audioBitrate: 128000 }
  ].sort(compareTranscriptVariantPriority);
  assert.deepEqual(variants.map((variant) => variant.bitrate), [512000, 1024000, 256000, 128000]);
});

test("normalizes transcript store by retention and max item settings", () => {
  const now = Date.UTC(2026, 4, 27, 12);
  const old = now - 80 * 60 * 60 * 1000;
  const recent = now - 10 * 60 * 1000;
  const newer = now - 5 * 60 * 1000;

  const normalized = normalizeStore(
    {
      byId: {
        "x:11111111": {
          itemId: "x:11111111",
          platform: "x",
          text: "expired",
          preview: "expired",
          updatedAt: old
        },
        "x:22222222": {
          itemId: "x:22222222",
          platform: "x",
          text: "kept text",
          preview: "kept",
          validationVersion: 1,
          expectedDurationMs: 120000,
          audioDurationMs: 120100,
          transcriptEndMs: 119000,
          complete: true,
          updatedAt: recent
        }
      },
      history: [
        {
          itemId: "x:22222222",
          platform: "x",
          preview: "history metadata only",
          updatedAt: newer
        },
        {
          itemId: "x:33333333",
          platform: "x",
          text: "second kept",
          preview: "second",
          updatedAt: recent - 1
        }
      ]
    },
    { maxItems: 2, retentionHours: 72 },
    now
  );

  assert.deepEqual(Object.keys(normalized.byId), ["x:22222222", "x:33333333"]);
  assert.equal(normalized.byId["x:22222222"].text, "kept text");
  assert.equal(normalized.byId["x:22222222"].audioDurationMs, 120100);
  assert.equal(normalized.history.length, 2);
});

test("keeps all fresh transcripts cached when visible history is limited", () => {
  const now = Date.UTC(2026, 6, 3, 12);
  const byId = Object.fromEntries(
    ["11111111", "22222222", "33333333"].map((id, index) => [
      `x:${id}`,
      {
        itemId: `x:${id}`,
        platform: "x",
        text: `transcript ${id}`,
        preview: id,
        updatedAt: now - index * 1000
      }
    ])
  );

  const normalized = normalizeStore(
    { byId, history: [] },
    { maxItems: 2, retentionHours: 168 },
    now
  );

  assert.equal(Object.keys(normalized.byId).length, 3);
  assert.deepEqual(
    normalized.history.map((item) => item.itemId),
    ["x:11111111", "x:22222222"]
  );
});

test("serves only fresh transcripts that passed duration and coverage validation", () => {
  const now = Date.UTC(2026, 6, 2, 12);
  const valid = {
    text: "x".repeat(18814),
    chars: 18814,
    updatedAt: now - 1000,
    validationVersion: 1,
    complete: true,
    expectedDurationMs: 1081466,
    audioDurationMs: 1081514,
    transcriptEndMs: 1079520
  };

  assert.equal(isTranscriptCacheUsable(valid, now, 30 * 60 * 1000), true);
  assert.equal(isTranscriptVerified(valid), true);
  assert.equal(isTranscriptCacheUsable(null, now, 30 * 60 * 1000), false);
  assert.equal(isTranscriptCacheUsable({ ...valid, complete: false }, now, 30 * 60 * 1000), false);
  assert.equal(isTranscriptVerified({ text: "legacy" }), false);
  assert.equal(
    isTranscriptVerified({
      ...valid,
      text: "x".repeat(1257),
      chars: 1257,
      transcriptEndMs: 65000
    }),
    false
  );
  assert.equal(isTranscriptCacheUsable({ text: "legacy", updatedAt: now - 1000 }, now, 30 * 60 * 1000), false);
  assert.equal(
    isTranscriptCacheUsable({ ...valid, updatedAt: now - 31 * 60 * 1000 }, now, 30 * 60 * 1000),
    false
  );
});

test("sanitizes settings and filenames", () => {
  assert.deepEqual(sanitizeSettings({ maxItems: 999, retentionHours: -4 }), {
    maxItems: 200,
    retentionHours: 1,
    includeTitle: true,
    timestampMode: "off"
  });
  assert.deepEqual(
    sanitizeSettings({ includeTitle: false, timestampMode: "s30" }),
    { maxItems: 10, retentionHours: 168, includeTitle: false, timestampMode: "s30" }
  );
  assert.equal(sanitizeSettings({ timestampMode: "bogus" }).timestampMode, "off");
  assert.equal(sanitizeFilename('bad/name:*?"<>| title'), "bad name title");
});

test("computes the syndication token from the tweet id", () => {
  // Same formula as Twitter's embed widget: ((id / 1e15) * PI).toString(36)
  // with zeros and the dot stripped.
  const id = "1759238483212819788";
  const expected = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  assert.equal(syndicationToken(id), expected);
  assert.ok(expected.length > 3);
  assert.equal(syndicationToken(""), "x");
});

test("formats timestamped transcripts by interval and per sentence", () => {
  const sentences = [
    { text: "First.", startMs: 0, endMs: 4000 },
    { text: "Second.", startMs: 5000, endMs: 9000 },
    { text: "Third.", startMs: 31000, endMs: 35000 },
    { text: "Fourth.", startMs: 65000, endMs: 69000 }
  ];

  assert.equal(
    buildTimestampedText(sentences, "s30"),
    "[0:00] First. Second.\n[0:31] Third.\n[1:05] Fourth."
  );
  assert.equal(
    buildTimestampedText(sentences, "all"),
    "[0:00] First.\n[0:05] Second.\n[0:31] Third.\n[1:05] Fourth."
  );
  assert.equal(buildTimestampedText([], "s30"), "");
});

test("builds transcript output honoring title and timestamp settings", () => {
  const entry = {
    title: "Post title",
    text: "First. Second.",
    sentences: [
      { text: "First.", startMs: 0, endMs: 4000 },
      { text: "Second.", startMs: 35000, endMs: 39000 }
    ]
  };

  assert.equal(
    buildTranscriptOutput(entry, { includeTitle: true, timestampMode: "off" }),
    "Post title\n\nFirst. Second."
  );
  assert.equal(
    buildTranscriptOutput(entry, { includeTitle: false, timestampMode: "s30" }),
    "[0:00] First.\n[0:35] Second."
  );
  // Explicit "timestamps" request falls back to a 30s grid when the global
  // setting is off; "clean" strips timecodes regardless of the setting.
  assert.equal(
    buildTranscriptOutput(entry, { includeTitle: false, timestampMode: "off" }, "timestamps"),
    "[0:00] First.\n[0:35] Second."
  );
  assert.equal(
    buildTranscriptOutput(entry, { includeTitle: false, timestampMode: "all" }, "clean"),
    "First. Second."
  );
  // Entries without stored sentences degrade to plain text.
  assert.equal(
    buildTranscriptOutput({ title: "", text: "Plain." }, { includeTitle: true, timestampMode: "all" }),
    "Plain."
  );
});

test("builds X transcript output with author and full tweet text", () => {
  const entry = {
    platform: "x",
    title: "@naval",
    tweetText: "@naval said this thing like, 'It's really hard.'\n\n@alexhormozi on his advice for young people:",
    authorName: "TBPN",
    authorHandle: "@tbpn",
    text: "Video transcript."
  };

  assert.equal(
    buildTranscriptOutput(entry, { includeTitle: true, timestampMode: "off" }),
    [
      "Tweet author: TBPN (@tbpn)",
      "Tweet text:\n@naval said this thing like, 'It's really hard.'\n\n@alexhormozi on his advice for young people:",
      "Video transcript:\nVideo transcript."
    ].join("\n\n")
  );
});

test("builds SRT subtitles from stored sentences", () => {
  const srt = buildSrt([
    { text: "First.", startMs: 0, endMs: 4000 },
    { text: "Second.", startMs: 3661500, endMs: 3665000 }
  ]);

  assert.equal(
    srt,
    [
      "1",
      "00:00:00,000 --> 00:00:04,000",
      "First.",
      "",
      "2",
      "01:01:01,500 --> 01:01:05,000",
      "Second.",
      ""
    ].join("\n")
  );
});

test("keeps stored sentences when merging history metadata", () => {
  const now = Date.UTC(2026, 6, 2, 12);
  const normalized = normalizeStore(
    {
      byId: {
        "x:22222222": {
          itemId: "x:22222222",
          platform: "x",
          text: "kept text",
          sentences: [{ text: "kept text", startMs: 0, endMs: 2000 }],
          validationVersion: 1,
          expectedDurationMs: 120000,
          audioDurationMs: 120100,
          transcriptEndMs: 119000,
          complete: true,
          updatedAt: now - 1000
        }
      },
      history: [
        { itemId: "x:22222222", platform: "x", preview: "meta only", updatedAt: now - 500 }
      ]
    },
    { maxItems: 10, retentionHours: 72 },
    now
  );

  assert.equal(normalized.byId["x:22222222"].sentences.length, 1);
  assert.equal(normalized.history[0].hasTimestamps, true);
});

test("times out native messages when Chrome never calls back", async () => {
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      sendNativeMessage() {}
    }
  };

  try {
    await assert.rejects(
      () => sendNativeMessage({ type: "ping" }, { timeoutMs: 5 }),
      /Timed out waiting for native host ping after 1s/
    );
  } finally {
    restoreGlobal("chrome", previousChrome);
  }
});

test("preserves native transcriber error codes", async () => {
  const previousChrome = globalThis.chrome;
  // runNativeTranscription always uses connectNative now (the open port keeps
  // the MV3 service worker alive), so mock the port API.
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      connectNative() {
        const listeners = [];
        return {
          onMessage: {
            addListener(listener) {
              listeners.push(listener);
            }
          },
          onDisconnect: {
            addListener() {}
          },
          postMessage() {
            queueMicrotask(() => {
              listeners[0]({
                ok: false,
                code: "FFMPEG_TIMEOUT",
                error: "ffmpeg timed out while reading or converting the video."
              });
            });
          },
          disconnect() {}
        };
      }
    }
  };

  try {
    await assert.rejects(
      () => runNativeTranscription("x:12345678", "https://video.twimg.com/file.mp4"),
      (error) => error?.code === "FFMPEG_TIMEOUT" && /ffmpeg timed out/.test(error.message)
    );
  } finally {
    restoreGlobal("chrome", previousChrome);
  }
});

test("streams native transcription progress before the final response", async () => {
  const previousChrome = globalThis.chrome;
  const messageListeners = [];
  const disconnectListeners = [];
  const port = {
    onMessage: {
      addListener(listener) {
        messageListeners.push(listener);
      }
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.push(listener);
      }
    },
    postMessage() {
      queueMicrotask(() => {
        messageListeners[0]({ type: "progress", stage: "downloading" });
        messageListeners[0]({ type: "progress", stage: "transcribing", downloadElapsedMs: 1250 });
        messageListeners[0]({ ok: true, transcript: "done" });
      });
    },
    disconnect() {}
  };
  globalThis.chrome = {
    runtime: {
      id: "test-extension",
      connectNative() {
        return port;
      }
    }
  };

  try {
    const stages = [];
    const response = await sendNativeTranscribeWithProgress(
      { type: "transcribe" },
      (message) => stages.push(message.stage),
      { timeoutMs: 100 }
    );
    assert.deepEqual(stages, ["downloading", "transcribing"]);
    assert.equal(response.transcript, "done");
  } finally {
    restoreGlobal("chrome", previousChrome);
  }
});

test("times out X syndication media lookup", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  });

  try {
    await assert.rejects(
      () => getFromSyndication("12345678", { timeoutMs: 5 }),
      /Media lookup timed out after 1s/
    );
  } finally {
    restoreGlobal("fetch", previousFetch);
  }
});

function restoreGlobal(name, value) {
  if (value === undefined) {
    delete globalThis[name];
    return;
  }
  globalThis[name] = value;
}
