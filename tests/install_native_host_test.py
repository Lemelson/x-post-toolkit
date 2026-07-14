import json
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "install_native_host.sh"
HOST_NAME = "com.xvdl.transcriber"


class InstallNativeHostTest(unittest.TestCase):
  def test_installs_for_helium_and_preserves_existing_browser_origins(self):
    helium_id = "a" * 32
    chrome_id = "b" * 32
    existing_id = "c" * 32

    with tempfile.TemporaryDirectory() as temp_home:
      home = pathlib.Path(temp_home)
      self.write_preferences(
        home / "Library/Application Support/net.imput.helium/Profile 1/Secure Preferences",
        helium_id,
      )
      self.write_preferences(
        home / "Library/Application Support/Google/Chrome/Default/Preferences",
        chrome_id,
      )

      chrome_host_dir = home / "Library/Application Support/Google/Chrome/NativeMessagingHosts"
      chrome_host_dir.mkdir(parents=True)
      (chrome_host_dir / f"{HOST_NAME}.json").write_text(
        json.dumps({
          "name": HOST_NAME,
          "path": "/old/host",
          "type": "stdio",
          "allowed_origins": [f"chrome-extension://{existing_id}/"],
        }),
        encoding="utf-8",
      )

      env = {
        **os.environ,
        "HOME": temp_home,
        "PYTHON_BIN": os.environ.get("PYTHON_BIN", "python3"),
      }
      result = subprocess.run(
        [str(SCRIPT)],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
      )
      self.assertEqual(result.returncode, 0, result.stderr)

      expected_origins = {
        f"chrome-extension://{helium_id}/",
        f"chrome-extension://{chrome_id}/",
        f"chrome-extension://{existing_id}/",
      }
      for relative_dir in (
        "Library/Application Support/net.imput.helium/NativeMessagingHosts",
        "Library/Application Support/Google/Chrome/NativeMessagingHosts",
      ):
        manifest_path = home / relative_dir / f"{HOST_NAME}.json"
        self.assertTrue(manifest_path.exists(), manifest_path)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(set(manifest["allowed_origins"]), expected_origins)

      installed_host = home / ".local/share/xvdl/native_host.py"
      self.assertEqual(
        installed_host.read_bytes(),
        (ROOT / "scripts/native_host.py").read_bytes(),
      )
      wrapper = (home / ".local/bin/xvdl-native-host").read_text(encoding="utf-8")
      self.assertNotIn("parakeet-mlx", wrapper)
      self.assertNotIn("XVDL_PARAKEET_BIN", wrapper)
      compat = home / ".local/share/xvdl/spokenly_parakeet_compat.py"
      self.assertEqual(
        compat.read_bytes(),
        (ROOT / "scripts/spokenly_parakeet_compat.py").read_bytes(),
      )
      compat_wrapper = home / ".local/bin/parakeet-mlx"
      self.assertTrue(compat_wrapper.is_file())

      existing_command = "#!/bin/sh\necho existing-parakeet\n"
      compat_wrapper.write_text(existing_command, encoding="utf-8")
      second_result = subprocess.run(
        [str(SCRIPT)],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
      )
      self.assertEqual(second_result.returncode, 0, second_result.stderr)
      self.assertEqual(compat_wrapper.read_text(encoding="utf-8"), existing_command)

  @staticmethod
  def write_preferences(path, extension_id):
    path.parent.mkdir(parents=True)
    path.write_text(
      json.dumps({
        "extensions": {
          "settings": {
            extension_id: {
              "path": str(ROOT),
            },
          },
        },
      }),
      encoding="utf-8",
    )


if __name__ == "__main__":
  unittest.main()
