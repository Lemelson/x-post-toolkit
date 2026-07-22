import importlib.util
import pathlib
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("native_host", ROOT / "scripts" / "native_host.py")
native_host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native_host)


class NativeHostUrlValidationTest(unittest.TestCase):
  def test_accepts_supported_media_hosts(self):
    self.assertTrue(native_host.is_valid_media_url("https://video.twimg.com/ext_tw_video/abc/vid/720x720/file.mp4"))
    self.assertTrue(native_host.is_valid_media_url("https://drive.usercontent.google.com/download?id=file&export=download"))
    self.assertTrue(native_host.is_valid_media_url("https://rr2---sn.googlevideo.com/videoplayback?id=file"))
    self.assertTrue(native_host.is_valid_media_url("https://foo.googleusercontent.com/video.mp4"))

  def test_rejects_unsupported_or_private_media_hosts(self):
    rejected = [
      "http://video.twimg.com/file.mp4",
      "https://video.twimg.com.evil.example/file.mp4",
      "https://localhost/file.mp4",
      "https://127.0.0.1/file.mp4",
      "https://10.0.0.2/file.mp4",
      "https://example.com/file.mp4",
      "https://user:pass@video.twimg.com/file.mp4",
      "https://video.twimg.com/" + "a" * native_host.MAX_MEDIA_URL_LENGTH,
    ]

    for url in rejected:
      with self.subTest(url=url):
        self.assertFalse(native_host.is_valid_media_url(url))

  def test_public_command_error_redacts_urls(self):
    text = native_host.public_command_error("failed to open https://video.twimg.com/private.mp4 because invalid argument", "")
    self.assertNotIn("https://video.twimg.com/private.mp4", text)
    self.assertIn("[media-url]", text)
    self.assertIn("invalid argument", text)

  def test_progress_message_includes_stage_timing(self):
    with mock.patch.object(native_host, "send_message") as send_message:
      native_host.send_progress("x:12345678", "downloaded", downloadElapsedMs=1250)

    send_message.assert_called_once_with({
      "ok": True,
      "type": "progress",
      "stage": "downloaded",
      "itemId": "x:12345678",
      "downloadElapsedMs": 1250,
    })

  def test_spokenly_slot_serializes_asr_across_native_host_processes(self):
    with mock.patch.object(native_host.fcntl, "flock") as flock:
      with native_host.spokenly_slot():
        pass

    self.assertEqual(
      flock.call_args_list,
      [
        mock.call(mock.ANY, native_host.fcntl.LOCK_EX),
        mock.call(mock.ANY, native_host.fcntl.LOCK_UN),
      ],
    )

  def test_rejects_truncated_audio_and_transcript_coverage(self):
    self.assertTrue(native_host.is_audio_duration_complete(1081466, 1081514))
    self.assertFalse(native_host.is_audio_duration_complete(1081466, 65000))
    self.assertTrue(native_host.is_transcript_coverage_complete(1081514, 1079520, 18814))
    self.assertFalse(native_host.is_transcript_coverage_complete(1081514, 65000, 1257))
    self.assertFalse(native_host.is_transcript_coverage_complete(1081514, 0, 0))

  def test_retries_incomplete_download_and_transcription_before_success(self):
    with (
      mock.patch.object(native_host, "resolve_executable", return_value="/tmp/ffmpeg"),
      mock.patch.object(native_host, "run_cmd") as run_cmd,
      mock.patch.object(native_host, "wav_duration_ms", side_effect=[65000, 1081514]),
      mock.patch.object(
        native_host,
        "call_spokenly",
        side_effect=[
          ("x" * 1257, 65000, []),
          ("x" * 18814, 1079520, [{"text": "x" * 18814, "startMs": 0, "endMs": 1079520}]),
        ],
      ),
      mock.patch.object(native_host, "send_progress") as send_progress,
      mock.patch.object(native_host.time, "sleep"),
    ):
      result = native_host.transcribe(
        "x:12345678",
        "https://video.twimg.com/file.mp4",
        False,
        emit_progress=True,
        expected_duration_ms=1081466,
      )

    stages = [call.args[1] for call in send_progress.call_args_list]
    command_stages = [call.kwargs["stage"] for call in run_cmd.call_args_list]
    downloading = next(call for call in send_progress.call_args_list if call.args[1] == "downloading")
    transcribing = next(call for call in send_progress.call_args_list if call.args[1] == "transcribing")
    self.assertEqual(command_stages, ["ffmpeg", "ffmpeg"])
    self.assertIn("retrying-download", stages)
    self.assertIn("retrying-transcription", stages)
    self.assertLess(stages.index("downloaded"), stages.index("waiting-transcription"))
    self.assertLess(stages.index("waiting-transcription"), stages.index("transcribing"))
    self.assertEqual(downloading.kwargs["expectedDurationMs"], 1081466)
    self.assertEqual(transcribing.kwargs["audioDurationMs"], 1081514)
    self.assertGreaterEqual(transcribing.kwargs["queueElapsedMs"], 0)
    self.assertTrue(result["complete"])
    self.assertGreaterEqual(result["queueElapsedMs"], 0)
    self.assertEqual(result["audioDurationMs"], 1081514)
    self.assertEqual(result["transcriptEndMs"], 1079520)
    self.assertEqual(len(result["sentences"]), 1)
    self.assertEqual(result["sentences"][0]["endMs"], 1079520)

  def test_read_exact_reassembles_partial_pipe_reads(self):
    chunks = [b"\x0f\x00", b"\x00\x00", b'{"type"', b':"ping"}']

    def fake_read(_fd, _length):
      return chunks.pop(0) if chunks else b""

    with mock.patch.object(native_host.os, "read", side_effect=fake_read):
      message = native_host.read_message()

    self.assertEqual(message, {"type": "ping"})

  def test_write_all_retries_partial_pipe_writes(self):
    writes = []

    def fake_write(_fd, data):
      chunk = bytes(data[:3])
      writes.append(chunk)
      return len(chunk)

    with mock.patch.object(native_host.os, "write", side_effect=fake_write):
      native_host.write_all(1, b"abcdefgh")

    self.assertEqual(b"".join(writes), b"abcdefgh")

  def test_read_message_returns_none_on_eof(self):
    with mock.patch.object(native_host.os, "read", return_value=b""):
      self.assertIsNone(native_host.read_message())

  def test_parse_spokenly_transcript_collects_sentences(self):
    payload = {
      "modelId": "parakeetTDT06",
      "segments": [
        {"text": "Hello", "start": 0.0, "end": 1.0},
        {"text": "there.", "start": 1.0, "end": 3.5},
        {"text": "Second", "start": 4.0, "end": 5.0},
        {"text": "part!", "start": 5.0, "end": 7.25},
        {"text": "", "start": 8.0, "end": 9.0},
      ],
    }

    transcript, end_ms, sentences = native_host.parse_spokenly_transcript(payload)

    self.assertEqual(transcript, "Hello there. Second part!")
    self.assertEqual(end_ms, 7250)
    self.assertEqual(
      sentences,
      [
        {"text": "Hello there.", "startMs": 0, "endMs": 3500},
        {"text": "Second part!", "startMs": 4000, "endMs": 7250},
      ],
    )

  def test_parse_spokenly_transcript_rejects_other_models(self):
    with self.assertRaisesRegex(native_host.SpokenlyResponseError, "parakeetTDT06"):
      native_host.parse_spokenly_transcript({"modelId": "cloud-model", "segments": []})

  def test_parse_spokenly_transcript_accepts_structured_model_id(self):
    transcript, _, _ = native_host.parse_spokenly_transcript({
      "modelId": {"predefined": "parakeetTDT06"},
      "segments": [{"text": "Hello.", "start": 0, "end": 1}],
    })
    self.assertEqual(transcript, "Hello.")

  def test_spokenly_url_must_be_loopback(self):
    native_host.validate_spokenly_url("http://127.0.0.1:51089")
    native_host.validate_spokenly_url("http://[::1]:51089")
    with self.assertRaisesRegex(native_host.SpokenlyUnavailableError, "loopback"):
      native_host.validate_spokenly_url("https://example.com/transcribe")


if __name__ == "__main__":
  unittest.main()
