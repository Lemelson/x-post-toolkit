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
import wave
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse

FFMPEG_BIN = os.environ.get("XVDL_FFMPEG_BIN", "ffmpeg")
SPOKENLY_URL = os.environ.get("XVDL_SPOKENLY_URL", "http://127.0.0.1:51089")
SPOKENLY_MODEL_ID = "parakeetTDT06"
FFMPEG_TIMEOUT = int(os.environ.get("XVDL_FFMPEG_TIMEOUT", "900"))
ASR_TIMEOUT = int(os.environ.get("XVDL_ASR_TIMEOUT", "2400"))
FFMPEG_RW_TIMEOUT_US = int(os.environ.get("XVDL_FFMPEG_RW_TIMEOUT_US", "30000000"))
DOWNLOAD_ATTEMPTS = max(1, int(os.environ.get("XVDL_DOWNLOAD_ATTEMPTS", "3")))
ASR_ATTEMPTS = max(1, int(os.environ.get("XVDL_ASR_ATTEMPTS", "2")))
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


class CommandTimeout(Exception):
  def __init__(self, stage: str, cmd: list[str], timeout: int):
    super().__init__(f"{stage} timed out after {timeout}s")
    self.stage = stage
    self.cmd = cmd
    self.timeout = timeout


class CommandFailed(Exception):
  def __init__(self, stage: str, cmd: list[str], stderr: str):
    super().__init__(public_command_error(stderr, f"{stage} command failed."))
    self.stage = stage
    self.cmd = cmd
    self.stderr = stderr


class IncompleteAudioError(Exception):
  def __init__(self, expected_ms: int, actual_ms: int):
    super().__init__(
      f"Downloaded audio is incomplete: expected about {expected_ms / 1000:.1f}s, "
      f"received {actual_ms / 1000:.1f}s."
    )
    self.expected_ms = expected_ms
    self.actual_ms = actual_ms


class IncompleteTranscriptError(Exception):
  def __init__(self, audio_ms: int, transcript_end_ms: int):
    super().__init__(
      f"Transcription stopped early: audio is {audio_ms / 1000:.1f}s, "
      f"last recognized speech is at {transcript_end_ms / 1000:.1f}s."
    )
    self.audio_ms = audio_ms
    self.transcript_end_ms = transcript_end_ms


class SpokenlyUnavailableError(Exception):
  pass


class SpokenlyResponseError(Exception):
  pass


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
  write_all(1, header + raw)


def write_all(fd: int, data: bytes) -> None:
  view = memoryview(data)
  while view:
    written = os.write(fd, view)
    if written <= 0:
      raise BrokenPipeError("Native message output stream closed before the payload was written.")
    view = view[written:]


def read_exact(fd: int, length: int) -> bytes:
  # os.read may return fewer bytes than requested (pipe buffer boundaries),
  # so keep reading until the full message arrives or the stream closes.
  data = bytearray()
  while len(data) < length:
    chunk = os.read(fd, length - len(data))
    if not chunk:
      break
    data.extend(chunk)
  return bytes(data)


def read_message() -> dict[str, Any] | None:
  header = read_exact(0, 4)
  if len(header) == 0:
    return None
  if len(header) < 4:
    raise ValueError("Invalid native message header.")
  length = struct.unpack("<I", header)[0]
  raw = read_exact(0, length)
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


def run_cmd(cmd: list[str], timeout: int, stage: str) -> subprocess.CompletedProcess[str]:
  try:
    return subprocess.run(
      cmd,
      check=True,
      timeout=timeout,
      capture_output=True,
      text=True,
      encoding="utf-8",
      errors="replace",
    )
  except subprocess.TimeoutExpired as exc:
    raise CommandTimeout(stage, cmd, timeout) from exc
  except subprocess.CalledProcessError as exc:
    raise CommandFailed(stage, cmd, (exc.stderr or "").strip()) from exc


def wav_duration_ms(path: str) -> int:
  with wave.open(path, "rb") as wav_file:
    frame_rate = wav_file.getframerate()
    if frame_rate <= 0:
      return 0
    return int(wav_file.getnframes() * 1000 / frame_rate)


