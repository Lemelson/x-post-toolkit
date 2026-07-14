import importlib.util
import pathlib
import unittest


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


if __name__ == "__main__":
  unittest.main()
