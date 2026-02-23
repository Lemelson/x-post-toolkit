# X Post Toolkit

Chrome/Chromium extension for X (Twitter):
- download the best MP4 from a video post,
- transcribe post audio locally,
- keep a configurable transcript history in the popup.

This project is designed for privacy-first local use on macOS and works in Chrome, Comet, Arc, Brave, Edge, Vivaldi, Chromium, and Opera (via Native Messaging host install script).

## Why this project

Most web downloader tools are external websites. This extension keeps the workflow inside your browser:
- inline buttons directly on X posts,
- local transcription (no cloud upload required),
- transcript copied to clipboard automatically,
- quick access to recent transcripts in popup.

## Features

- Inline post actions in X feed and post page:
  - `Download` (best MP4)
  - `Transcript` (local ASR + clipboard)
- Popup actions for current post:
  - `Transcript Current`
  - `Download Video`
  - `Download Transcript (.txt)`
- Transcript history with actions:
  - `Copy`, `TXT`, `Open`, `Link`
- Configurable history policy:
  - max items (default: 10)
  - retention window (default: 3 days / 72 hours)
- 30-minute per-post transcript cache (no repeated model run)
- Sequential queue for transcript jobs (if you click multiple posts quickly)
- Source priority for posts with multiple videos:
  - primary post video first,
  - then retweeted/quoted/nested fallbacks.
- No always-on local server: host process starts only on request and exits after completion

## Privacy and data handling

- Transcription is local via CLI tools on your machine.
- For transcription flow, video is not saved as an MP4 file by the extension.
- Native host uses `ffmpeg` to extract temporary audio in a temp directory; temp files are deleted when done.
- Stored data in extension local storage:
  - transcript text,
  - short preview,
  - tweet ID/url/title snippet,
  - timestamps.
- No telemetry and no external backend in this repo.

## Architecture

- `content.js`: injects action buttons into X UI and sends post metadata.
- `background.js`: resolves media URL, manages queue/cache/history/settings, calls native host.
- `popup.html` + `popup.js`: popup UI, current-post actions, history, settings.
- `scripts/native_host.py`: one-shot Native Messaging host for transcript pipeline.
- `scripts/install_native_host.sh`: installs native host manifest for Chromium browsers.
- `scripts/uninstall_native_host.sh`: removes manifests and wrapper.

## Requirements

- macOS
- `python3`
- `ffmpeg`
- `parakeet-mlx` (or adapt host script for another ASR CLI)
- Browser with Chromium extension support

Quick checks:

```bash
python3 --version
which ffmpeg
which parakeet-mlx
```

## Installation

### 1. Load extension (unpacked)

1. Open your browser extensions page:
   - Chrome: `chrome://extensions`
   - Comet: `comet://extensions`
   - Arc: `arc://extensions`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

### 2. Install native messaging host (one time)

Run from the project root:

```bash
./scripts/install_native_host.sh
```

If auto-detection fails, pass extension ID manually:

```bash
./scripts/install_native_host.sh <EXTENSION_ID>
```

After install:
1. Reload extension.
2. Refresh X tab.

## Usage

### Download video

Click `Download` under a video post.

### Transcribe

Click `Transcript` under a video post:
1. extension resolves best MP4 URL,
2. native host runs `ffmpeg` and `parakeet-mlx`,
3. transcript is copied to clipboard,
4. result is stored in history.

If you click transcript again for the same post within 30 minutes, cache is used.

### Popup

Click extension icon to open popup:
- run actions for current post,
- browse recent transcripts,
- configure history limits.

## NVIDIA Parakeet / Spokenly note

- This project integrates with local `parakeet-mlx` CLI, which is an MLX port workflow compatible with Parakeet-family models.
- If you already use a separate app (for example, Spokenly), this extension does **not** require direct integration with that app process.
- The extension launches its own short-lived host process per transcription request.
- You can swap ASR backend by editing `scripts/native_host.py` (replace the CLI command section).

## Customization

### Replace ASR engine

Edit `scripts/native_host.py`:
- replace `parakeet-mlx` command with your preferred local STT CLI,
- keep output contract (`transcript`, `charCount`, `preview`).

### History defaults

In `background.js`:

```js
const DEFAULT_SETTINGS = {
  maxItems: 10,
  retentionHours: 72
};
```

### Browser host locations

`install_native_host.sh` writes manifests for multiple Chromium browsers.
You can remove unsupported targets by editing `collect_native_host_dirs()`.

## Troubleshooting

### `Native host is unavailable`

1. Re-run install:

```bash
./scripts/install_native_host.sh <EXTENSION_ID>
```

2. Reload extension and refresh X tab.

### `No such file or directory: 'ffmpeg'`

Install `ffmpeg` and verify:

```bash
which ffmpeg
```

### `No downloadable MP4 found`

Some posts embed video in quoted/retweeted structures or restrict media delivery.
This repo prioritizes the main post video and falls back to quoted/retweeted/nested media when needed.
Some posts may still be inaccessible due to platform-side constraints.

### `__pycache__` load errors

```bash
find . -type f -name "*.pyc" -delete
find . -type d -name "__pycache__" -exec rmdir {} \; 2>/dev/null
```

## Security notes for public repo

Before publishing your own fork/version:
- do not commit personal absolute paths,
- do not commit browser profile files,
- do not commit extension IDs tied to private profiles,
- do not commit tokens or API keys.

## License

MIT
