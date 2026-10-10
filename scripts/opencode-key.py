#!/usr/bin/env python3
"""Save named Anthropic API keys and select one for local or GitHub OpenCode runs."""

import argparse
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request


def profile_name(value):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,39}", value):
        raise argparse.ArgumentTypeError("Use 1–40 lowercase letters, digits, hyphens or underscores.")
    return value


def data_dir():
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "opencode"


def read_json(path):
    return json.loads(path.read_text()) if path.exists() else {}


def save_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".key-")
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def verify_key(key):
    # A small inference request checks billing as well as authentication.
    # No project files are sent to Anthropic.
    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps({"model": "claude-opus-5-5", "max_tokens": 64,
                         "messages": [{"role": "user", "content": "Reply with OK only."}]}).encode(),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        with error:
            detail = error.read().decode().replace(key, "[redacted]")
        raise SystemExit(f"Anthropic returned HTTP {error.code}: {detail}\nNothing changed. Check this key's Console organization and API credits.") from None
    except (urllib.error.URLError, TimeoutError) as error:
        raise SystemExit(f"Could not reach Anthropic: {error}. Nothing changed.") from None
    print("Anthropic API access verified:", result["model"])


def github_key(repo, name, key, default):
    environment = f"anthropic-{name}"
    # Check first: never overwrite an existing environment's protection rules.
    result = subprocess.run(
        ["gh", "api", "--paginate", f"repos/{repo}/environments", "--jq", ".environments[].name"],
        capture_output=True, text=True,
    )
    if result.returncode:
        raise SystemExit("Local key saved; could not read GitHub environments. Check gh authentication and repository access, then retry.")
    if environment not in result.stdout.splitlines():
        result = subprocess.run(
            ["gh", "api", "--method", "PUT", f"repos/{repo}/environments/{environment}", "--silent"],
            capture_output=True,
        )
        if result.returncode:
            raise SystemExit("Local key saved; could not create the GitHub key environment.")
    result = subprocess.run(
        ["gh", "secret", "set", "ANTHROPIC_API_KEY", "--repo", repo, "--env", environment],
        input=key.encode(), capture_output=True,
    )
    if result.returncode:
        raise SystemExit("Local key saved; setting the GitHub environment secret failed. Check repository access and retry.")
    print("Configured GitHub API key profile:", environment)
    if default:
        result = subprocess.run(
            ["gh", "variable", "set", "OPENCODE_KEY_PROFILE", "--repo", repo, "--body", name],
            capture_output=True,
        )
        if result.returncode:
            raise SystemExit("Key saved locally and in GitHub, but setting the default GitHub profile failed. Rerun with --default.")


def add_key(args):
    if args.github_repo and not shutil.which("gh"):
        raise SystemExit("Install and sign in to the GitHub CLI before using --github-repo.")
    path = data_dir() / "key-profiles.json"
    profiles = read_json(path)
    keys = profiles.setdefault("keys", {})
    key = "" if args.replace else keys.get(args.name, "")
    if key:
        print("Using the saved API key for profile:", args.name)
    else:
        if not sys.stdin.isatty():
            raise SystemExit("Run this command in your terminal to enter the key at a hidden prompt.")
        key = getpass.getpass(f"Anthropic API key for {args.name} (input hidden): ").strip()
    if not key:
        raise SystemExit("No key supplied; nothing changed.")
    verify_key(key)
    keys[args.name] = key
    if args.default or not profiles.get("default"):
        profiles["default"] = args.name
    save_private(path, profiles)
    default = profiles["default"] == args.name
    if default:
        auth_path = data_dir() / "auth.json"
        auth = read_json(auth_path)
        auth["anthropic"] = {"type": "api", "key": key}
        save_private(auth_path, auth)
    print("Saved API key profile:", args.name, "(default)" if default else "")
    if args.github_repo:
        github_key(args.github_repo, args.name, key, default)


def run_key(args):
    profiles = read_json(data_dir() / "key-profiles.json")
    keys = profiles.get("keys", {})
    if not keys:
        raise SystemExit("No API key profiles yet. Run: opencode-key add personal")
    name = args.name
    if not name:
        if not sys.stdin.isatty():
            raise SystemExit("Select a profile explicitly: opencode-key run PROFILE -- [OpenCode arguments]")
        names = sorted(keys)
        default = profiles.get("default")
        for index, item in enumerate(names, 1):
            print(f"{index}. {item}" + (" (default)" if item == default else ""))
        selection = input("Choose API key profile (number or name; Enter for default): ").strip()
        if not selection:
            name = default
        elif selection.isdigit() and 1 <= int(selection) <= len(names):
            name = names[int(selection) - 1]
        else:
            name = selection
    if name not in keys:
        raise SystemExit("Unknown API key profile. Run opencode-key list to see the names.")
    if not shutil.which("opencode"):
        raise SystemExit("Install OpenCode first: npm install --global opencode-ai@1.18.35")
    auth = read_json(data_dir() / "auth.json")
    auth["anthropic"] = {"type": "api", "key": keys[name]}
    environment = os.environ.copy()
    # Isolate this process's selection: simultaneous sessions can use different
    # keys without changing each other's on-disk default credential.
    environment["OPENCODE_AUTH_CONTENT"] = json.dumps(auth)
    environment["ANTHROPIC_API_KEY"] = keys[name]
    print("Starting OpenCode with API key profile:", name, flush=True)
    arguments = args.opencode_args
    if arguments[:1] == ["--"]:
        arguments = arguments[1:]
    os.execvpe("opencode", ["opencode", *arguments], environment)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("add", help="Verify and save a key using a hidden prompt")
    add.add_argument("name", type=profile_name)
    add.add_argument("--github-repo", help="Also add an anthropic-NAME GitHub key environment")
    add.add_argument("--default", action="store_true", help="Use this profile for plain opencode and unqualified GitHub comments")
    add.add_argument("--replace", action="store_true", help="Prompt for a new key even if this profile exists")
    run = commands.add_parser("run", help="Pick a key and launch OpenCode")
    run.add_argument("name", nargs="?", type=profile_name)
    run.add_argument("opencode_args", nargs=argparse.REMAINDER)
    commands.add_parser("list", help="List profile names without showing keys")
    args = parser.parse_args()
    if args.command == "add":
        add_key(args)
    elif args.command == "run":
        run_key(args)
    else:
        profiles = read_json(data_dir() / "key-profiles.json")
        for name in sorted(profiles.get("keys", {})):
            print(name + (" (default)" if name == profiles.get("default") else ""))


if __name__ == "__main__":
    main()
