#!/usr/bin/env python3
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under BSL 1.1. See LICENSE for details.
"""Checks that an image holds what its release's pins say.

Every distribution the image's tier manifest names, that the release's
constraints pin, is at a version they pin it at. A constraints file pins a
distribution once for each platform it differs on, so any of its versions
passes.

    check-tier-pins.py <tier-manifest.json> <east-py-constraints.txt>

It also holds no two distributions of one NCCL library: torch's and
xgboost's install the same file, and with xgboost's on top torch does not
import, so the release's excludes keep xgboost's out.

Exits 1 and names each distribution that is at another version. The standard
library alone, so it runs in any image.
"""

import json
import re
import sys


def canonical_name(name):
    """A distribution's name as PEP 503 writes it."""
    return re.sub(r"[-_.]+", "-", name).lower()


def pinned(constraints):
    """Each distribution a constraints file pins, and the versions it pins it at."""
    pins = {}
    for line in constraints.splitlines():
        pin = re.match(r"([A-Za-z0-9._-]+)==([^\s;\\]+)", line)
        if pin is not None:
            pins.setdefault(canonical_name(pin.group(1)), set()).add(pin.group(2))
    return pins


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: check-tier-pins.py <tier-manifest.json> <east-py-constraints.txt>\n")
        return 2
    with open(argv[1], encoding="utf-8") as file:
        held = json.load(file)["distributions"]
    with open(argv[2], encoding="utf-8") as file:
        pins = pinned(file.read())
    checked = [dist for dist in held if dist["name"] in pins]
    other = [dist for dist in checked if dist["version"] not in pins[dist["name"]]]
    for dist in other:
        sys.stderr.write(
            f"{dist['name']} is {dist['version']}, and the release pins it at {' or '.join(sorted(pins[dist['name']]))}\n"
        )
    if other:
        return 1
    nccl = sorted(dist["name"] for dist in held if dist["name"].startswith("nvidia-nccl-"))
    if len(nccl) > 1:
        sys.stderr.write(f"the image holds {' and '.join(nccl)}, which install the same library: the release excludes all but one\n")
        return 1
    if not checked:
        sys.stderr.write("the image holds none of what the release pins\n")
        return 1
    print(f"{len(checked)} of the image's {len(held)} distributions are pinned by the release, each at its pin")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
