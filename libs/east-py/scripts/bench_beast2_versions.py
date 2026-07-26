#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""beast2 benchmark (east-py side): encode time, encoded size and decode time
for v4 and v5 (none + deflate), over the corpus written by
libs/east/contrib/beast2-bench/generate-corpus.ts.

Each case is seeded by rehydrating its type (from the companion
`<name>.type.beast2`, since east-py has no way to recover a type from a blob)
and then decoding its v4 blob — so the TypeScript, east-c and east-py
benchmarks all measure the same values. Emits JSON on stdout; save it as
`<corpus dir>/py.json` for contrib/beast2-bench/report.ts.

    uv run --package elaraai-east-py python scripts/bench_beast2_versions.py \
        [corpus_dir] > $DIR/py.json

Known gap: a RECURSIVE type rehydrated from a blob currently fails to convert
back through the Cython bridge (_eastc_bridge.pyx, "an integer is required"),
on the v4 path and unrelated to v5 — those cases report as skipped."""
import glob
import json
import os
import sys
import tempfile
import time

from east.serialization.beast2 import (
    decode_beast2_with_header_for,
    encode_beast2_v5_for,
    encode_beast2_with_header_for,
)
from east.types.type_of_type import EastTypeType

DIR = (
    sys.argv[1] if len(sys.argv) > 1
    else os.environ.get("BEAST2_BENCH_DIR", os.path.join(tempfile.gettempdir(), "beast2-bench"))
)
BUDGET = 0.4  # seconds per measurement


def time_it(fn):
    """Run `fn` for at least BUDGET seconds; return the mean ms per call."""
    fn()
    fn()
    t0 = time.perf_counter()
    iters = 0
    while time.perf_counter() - t0 < BUDGET:
        fn()
        iters += 1
    return (time.perf_counter() - t0) / iters * 1000.0


rows = []
names = sorted(
    os.path.basename(p)[: -len(".v4.beast2")]
    for p in glob.glob(f"{DIR}/*.v4.beast2")
    if ".type." not in p
)
for name in names:
    try:
        with open(f"{DIR}/{name}.type.beast2", "rb") as f:
            t = decode_beast2_with_header_for(EastTypeType)(f.read())
        with open(f"{DIR}/{name}.v4.beast2", "rb") as f:
            value = decode_beast2_with_header_for(t)(f.read())
    except Exception as e:  # noqa: BLE001
        print(f"skip {name}: {e}", file=sys.stderr)
        continue

    row = {"name": name}
    variants = [
        ("v4", lambda v, t=t: encode_beast2_with_header_for(t)(v)),
        ("v5-none", lambda v, t=t: encode_beast2_v5_for(t, codec="none")(v)),
        ("v5-deflate", lambda v, t=t: encode_beast2_v5_for(t, codec="deflate")(v)),
    ]
    decode = decode_beast2_with_header_for(t)
    for label, enc in variants:
        try:
            blob = enc(value)
            decode(blob)
        except Exception as e:  # noqa: BLE001
            print(f"skip {name}/{label}: {e}", file=sys.stderr)
            continue
        row[f"{label}_size"] = len(blob)
        row[f"{label}_enc"] = time_it(lambda v=value, e=enc: e(v))
        row[f"{label}_dec"] = time_it(lambda b=blob, d=decode: d(b))
    rows.append(row)
    print(".", end="", file=sys.stderr, flush=True)

print("", file=sys.stderr)
json.dump(rows, sys.stdout, indent=2)
