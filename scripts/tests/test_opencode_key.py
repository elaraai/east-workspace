"""Credential routing checks; no real keys, API requests or GitHub writes."""

import argparse
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import urllib.error


spec = importlib.util.spec_from_file_location("opencode_key", Path(__file__).parents[1] / "opencode-key.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class KeyProfilesTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.enterContext(patch.dict(os.environ, {"XDG_DATA_HOME": temporary.name}))
        self.output = self.enterContext(redirect_stdout(io.StringIO()))
        self.auth = helper.data_dir() / "auth.json"
        self.profiles = helper.data_dir() / "key-profiles.json"

    def add(self, name, key, **options):
        args = argparse.Namespace(name=name, github_repo=None, default=False, replace=False)
        args.__dict__.update(options)
        with patch.object(helper.sys.stdin, "isatty", return_value=True), \
             patch.object(helper.getpass, "getpass", return_value=key), \
             patch.object(helper.urllib.request, "urlopen", return_value=io.BytesIO(b'{"model":"claude-opus-5-5"}')) as api:
            helper.add_key(args)
        request = api.call_args.args[0]
        self.assertEqual(request.get_header("X-api-key"), key)
        self.assertEqual(json.loads(request.data)["model"], "claude-opus-5-5")

    def test_two_profiles_keep_the_default_and_other_providers(self):
        other = {"google": {"type": "api", "key": "test-google-key"}}
        helper.save_private(self.auth, other)
        self.add("personal", "test-personal-key")
        self.add("team", "test-team-key")
        self.assertEqual(helper.read_json(self.profiles), {
            "default": "personal", "keys": {"personal": "test-personal-key", "team": "test-team-key"},
        })
        self.assertEqual(helper.read_json(self.auth), {
            **other, "anthropic": {"type": "api", "key": "test-personal-key"},
        })
        for path in (self.profiles, self.auth):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertNotIn("test-personal-key", self.output.getvalue())
        self.assertNotIn("test-team-key", self.output.getvalue())

    def test_explicit_default_and_rotation(self):
        self.add("personal", "test-personal-key")
        self.add("team", "test-team-key", default=True)
        self.add("team", "test-team-rotated", replace=True)
        self.assertEqual(helper.read_json(self.profiles)["default"], "team")
        self.assertEqual(helper.read_json(self.auth)["anthropic"]["key"], "test-team-rotated")
        self.assertEqual(helper.read_json(self.profiles)["keys"]["personal"], "test-personal-key")

    def test_failed_key_does_not_change_saved_credentials(self):
        self.add("personal", "test-personal-key")
        before = (self.profiles.read_bytes(), self.auth.read_bytes())
        error = urllib.error.HTTPError("https://api.anthropic.com/v1/messages", 400, "Bad key", {}, io.BytesIO(b'test-bad-key has no credits'))
        args = argparse.Namespace(name="personal", github_repo=None, default=True, replace=True)
        with patch.object(helper.sys.stdin, "isatty", return_value=True), \
             patch.object(helper.getpass, "getpass", return_value="test-bad-key"), \
             patch.object(helper.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(SystemExit) as raised:
                helper.add_key(args)
        self.assertIn("HTTP 400", str(raised.exception))
        self.assertNotIn("test-bad-key", str(raised.exception))
        self.assertEqual(before, (self.profiles.read_bytes(), self.auth.read_bytes()))

    def test_selected_session_leaves_default_and_other_sessions_unchanged(self):
        self.add("personal", "test-personal-key")
        self.add("team", "test-team-key")
        before = self.auth.read_bytes()
        args = argparse.Namespace(name="team", opencode_args=["--", "run", "Explain this project"])
        with patch.object(helper.shutil, "which", return_value="/bin/opencode"), \
             patch.object(helper.os, "execvpe") as execute:
            helper.run_key(args)
        _, arguments, environment = execute.call_args.args
        self.assertEqual(arguments, ["opencode", "run", "Explain this project"])
        self.assertEqual(environment["ANTHROPIC_API_KEY"], "test-team-key")
        self.assertEqual(json.loads(environment["OPENCODE_AUTH_CONTENT"])["anthropic"]["key"], "test-team-key")
        self.assertEqual(before, self.auth.read_bytes())
        self.assertNotIn("test-team-key", self.output.getvalue())

    def test_picker_accepts_number_and_keeps_keys_hidden(self):
        self.add("personal", "test-personal-key")
        self.add("team", "test-team-key")
        with patch.object(helper.sys.stdin, "isatty", return_value=True), \
             patch("builtins.input", return_value="2"), \
             patch.object(helper.shutil, "which", return_value="/bin/opencode"), \
             patch.object(helper.os, "execvpe") as execute:
            helper.run_key(argparse.Namespace(name=None, opencode_args=[]))
        self.assertEqual(execute.call_args.args[2]["ANTHROPIC_API_KEY"], "test-team-key")
        self.assertIn("1. personal (default)", self.output.getvalue())
        self.assertIn("2. team", self.output.getvalue())
        self.assertNotIn("test-team-key", self.output.getvalue())

    def test_unknown_profile_never_falls_back(self):
        self.add("personal", "test-personal-key")
        with patch.object(helper.os, "execvpe") as execute:
            with self.assertRaisesRegex(SystemExit, "Unknown API key profile"):
                helper.run_key(argparse.Namespace(name="missing", opencode_args=[]))
        execute.assert_not_called()

    def test_new_key_requires_a_terminal(self):
        args = argparse.Namespace(name="personal", github_repo=None, default=False, replace=False)
        with patch.object(helper.sys.stdin, "isatty", return_value=False), \
             patch.object(helper.getpass, "getpass") as prompt:
            with self.assertRaisesRegex(SystemExit, "hidden prompt"):
                helper.add_key(args)
        prompt.assert_not_called()
        self.assertFalse(self.profiles.exists())

    def test_github_secret_uses_stdin_and_preserves_environment_rules(self):
        responses = [subprocess.CompletedProcess([], 0, "anthropic-team\n"),
                     subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 0)]
        with patch.object(helper.subprocess, "run", side_effect=responses) as command:
            helper.github_key("elaraai/east-workspace", "team", "test-team-key", True)
        calls = command.call_args_list
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[1].args[0], ["gh", "secret", "set", "ANTHROPIC_API_KEY", "--repo", "elaraai/east-workspace", "--env", "anthropic-team"])
        self.assertEqual(calls[1].kwargs["input"], b"test-team-key")
        for call in calls:
            self.assertNotIn("test-team-key", call.args[0])
            self.assertNotIn("PUT", call.args[0])

    def test_github_creates_only_the_selected_missing_environment(self):
        responses = [subprocess.CompletedProcess([], 0, "github-pages\n"),
                     subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 0)]
        with patch.object(helper.subprocess, "run", side_effect=responses) as command:
            helper.github_key("elaraai/east-workspace", "team", "test-team-key", False)
        self.assertEqual(command.call_args_list[1].args[0], [
            "gh", "api", "--method", "PUT", "repos/elaraai/east-workspace/environments/anthropic-team", "--silent",
        ])
        self.assertEqual(len(command.call_args_list), 3)

    def test_invalid_profile_names(self):
        for name in ("../team", "Team", "team/name", "team\nother", "", "a" * 41):
            with self.subTest(name=name), self.assertRaises(argparse.ArgumentTypeError):
                helper.profile_name(name)


if __name__ == "__main__":
    unittest.main()