def is_audio_duration_complete(expected_ms: int, actual_ms: int) -> bool:
  if actual_ms <= 0:
    return False
  if expected_ms <= 0:
    return True
  tolerance_ms = max(5000, int(expected_ms * 0.01))
  return actual_ms + tolerance_ms >= expected_ms


def is_transcript_coverage_complete(audio_ms: int, transcript_end_ms: int, char_count: int) -> bool:
  if audio_ms < 120000:
    return True
  if char_count < 200:
    return False
  required_end_ms = max(int(audio_ms * 0.8), audio_ms - 120000)
  return transcript_end_ms >= required_end_ms


def join_spokenly_tokens(tokens: list[str]) -> str:
  text = ""
  for token in tokens:
    clean = str(token or "").strip()
    if not clean:
      continue
    if not text or re.match(r"^[,.;:!?%…\)\]\}]", clean) or clean.startswith(("'", "’")):
      text += clean
    elif text.endswith(("(", "[", "{", "\"", "“")):
      text += clean
    else:
      text += f" {clean}"
  return text.strip()


def parse_spokenly_transcript(payload: dict[str, Any]) -> tuple[str, int, list[dict[str, Any]]]:
  raw_model_id = payload.get("modelId")
  if isinstance(raw_model_id, dict):
    raw_model_id = raw_model_id.get("predefined") or raw_model_id.get("id")
  model_id = str(raw_model_id or "")
  if model_id != SPOKENLY_MODEL_ID:
    raise SpokenlyResponseError(
      f"Spokenly used {model_id or 'an unknown model'} instead of {SPOKENLY_MODEL_ID}. "
      "Select NVIDIA Parakeet TDT 0.6B v3 for file transcription."
    )

  normalized_segments: list[dict[str, Any]] = []
  for segment in payload.get("segments") or []:
    try:
      text = str(segment.get("text") or "").strip()
      start_ms = max(0, int(float(segment.get("start") or 0) * 1000))
      end_ms = max(start_ms, int(float(segment.get("end") or 0) * 1000))
    except (TypeError, ValueError, AttributeError):
      continue
    if text:
      normalized_segments.append({"text": text, "startMs": start_ms, "endMs": end_ms})

  transcript = join_spokenly_tokens([segment["text"] for segment in normalized_segments])
  if not transcript:
    raise SpokenlyResponseError("Spokenly returned an empty transcript.")

  transcript_end_ms = 0
  sentences: list[dict[str, Any]] = []
  sentence_tokens: list[str] = []
  sentence_start_ms = 0
  sentence_end_ms = 0
  for segment in normalized_segments:
    if not sentence_tokens:
      sentence_start_ms = segment["startMs"]
    sentence_tokens.append(segment["text"])
    sentence_end_ms = segment["endMs"]
    transcript_end_ms = max(transcript_end_ms, sentence_end_ms)
    if re.search(r"[.!?][\"'”’\)]*$", segment["text"]):
      sentences.append({
        "text": join_spokenly_tokens(sentence_tokens),
        "startMs": sentence_start_ms,
        "endMs": sentence_end_ms,
      })
      sentence_tokens = []

  if sentence_tokens:
    sentences.append({
      "text": join_spokenly_tokens(sentence_tokens),
      "startMs": sentence_start_ms,
      "endMs": sentence_end_ms,
    })

  return transcript, transcript_end_ms, sentences


