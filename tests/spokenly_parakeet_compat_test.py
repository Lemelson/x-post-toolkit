import importlib.util
import pathlib
import plistlib
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
  "spokenly_parakeet_compat", ROOT / "scripts" / "spokenly_parakeet_compat.py"
)
compat = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(compat)


class SpokenlyParakeetCompatTest(unittest.TestCase):
  def test_accepts_legacy_cli_arguments(self):
    args = compat.build_parser().parse_args([
      "/tmp/audio.wav",
      "--model", "mlx-community/parakeet-tdt-0.6b-v3",
      "--output-dir", "/tmp/out",
      "--output-format", "txt",
      "--chunk-duration", "120",
      "--overlap-duration", "15",
    ])
    self.assertEqual(args.audios, ["/tmp/audio.wav"])
    self.assertEqual(args.output_format, "txt")
    self.assertEqual(args.output_dir, pathlib.Path("/tmp/out"))

  def test_requires_spokenly_parakeet_v3(self):
    with tempfile.TemporaryDirectory() as temp_dir:
      preferences = pathlib.Path(temp_dir) / "preferences.plist"
      preferences.write_bytes(plistlib.dumps({"fileTranscriptionVoiceModelID": "cloud-model"}))
      with self.assertRaisesRegex(RuntimeError, "parakeetTDT06"):
        compat.verify_selected_model(preferences)

  def test_reads_spokenly_json_encoded_model_preference(self):
    with tempfile.TemporaryDirectory() as temp_dir:
      preferences = pathlib.Path(temp_dir) / "preferences.plist"
      preferences.write_bytes(plistlib.dumps({
        "fileTranscriptionVoiceModelID": b'"parakeetTDT06"',
      }))
      self.assertEqual(compat.selected_file_model(preferences), "parakeetTDT06")

  def test_preserves_legacy_output_filename(self):
    result = compat.output_path(
      pathlib.Path("/tmp/audio.wav"), pathlib.Path("/tmp/out"), "txt"
    )
    self.assertEqual(result, pathlib.Path("/tmp/out/audio.txt"))


if __name__ == "__main__":
  unittest.main()
