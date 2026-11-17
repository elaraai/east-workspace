#!/usr/bin/env python3
# Copyright (c) 2025 Elara AI Pty Ltd
# Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
"""Writes the pins a release's east-py packages are installed under.

They are the east-py workspace's lock, exported, with the two settings the
lock was resolved under: what the packages' own tests ran against. A
release's python images install under them, so an image holds the build of
everything that was tested, and a project that asks for the datascience
package's extras locks the torch its tier image holds (e3: environments built
over their base tier).

Two files, for uv, kept in `@elaraai/e3-core` (`tier/`), which ships them:

    east-py-constraints.txt   every third-party pin of the lock, with hashes
    east-py-overrides.txt     the workspace's override-dependencies

    uv pip install --constraint east-py-constraints.txt \\
                   --override east-py-overrides.txt \\
                   "elaraai-east-py-datascience[all]==<release>"

The overrides are part of what was tested: a pin the lock holds by an
override does not resolve without it. pip takes no overrides, so it cannot
install under these. A workspace that leaves a distribution out of its lock
(`exclude-dependencies`) is refused: no file here would keep it out of an
install.

Run on the workspace root's `pyproject.toml` and `uv.lock`, which are all it
reads: a frozen export reads no member's manifest.

    east-py-constraints.py <workspace> <out> [--release <version>]

With `--release`, the lock must be that release's: another release's pins are
refused. The release's version bump runs it (`scripts/set-python-version.mjs`),
and nobody edits what it writes. The standard library and `uv` alone.
"""

import re
import subprocess
import sys
import tomllib
from pathlib import Path

CONSTRAINTS = "east-py-constraints.txt"
OVERRIDES = "east-py-overrides.txt"

# Every third-party pin of the lock, of every member and extra, and none of
# the workspace's own packages or its development groups. With no header:
# uv's names the command, and so the directory it ran in.
EXPORT = [
    "uv", "export", "--frozen", "--all-packages", "--all-extras", "--no-default-groups",
    "--no-emit-workspace", "--no-emit-local", "--no-header", "--quiet",
]

# The workspace member whose version is the release's: all of them share it.
MEMBER = "elaraai-east-py"

INSTALL = f"uv pip install --constraint {CONSTRAINTS} --override {OVERRIDES} ..."


def pep440(version):
    """A release's version as PEP 440 writes it: `1.2.3-beta.4` is `1.2.3b4`."""
    parts = re.fullmatch(r"(\d+\.\d+\.\d+)-(alpha|beta|rc)\.(\d+)", version)
    if parts is None:
        return version
    return parts.group(1) + {"alpha": "a", "beta": "b", "rc": "rc"}[parts.group(2)] + parts.group(3)


def release_of(lock):
    """The release a lock is of: the version it holds its own packages at."""
    for package in lock.get("package", []):
        if package.get("name") == MEMBER and "editable" in package.get("source", {}):
            return package["version"]
    raise SystemExit(f"east-py-constraints: the lock holds no workspace member '{MEMBER}'")


def constraints(workspace, release):
    """The lock's third-party pins, as uv exports them."""
    try:
        exported = subprocess.run(EXPORT, cwd=workspace, check=True, capture_output=True, text=True)
    except FileNotFoundError:
        raise SystemExit("east-py-constraints: uv is not on PATH") from None
    except subprocess.CalledProcessError as failed:
        raise SystemExit(f"east-py-constraints: the lock was not exported: {failed.stderr.strip()}") from None
    header = (
        f"# The pins the east-py packages of release {release} were tested with: their\n"
        "# workspace's lock, exported by scripts/east-py-constraints.py. Not edited by hand.\n"
        f"# Install under them with uv, beside {OVERRIDES}:\n"
        f"#   {INSTALL}\n"
    )
    return header + exported.stdout


def setting(manifest, name, what, release):
    """One of the workspace's uv settings that a lock is resolved under, a
    requirement a line."""
    lines = manifest.get("tool", {}).get("uv", {}).get(name, [])
    header = (
        f"# The {what} the east-py packages of release {release} were tested with: their\n"
        f"# workspace's {name}. Not edited by hand. Used beside {CONSTRAINTS}:\n"
        f"#   {INSTALL}\n"
    )
    return header + "".join(f"{line}\n" for line in lines)


def main(argv):
    args = argv[1:]
    asked = None
    if "--release" in args:
        at = args.index("--release")
        if at + 1 >= len(args):
            sys.stderr.write("east-py-constraints: --release takes a version\n")
            return 2
        asked = args[at + 1]
        del args[at:at + 2]
    if len(args) != 2:
        sys.stderr.write("usage: east-py-constraints.py <workspace> <out> [--release <version>]\n")
        return 2
    workspace, out = Path(args[0]), Path(args[1])
    with open(workspace / "pyproject.toml", "rb") as file:
        manifest = tomllib.load(file)
    if manifest.get("tool", {}).get("uv", {}).get("exclude-dependencies"):
        sys.stderr.write(
            f"east-py-constraints: the workspace at {workspace} leaves distributions out of its lock "
            "(exclude-dependencies), which no pin file keeps out of an install\n"
        )
        return 1
    with open(workspace / "uv.lock", "rb") as file:
        release = release_of(tomllib.load(file))
    if asked is not None and pep440(asked) != release:
        sys.stderr.write(
            f"east-py-constraints: the lock at {workspace} is release {release}'s, not {asked}'s: "
            "its pins are another release's. Build a release from its own tag.\n"
        )
        return 1
    # All are made before any is written: a failure leaves no file
    written = {
        CONSTRAINTS: constraints(workspace, release),
        OVERRIDES: setting(manifest, "override-dependencies", "overrides", release),
    }
    out.mkdir(parents=True, exist_ok=True)
    for name, text in written.items():
        (out / name).write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
