#!/usr/bin/env python3
"""Chrome Native Messaging host for on-demand transcript generation."""

from __future__ import annotations

import json
import os
import ipaddress
import re
import shutil
import struct
import subprocess
import tempfile
import time
from glob import glob
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

FFMPEG_BIN = os.environ.get("XVDL_FFMPEG_BIN", "ffmpeg")
PARAKEET_BIN = os.environ.get("XVDL_PARAKEET_BIN", "parakeet-mlx")
PARAKEET_MODEL = os.environ.get("XVDL_PARAKEET_MODEL", "mlx-community/parakeet-tdt-0.6b-v3")
FFMPEG_TIMEOUT = int(os.environ.get("XVDL_FFMPEG_TIMEOUT", "900"))
ASR_TIMEOUT = int(os.environ.get("XVDL_ASR_TIMEOUT", "2400"))
LOG_PATH = os.path.expanduser("~/Library/Logs/xvdl-native-host.log")
MAX_MEDIA_URL_LENGTH = 8192
ALLOWED_MEDIA_HOSTS = {
  "video.twimg.com",
  "drive.usercontent.google.com",
}
ALLOWED_MEDIA_HOST_SUFFIXES = (
  ".googlevideo.com",
  ".googleusercontent.com",
)


def log_line(message: str) -> None:
  try:
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
      f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
  except Exception:
    return


def resolve_executable(name_or_path: str, extra_candidates: list[str]) -> str:
  if os.path.isabs(name_or_path) and os.path.exists(name_or_path):
    return name_or_path

  found = shutil.which(name_or_path)
  if found:
    return found

  for candidate in extra_candidates:
    if os.path.exists(candidate):
      return candidate

  raise FileNotFoundError(
    f"{name_or_path!r} not found. PATH={os.environ.get('PATH', '')}. "
    f"Tried candidates: {', '.join(extra_candidates)}"
  )


def send_message(payload: dict[str, Any]) -> None:
  raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
  header = struct.pack("<I", len(raw))
  os.write(1, header + raw)


def read_message() -> dict[str, Any] | None:
  header = os.read(0, 4)
  if len(header) == 0:
    return None
  if len(header) < 4:
    raise ValueError("Invalid native message header.")
  length = struct.unpack("<I", header)[0]
  raw = os.read(0, length)
  if len(raw) != length:
    raise ValueError("Invalid native message payload length.")
  return json.loads(raw.decode("utf-8"))


def is_valid_media_url(url: str) -> bool:
  return validate_media_url(url)[0]


def validate_media_url(url: str) -> tuple[bool, str]:
  if not url or len(url) > MAX_MEDIA_URL_LENGTH:
    return False, "URL is empty or too long."

  parsed = urlparse(url)
  hostname = (parsed.hostname or "").lower().rstrip(".")
  if parsed.scheme != "https" or not hostname:
    return False, "Only HTTPS media URLs are supported."

  if parsed.username or parsed.password:
    return False, "Media URL credentials are not allowed."

  if is_private_or_local_hostname(hostname):
    return False, "Private or local media hosts are not allowed."

  if hostname in ALLOWED_MEDIA_HOSTS:
    return True, ""

  if any(hostname.endswith(suffix) for suffix in ALLOWED_MEDIA_HOST_SUFFIXES):
    return True, ""

  return False, "Media host is not supported."


def is_private_or_local_hostname(hostname: str) -> bool:
  if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
    return True

  try:
    ip = ipaddress.ip_address(hostname)
  except ValueError:
    return False

  return (
    ip.is_private
    or ip.is_loopback
    or ip.is_link_local
    or ip.is_multicast
    or ip.is_reserved
    or ip.is_unspecified
  )


def error_payload(code: str, message: str) -> dict[str, Any]:
  return {"ok": False, "code": code, "error": message}


def public_command_error(stderr: str, fallback: str) -> str:
  text = (stderr or "").strip() or fallback
  text = re.sub(r"https?://\S+", "[media-url]", text)
  return text[-500:]


def run_cmd(cmd: list[str], timeout: int) -> None:
  subprocess.run(
    cmd,
    check=True,
    timeout=timeout,
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
  )


def find_transcript_file(directory: str) -> Path:
  txt_files = [Path(path) for path in glob(str(Path(directory) / "*.txt"))]
  if not txt_files:
    raise FileNotFoundError("parakeet-mlx did not produce a .txt transcript file.")
  txt_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
  return txt_files[0]


