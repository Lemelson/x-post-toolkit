#!/usr/bin/env python3
"""Compatibility CLI that routes legacy parakeet-mlx calls through Spokenly."""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import sys
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse

SPOKENLY_URL = os.environ.get("SPOKENLY_URL", "http://127.0.0.1:51089")
SPOKENLY_MODEL_ID = "parakeetTDT06"
PREFERENCES_PATH = Path.home() / "Library/Preferences/app.spokenly.plist"


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(
    prog="parakeet-mlx",
    description="Transcribe through Spokenly's local Core ML Parakeet v3 model.",
  )
  parser.add_argument("audios", nargs="+")
  parser.add_argument("--model")
  parser.add_argument("--output-dir", type=Path, default=Path.cwd())
  parser.add_argument("--output-format", choices=("txt", "json", "srt", "vtt"), default="srt")
  parser.add_argument("--output-template")
  parser.add_argument("--chunk-duration")
  parser.add_argument("--overlap-duration")
  parser.add_argument("--cache-dir")
  parser.add_argument("--verbose", "-v", action="store_true")
  parser.add_argument("--fp32", action="store_true")
  parser.add_argument("--bf16", action="store_true")
  parser.add_argument("--local-attention", action="store_true")
  parser.add_argument("--full-attention", action="store_true")
  return parser


def selected_file_model(preferences_path: Path = PREFERENCES_PATH) -> str:
  try:
    with preferences_path.open("rb") as stream:
      preferences = plistlib.load(stream)
  except (OSError, plistlib.InvalidFileException) as error:
    raise RuntimeError("Could not read Spokenly preferences. Open Spokenly first.") from error
  raw_value = preferences.get("fileTranscriptionVoiceModelID") or ""
  if isinstance(raw_value, bytes):
    try:
      raw_value = raw_value.decode("utf-8")
    except UnicodeDecodeError:
      return ""
  if isinstance(raw_value, str):
    try:
      decoded = json.loads(raw_value)
      if isinstance(decoded, str):
        return decoded
    except json.JSONDecodeError:
      pass
  return str(raw_value)


def verify_selected_model(preferences_path: Path = PREFERENCES_PATH) -> None:
  model_id = selected_file_model(preferences_path)
  if model_id != SPOKENLY_MODEL_ID:
    raise RuntimeError(
      f"Spokenly file transcription uses {model_id or 'an unknown model'}, not {SPOKENLY_MODEL_ID}. "
      "Select NVIDIA Parakeet TDT 0.6B v3 in Spokenly."
    )


def transcribe_file(audio_path: Path, output_format: str) -> str:
  parsed_url = urlparse(SPOKENLY_URL)
  if (
    parsed_url.scheme != "http"
    or (parsed_url.hostname or "").lower() not in {"127.0.0.1", "localhost", "::1"}
    or parsed_url.username
    or parsed_url.password
  ):
    raise RuntimeError("Spokenly URL must use an HTTP loopback address.")
  spokenly_format = "text" if output_format == "txt" else output_format
  payload = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "transcribe_file",
      "arguments": {
        "file_path": str(audio_path.resolve()),
        "format": spokenly_format,
        "speakers": False,
      },
    },
  }
  request = urllib_request.Request(
    SPOKENLY_URL,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
  )
  try:
    with urllib_request.urlopen(request, timeout=2400) as response:
      body = json.loads(response.read().decode("utf-8"))
  except (urllib_error.URLError, OSError, json.JSONDecodeError) as error:
    raise RuntimeError("Spokenly is unavailable or returned an invalid response.") from error

  if body.get("error"):
    raise RuntimeError(str(body["error"].get("message") or "Spokenly transcription failed."))
  try:
    return next(item["text"] for item in body["result"]["content"] if item.get("type") == "text")
  except (KeyError, StopIteration, TypeError) as error:
    raise RuntimeError("Spokenly returned an incomplete transcription response.") from error


def output_path(audio_path: Path, output_dir: Path, output_format: str) -> Path:
  return output_dir / f"{audio_path.stem}.{output_format}"


def main(argv: list[str] | None = None) -> int:
  args = build_parser().parse_args(argv)
  try:
    verify_selected_model()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for audio in args.audios:
      audio_path = Path(audio).expanduser()
      if not audio_path.is_file():
        raise RuntimeError(f"Audio file not found: {audio_path}")
      transcript = transcribe_file(audio_path, args.output_format)
      destination = output_path(audio_path, args.output_dir, args.output_format)
      destination.write_text(transcript.strip() + "\n", encoding="utf-8")
      print(f"Spokenly Parakeet v3 transcription saved to '{destination}'.")
    return 0
  except RuntimeError as error:
    print(str(error), file=sys.stderr)
    return 1


if __name__ == "__main__":
  raise SystemExit(main())
