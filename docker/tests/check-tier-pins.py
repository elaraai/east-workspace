#!/usr/bin/env python3
# Copyright (c) 2025 Elara AI Pty Ltd
# Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
"""Checks that an image holds what its release's pins say, for its own Python.

Asks uv to install every distribution the image's tier manifest names, at the
version the image holds it at, into the image's interpreter, under the
release's constraints and overrides, changing nothing (`--dry-run`). A pin
holds on the platforms and Pythons its marker names, and uv reads each marker
for this interpreter: a distribution held at a version its pin here does not
allow cannot be installed under the pins, and uv says which. One the pins hold
for other platforms alone is not held to them.

    check-tier-pins.py <tier-manifest.json> <pins directory>

The pins directory holds east-py-constraints.txt and east-py-overrides.txt, as
the release's @elaraai/e3-core ships them. Run in the image, with its uv and
its virtualenv. The image also holds no two distributions of one NCCL library:
they install the same file, and the one installed last wins.

Exits 1, with uv's words, when an install under the pins would not leave the
image as it is.
"""

import json
import re
import subprocess
import sys
from pathlib import Path


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: check-tier-pins.py <tier-manifest.json> <pins directory>\n")
        return 2
    manifest = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    pins = Path(argv[2])
    held = manifest["distributions"]
    nccl = sorted(dist["name"] for dist in held if dist["name"].startswith("nvidia-nccl-"))
    if len(nccl) > 1:
        sys.stderr.write(f"the image holds {' and '.join(nccl)}, which install the same library\n")
        return 1
    checked = subprocess.run(
        ["uv", "pip", "install", "--dry-run", "--python", manifest["python"]["executable"],
         "--constraint", str(pins / "east-py-constraints.txt"), "--override", str(pins / "east-py-overrides.txt"),
         *(f"{dist['name']}=={dist['version']}" for dist in held)],
        capture_output=True, text=True, check=False,
    )
    # uv says what it would change a line a distribution: ` - name==v`, ` + name==v`
    changes = [line for line in checked.stderr.splitlines() if re.match(r"^ [-+~] \S", line)]
    if checked.returncode != 0 or changes:
        sys.stderr.write(checked.stderr)
        sys.stderr.write("the image does not hold what its release's pins say for its Python\n")
        return 1
    print(f"the image's {len(held)} distributions are each at a version its release's pins allow for its Python")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