def call_spokenly(audio_path: str) -> tuple[str, int, list[dict[str, Any]]]:
  validate_spokenly_url(SPOKENLY_URL)
  request_payload = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "transcribe_file",
      "arguments": {
        "file_path": audio_path,
        "format": "json",
        "speakers": False,
      },
    },
  }
  request = urllib_request.Request(
    SPOKENLY_URL,
    data=json.dumps(request_payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
  )

  try:
    with urllib_request.urlopen(request, timeout=ASR_TIMEOUT) as response:
      response_payload = json.loads(response.read().decode("utf-8"))
  except TimeoutError as error:
    raise CommandTimeout("asr", ["Spokenly"], ASR_TIMEOUT) from error
  except (urllib_error.URLError, ConnectionError, OSError) as error:
    raise SpokenlyUnavailableError(
      "Spokenly is unavailable. Open Spokenly and keep its local server enabled."
    ) from error
  except (json.JSONDecodeError, UnicodeDecodeError) as error:
    raise SpokenlyResponseError("Spokenly returned an invalid response.") from error

  if response_payload.get("error"):
    message = str(response_payload["error"].get("message") or "Spokenly transcription failed.")
    raise SpokenlyResponseError(message)

  try:
    content = response_payload["result"]["content"]
    text_payload = next(item["text"] for item in content if item.get("type") == "text")
    transcript_payload = json.loads(text_payload)
  except (KeyError, StopIteration, TypeError, json.JSONDecodeError) as error:
    raise SpokenlyResponseError("Spokenly returned an incomplete transcription response.") from error

  return parse_spokenly_transcript(transcript_payload)


def validate_spokenly_url(url: str) -> None:
  parsed = urlparse(url)
  if (
    parsed.scheme != "http"
    or (parsed.hostname or "").lower() not in {"127.0.0.1", "localhost", "::1"}
    or parsed.username
    or parsed.password
  ):
    raise SpokenlyUnavailableError("Spokenly URL must use an HTTP loopback address.")


def probe_media_duration_ms(ffmpeg: str, media_url: str) -> int:
  sibling = str(Path(ffmpeg).with_name("ffprobe"))
  ffprobe = resolve_executable(
    sibling if os.path.exists(sibling) else "ffprobe",
    ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"],
  )
  result = run_cmd(
    [
      ffprobe,
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      media_url,
    ],
    timeout=30,
    stage="probe",
  )
  return max(0, int(float(result.stdout.strip()) * 1000))


def send_progress(item_id: str, stage: str, **details: Any) -> None:
  send_message({
    "ok": True,
    "type": "progress",
    "stage": stage,
    "itemId": item_id,
    **details,
  })


def transcribe(
  item_id: str,
  mp4_url: str,
  copy_to_clipboard: bool,
  emit_progress: bool = False,
  expected_duration_ms: int = 0,
) -> dict[str, Any]:
  started = time.time()
  ffmpeg = resolve_executable(
    FFMPEG_BIN,
    ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"],
  )
  if expected_duration_ms <= 0:
    try:
      expected_duration_ms = probe_media_duration_ms(ffmpeg, mp4_url)
    except (CommandFailed, CommandTimeout, FileNotFoundError, ValueError) as error:
      log_line(f"duration probe failed item_id={item_id} error={error}")

  log_line(
    f"transcribe start item_id={item_id} expected_ms={expected_duration_ms} "
    f"ffmpeg={ffmpeg} asr=spokenly-coreml"
  )

  safe_item_id = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in item_id)[:80] or "item"

  with tempfile.TemporaryDirectory(prefix=f"xvdl_{safe_item_id}_") as tmpdir:
    audio_path = str(Path(tmpdir) / "audio.wav")
    download_started = time.time()
    audio_duration_ms = 0
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
      if emit_progress:
        send_progress(
          item_id,
          "downloading",
          attempt=attempt,
          maxAttempts=DOWNLOAD_ATTEMPTS,
        )
      try:
        Path(audio_path).unlink(missing_ok=True)
        run_cmd(
          [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-rw_timeout",
            str(FFMPEG_RW_TIMEOUT_US),
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
          stage="ffmpeg",
        )
        try:
          audio_duration_ms = wav_duration_ms(audio_path)
        except (OSError, wave.Error) as error:
          raise IncompleteAudioError(expected_duration_ms, 0) from error
        if not is_audio_duration_complete(expected_duration_ms, audio_duration_ms):
          raise IncompleteAudioError(expected_duration_ms, audio_duration_ms)
        break
      except (CommandFailed, CommandTimeout, IncompleteAudioError) as error:
        log_line(
          f"download attempt failed item_id={item_id} attempt={attempt}/{DOWNLOAD_ATTEMPTS} "
          f"error={error}"
        )
        if isinstance(error, CommandTimeout):
          raise
        if attempt >= DOWNLOAD_ATTEMPTS:
          raise
        if emit_progress:
          send_progress(
            item_id,
            "retrying-download",
            attempt=attempt + 1,
            maxAttempts=DOWNLOAD_ATTEMPTS,
            error=str(error),
          )
        time.sleep(min(attempt, 2))

    download_elapsed_ms = int((time.time() - download_started) * 1000)
    log_line(
      f"audio ready item_id={item_id} expected_ms={expected_duration_ms} "
      f"actual_ms={audio_duration_ms} elapsed_ms={download_elapsed_ms}"
    )
    if emit_progress:
      send_progress(
        item_id,
        "downloaded",
        downloadElapsedMs=download_elapsed_ms,
        audioDurationMs=audio_duration_ms,
      )

    asr_started = time.time()
    transcript = ""
    transcript_end_ms = 0
    sentences: list[dict[str, Any]] = []
    for attempt in range(1, ASR_ATTEMPTS + 1):
      if emit_progress:
        send_progress(
          item_id,
          "transcribing",
          attempt=attempt,
          maxAttempts=ASR_ATTEMPTS,
          downloadElapsedMs=download_elapsed_ms,
        )
      try:
        transcript, transcript_end_ms, sentences = call_spokenly(audio_path)
        if not is_transcript_coverage_complete(audio_duration_ms, transcript_end_ms, len(transcript)):
          raise IncompleteTranscriptError(audio_duration_ms, transcript_end_ms)
        break
      except (
        CommandTimeout,
        IncompleteTranscriptError,
        SpokenlyResponseError,
        SpokenlyUnavailableError,
      ) as error:
        log_line(
          f"asr attempt failed item_id={item_id} attempt={attempt}/{ASR_ATTEMPTS} "
          f"error={error}"
        )
        if isinstance(error, CommandTimeout):
          raise
        if attempt >= ASR_ATTEMPTS:
          raise
        if emit_progress:
          send_progress(
            item_id,
            "retrying-transcription",
            attempt=attempt + 1,
            maxAttempts=ASR_ATTEMPTS,
            error=str(error),
          )
        time.sleep(min(attempt, 2))

    asr_elapsed_ms = int((time.time() - asr_started) * 1000)
    log_line(
      f"asr ready item_id={item_id} transcript_end_ms={transcript_end_ms} "
      f"chars={len(transcript)} elapsed_ms={asr_elapsed_ms}"
    )

    if copy_to_clipboard and transcript:
      subprocess.run(["pbcopy"], input=transcript.encode("utf-8"), check=True)

  elapsed_ms = int((time.time() - started) * 1000)
  log_line(f"transcribe done item_id={item_id} chars={len(transcript)} elapsed_ms={elapsed_ms}")
  return {
    "ok": True,
    "type": "result",
    "itemId": item_id,
    "tweetId": item_id,
    "transcript": transcript,
    "sentences": sentences,
    "charCount": len(transcript),
    "elapsedMs": elapsed_ms,
    "downloadElapsedMs": download_elapsed_ms,
    "asrElapsedMs": asr_elapsed_ms,
    "validationVersion": 1,
    "expectedDurationMs": expected_duration_ms,
    "audioDurationMs": audio_duration_ms,
    "transcriptEndMs": transcript_end_ms,
    "complete": True,
    "preview": transcript[:220],
  }


def handle_request(message: dict[str, Any]) -> dict[str, Any]:
  msg_type = str(message.get("type", "")).strip()
  if msg_type == "ping":
    return {
      "ok": True,
      "service": "xvdl-native-host",
      "engine": "spokenly-coreml",
      "model": SPOKENLY_MODEL_ID,
      "ffmpegBin": FFMPEG_BIN,
      "downloadAttempts": DOWNLOAD_ATTEMPTS,
      "asrAttempts": ASR_ATTEMPTS,
    }

  if msg_type != "transcribe":
    return {"ok": False, "error": f"Unsupported message type: {msg_type or 'empty'}"}

  item_id = str(message.get("itemId") or message.get("tweetId") or "").strip()
  mp4_url = str(message.get("mp4Url", "")).strip()
  copy_to_clipboard = bool(message.get("copyToClipboard", True))
  emit_progress = bool(message.get("emitProgress", False))
  try:
    expected_duration_ms = max(0, int(float(message.get("expectedDurationMs") or 0)))
  except (TypeError, ValueError):
    expected_duration_ms = 0

  if not item_id:
    return error_payload("INVALID_ITEM_ID", "itemId is required")

  is_valid_url, url_error = validate_media_url(mp4_url)
  if not is_valid_url:
    log_line(f"error invalid-url item_id={item_id} reason={url_error}")
    return error_payload("INVALID_MEDIA_URL", f"mp4Url is invalid: {url_error}")

  try:
    return transcribe(
      item_id,
      mp4_url,
      copy_to_clipboard,
      emit_progress,
      expected_duration_ms,
    )
  except FileNotFoundError as exc:
    log_line(f"error file-not-found item_id={item_id} error={exc}")
    return error_payload("MISSING_DEPENDENCY", str(exc))
  except CommandTimeout as exc:
    log_line(f"error timeout item_id={item_id} stage={exc.stage} timeout={exc.timeout}s")
    if exc.stage == "ffmpeg":
      return error_payload("FFMPEG_TIMEOUT", "ffmpeg timed out while reading or converting the video.")
    return error_payload("ASR_TIMEOUT", "Speech recognition timed out.")
  except CommandFailed as exc:
    log_line(f"error command-failed item_id={item_id} stage={exc.stage} error={exc}")
    code = "DOWNLOAD_FAILED" if exc.stage == "ffmpeg" else "ASR_FAILED"
    return error_payload(code, str(exc))
  except IncompleteAudioError as exc:
    log_line(f"error incomplete-audio item_id={item_id} error={exc}")
    return error_payload("INCOMPLETE_AUDIO", str(exc))
  except IncompleteTranscriptError as exc:
    log_line(f"error incomplete-transcript item_id={item_id} error={exc}")
    return error_payload("INCOMPLETE_TRANSCRIPT", str(exc))
  except SpokenlyUnavailableError as exc:
    log_line(f"error spokenly-unavailable item_id={item_id} error={exc}")
    return error_payload("ASR_UNAVAILABLE", str(exc))
  except SpokenlyResponseError as exc:
    log_line(f"error spokenly-response item_id={item_id} error={exc}")
    return error_payload("ASR_FAILED", str(exc))
  except subprocess.CalledProcessError as exc:
    stderr = (exc.stderr or "").strip()
    message = public_command_error(stderr, f"Command failed: {' '.join(exc.cmd)}")
    log_line(f"error cmd-failed item_id={item_id} message={stderr or message}")
    return error_payload("COMMAND_FAILED", message)
  except Exception as exc:  # noqa: BLE001
    log_line(f"error unexpected item_id={item_id} error={exc}")
    return error_payload("UNEXPECTED_ERROR", str(exc))


def main() -> None:
  # Read messages in a loop so the same process can serve a long-lived
  # connectNative port (used for progress streaming) as well as one-shot
  # sendNativeMessage calls. The loop exits when stdin reaches EOF, which
  # happens as soon as the extension disconnects the port or the one-shot
  # reply has been read.
  while True:
    try:
      message = read_message()
    except Exception as exc:  # noqa: BLE001
      log_line(f"fatal error={exc}")
      send_message(error_payload("FATAL_ERROR", f"Native host fatal error: {exc}"))
      return
    if message is None:
      return
    log_line(f"request type={message.get('type')}")
    try:
      send_message(handle_request(message))
    except Exception as exc:  # noqa: BLE001
      log_line(f"fatal error={exc}")
      send_message(error_payload("FATAL_ERROR", f"Native host fatal error: {exc}"))
      return


if __name__ == "__main__":
  main()
