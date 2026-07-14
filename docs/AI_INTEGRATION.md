# AI integration guide: Spokenly + NVIDIA Parakeet v3

This document is for coding agents and developers adapting X Video Toolkit to
Spokenly's local file-transcription API on macOS.

## Target configuration

- Spokenly is installed and running.
- **NVIDIA Parakeet TDT 0.6B v3** is selected for file transcription.
- Spokenly has downloaded its FluidAudio/Core ML model.
- Spokenly's local server listens on `127.0.0.1:51089`.
- The extension uses no separate Hugging Face or `parakeet-mlx` weights.

The model identifier observed in Spokenly 2.24.3 is `parakeetTDT06`. Treat a
different model identifier as a configuration error rather than silently using
an online provider.

## Discover the local tools

Send JSON-RPC to the loopback server:

```bash
curl -sS -X POST http://127.0.0.1:51089 \
  -H 'Content-Type: application/json' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The response should include `transcribe_file` with:

- `file_path`: absolute local audio/video path;
- `format`: `text`, `srt`, `vtt`, `markdown`, or `json`;
- `speakers`: optional local speaker identification.

## Call transcription

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "transcribe_file",
    "arguments": {
      "file_path": "/absolute/path/audio.wav",
      "format": "json",
      "speakers": false
    }
  }
}
```

Spokenly returns a text content block whose text is itself JSON. The inner
payload contains `modelId` and timed `segments`:

```json
{
  "modelId": "parakeetTDT06",
  "segments": [
    {
      "id": "segment-id",
      "text": "Hello",
      "start": 0.08,
      "end": 0.32
    }
  ]
}
```

Do not assume segment text contains leading spaces. Join word segments with
normal word spacing while avoiding spaces before punctuation. Group segments
ending in `.`, `?`, or `!` to create sentence-level timestamps for SRT and
timestamped-copy output.

## Extension pipeline invariants

An agent changing the ASR backend must preserve these checks:

1. Only explicitly allowed HTTPS media hosts are accepted.
2. Credentials and private/local media hosts are rejected.
3. FFprobe determines the expected media duration when the page did not provide it.
4. FFmpeg writes a temporary 16 kHz mono WAV.
5. Downloaded audio duration must match the source within tolerance.
6. Long transcripts must cover the end of the audio.
7. Incomplete results must not enter history or cache.
8. Temporary audio must be deleted after success or failure.
9. Spokenly must report `parakeetTDT06`; no silent cloud fallback is allowed.

## Migrating from a standalone MLX backend

Before deleting an older backend:

1. Record its package, model path, disk usage, and benchmark on a known fixture.
2. Run that exact fixture through Spokenly.
3. Compare full text, timestamps, duration coverage, cold start, and warm start.
4. Search other projects for the old command and model identifier.
5. Add compatibility or migrate those callers before removal.
6. Remove only the confirmed package/model directories.
7. Run the same fixture after deletion.

`scripts/spokenly_parakeet_compat.py` implements the subset of the historical
`parakeet-mlx` command used by local tools. It writes TXT/JSON/SRT/VTT output but
routes inference to the single Spokenly/Core ML model.

## Verification commands

```bash
npm run check
gitleaks dir . --no-banner --redact
gitleaks git . --no-banner --redact
```

For runtime proof, use a short, non-sensitive fixture with known speech and
verify non-empty text plus plausible final timestamp coverage. Static tests do
not prove that Spokenly is running or that its model is downloaded.

## Failure behavior

- Connection refused: open Spokenly and enable Voice for AI Agents (MCP).
- Wrong model ID: select NVIDIA Parakeet TDT 0.6B v3 for Transcribe File.
- Empty segments: treat as ASR failure; do not cache.
- Missing FFmpeg: install it and rerun the Native Messaging host installer.
- Truncated audio/transcript: retry, then return an explicit error code.

## AI safety note

AI-generated changes must be reviewed against the actual local app version and
the actual JSON response. Spokenly, browser APIs, and model identifiers can
change. Never infer runtime compatibility from documentation alone.
