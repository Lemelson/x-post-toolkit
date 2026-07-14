import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDriveDownloadUrl,
  extractDriveFileId,
  normalizeItemId,
  sanitizeFilename
} from "../src/background/context.js";
import { collectMp4Variants, compareVariantPriority } from "../src/background/media.js";
import { normalizeStore, sanitizeSettings } from "../src/background/store.js";

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
  assert.equal(normalized.history.length, 2);
});

test("sanitizes settings and filenames", () => {
  assert.deepEqual(sanitizeSettings({ maxItems: 999, retentionHours: -4 }), {
    maxItems: 200,
    retentionHours: 1
  });
  assert.equal(sanitizeFilename('bad/name:*?"<>| title'), "bad name title");
});