def transcribe(item_id: str, mp4_url: str, copy_to_clipboard: bool) -> dict[str, Any]:
  started = time.time()
  ffmpeg = resolve_executable(
    FFMPEG_BIN,
    ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"],
  )
  parakeet = resolve_executable(
    PARAKEET_BIN,
    [
      os.path.expanduser("~/.local/bin/parakeet-mlx"),
      "/opt/homebrew/bin/parakeet-mlx",
      "/usr/local/bin/parakeet-mlx",
    ],
  )

  log_line(f"transcribe start item_id={item_id} ffmpeg={ffmpeg} parakeet={parakeet}")

  safe_item_id = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in item_id)[:80] or "item"

  with tempfile.TemporaryDirectory(prefix=f"xvdl_{safe_item_id}_") as tmpdir:
    audio_path = str(Path(tmpdir) / "audio.wav")

    run_cmd(
      [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        mp4_url,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        audio_path,
      ],
      timeout=FFMPEG_TIMEOUT,
    )

    run_cmd(
      [
        parakeet,
        "--model",
        PARAKEET_MODEL,
        "--output-format",
        "txt",
        "--output-dir",
        tmpdir,
        audio_path,
      ],
      timeout=ASR_TIMEOUT,
    )

    txt_path = find_transcript_file(tmpdir)
    transcript = txt_path.read_text(encoding="utf-8", errors="replace").strip()

    if copy_to_clipboard and transcript:
      subprocess.run(["pbcopy"], input=transcript.encode("utf-8"), check=True)

  elapsed_ms = int((time.time() - started) * 1000)
  log_line(f"transcribe done item_id={item_id} chars={len(transcript)} elapsed_ms={elapsed_ms}")
  return {
    "ok": True,
    "itemId": item_id,
    "tweetId": item_id,
    "transcript": transcript,
    "charCount": len(transcript),
    "elapsedMs": elapsed_ms,
    "preview": transcript[:220],
  }


def handle_request(message: dict[str, Any]) -> dict[str, Any]:
  msg_type = str(message.get("type", "")).strip()
  if msg_type == "ping":
    return {
      "ok": True,
      "service": "xvdl-native-host",
      "model": PARAKEET_MODEL,
      "ffmpegBin": FFMPEG_BIN,
      "parakeetBin": PARAKEET_BIN,
    }

  if msg_type != "transcribe":
    return {"ok": False, "error": f"Unsupported message type: {msg_type or 'empty'}"}

  item_id = str(message.get("itemId") or message.get("tweetId") or "").strip()
  mp4_url = str(message.get("mp4Url", "")).strip()
  copy_to_clipboard = bool(message.get("copyToClipboard", True))

  if not item_id:
    return error_payload("INVALID_ITEM_ID", "itemId is required")

  is_valid_url, url_error = validate_media_url(mp4_url)
  if not is_valid_url:
    log_line(f"error invalid-url item_id={item_id} reason={url_error}")
    return error_payload("INVALID_MEDIA_URL", f"mp4Url is invalid: {url_error}")

  try:
    return transcribe(item_id, mp4_url, copy_to_clipboard)
  except FileNotFoundError as exc:
    log_line(f"error file-not-found item_id={item_id} error={exc}")
    return error_payload("MISSING_DEPENDENCY", str(exc))
  except subprocess.TimeoutExpired as exc:
    log_line(f"error timeout item_id={item_id} cmd={' '.join(exc.cmd)}")
    return error_payload("COMMAND_TIMEOUT", "Transcription command timed out.")
  except subprocess.CalledProcessError as exc:
    stderr = (exc.stderr or "").strip()
    message = public_command_error(stderr, f"Command failed: {' '.join(exc.cmd)}")
    log_line(f"error cmd-failed item_id={item_id} message={stderr or message}")
    return error_payload("COMMAND_FAILED", message)
  except Exception as exc:  # noqa: BLE001
    log_line(f"error unexpected item_id={item_id} error={exc}")
    return error_payload("UNEXPECTED_ERROR", str(exc))


def main() -> None:
  try:
    message = read_message()
    if message is None:
      return
    log_line(f"request type={message.get('type')}")
    send_message(handle_request(message))
  except Exception as exc:  # noqa: BLE001
    log_line(f"fatal error={exc}")
    send_message(error_payload("FATAL_ERROR", f"Native host fatal error: {exc}"))


if __name__ == "__main__":
  main()
