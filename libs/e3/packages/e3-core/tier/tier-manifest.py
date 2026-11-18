#!/usr/bin/env python3
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under BSL 1.1. See LICENSE for details.
"""Writes what this image's Python holds: its tier manifest.

An environment a rack runs over this image is built without what the manifest
says the image already holds (e3: environments built over their base tier).
The manifest names the interpreter, the base interpreter a virtualenv over it
is made from, its site directory, the namespace packages of that directory,
and each installed distribution by name, version and the digest of the files
it installed.

Run with the interpreter the image's tasks run with:

    /opt/venv/bin/python tier-manifest.py /opt/e3/tier-manifest.json

The standard library alone, so it runs in any image. It is a file of the
`@elaraai/e3-core` package (`tier/tier-manifest.py`), beside the reader of
what it writes: an image built elsewhere for a tier takes it from the
release's package, and so writes a manifest by this release's rules.
"""

import csv
import hashlib
import json
import os
import platform
import re
import sys
import sysconfig
from importlib import metadata

# What an installer writes beside a distribution's files, which says how it
# was installed and not what was: left out of the files' digest.
BOOKKEEPING = {"RECORD", "INSTALLER", "REQUESTED", "direct_url.json"}


def canonical_name(name):
    """A distribution's name as PEP 503 writes it."""
    return re.sub(r"[-_.]+", "-", name).lower()


def files_digest(record):
    """The digest of the files a distribution installed, from its RECORD.

    Each file in the site directory, by its path, hash and size, sorted by
    path. Left out: the installer's bookkeeping, compiled files, and what is
    installed outside the site directory (a script, whose first line names
    the interpreter it was installed for).
    """
    rows = []
    for row in csv.reader(record.splitlines()):
        if len(row) < 3:
            continue
        path, digest, size = row[0], row[1], row[2]
        parts = path.split("/")
        if parts[0] == "..":
            continue
        if len(parts) == 2 and parts[0].endswith(".dist-info") and parts[1] in BOOKKEEPING:
            continue
        if "__pycache__" in parts or path.endswith(".pyc"):
            continue
        rows.append((path, digest, size))
    lines = "".join(f"{path}\t{digest}\t{size}\n" for path, digest, size in sorted(rows))
    return "sha256:" + hashlib.sha256(lines.encode("utf-8")).hexdigest()


def namespace_packages(site):
    """The namespace packages of a site directory: each directory at its top
    that holds no `__init__` module.

    Python reads such a package from every directory on its path that holds a
    part of it, so an environment may ship one part of it and leave another
    here. A package with an `__init__` module is read from the first
    directory that holds it, and is left here whole or not at all.
    """
    names = []
    for name in os.listdir(site):
        path = os.path.join(site, name)
        if name == "__pycache__" or name.endswith((".dist-info", ".egg-info")) or not os.path.isdir(path):
            continue
        if any(entry.startswith("__init__.") for entry in os.listdir(path)):
            continue
        names.append(name)
    return sorted(names)


def tier_manifest():
    """This interpreter's manifest: itself, and what is installed for it.

    The distributions of its site directory alone: an environment built over
    the tier adds that directory to its path, and no other of this
    interpreter's (the system's, a parent virtualenv's, PYTHONPATH's), so what
    is elsewhere is no distribution the environment could be left to.
    """
    site = sysconfig.get_path("purelib")
    distributions = {}
    twice = set()
    for dist in metadata.distributions(path=[site]):
        name = dist.metadata["Name"]
        version = dist.metadata["Version"]
        record = dist.read_text("RECORD")
        # One with no name, version or RECORD cannot be told from another: it
        # is never left out, and the rest of the manifest is read whole
        if name is None or version is None or record is None:
            continue
        name = canonical_name(name)
        # Two of one name, which is no install of one: which files are whose
        # cannot be told, so neither is left out
        if name in distributions:
            twice.add(name)
        distributions[name] = {"name": name, "version": version, "files": files_digest(record)}
    for name in twice:
        del distributions[name]
    return {
        "version": 1,
        "python": {
            "version": platform.python_version(),
            "executable": sys.executable,
            # What a virtualenv made by this interpreter runs: itself, or,
            # when it is a virtualenv's, the interpreter that one was made from
            "base": getattr(sys, "_base_executable", None) or sys.executable,
            "site": site,
        },
        "namespaces": namespace_packages(site),
        "distributions": [distributions[name] for name in sorted(distributions)],
    }


def main(argv):
    if len(argv) != 2:
        sys.stderr.write("usage: tier-manifest.py <output.json>\n")
        return 2
    # One form, so the same image writes the same bytes: its digest names it
    text = json.dumps(tier_manifest(), sort_keys=True, separators=(",", ":")) + "\n"
    with open(argv[1], "w", encoding="utf-8") as out:
        out.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
