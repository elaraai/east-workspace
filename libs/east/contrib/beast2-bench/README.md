# beast2 benchmark — v4 vs v5, across all three runtimes

Measures **encode time, encoded size and decode time** for the beast2
container versions, in TypeScript, east-c and east-py, over one shared corpus
so the numbers are directly comparable. Written for issues #416 (v5 record
stream) and #417 (type-table caching).

## How the runtimes are kept comparable

`generate-corpus.ts` writes each case as a **v4** blob — the interchange every
runtime can already read — plus a companion `<name>.type.beast2` holding the
case's type (east-py has no way to recover a type from a blob). Each benchmark
then *decodes those bytes into a native value* and times encode/decode from
there. So all three runtimes measure the same values, not merely similar ones.

## Corpus

| case | what it stresses |
|---|---|
| `recursive-list-2k` / `-20k` | deep recursion; both encoders recurse per cell, so 20k also probes the stack ceiling (it overflows in v4 **and** v5 alike) |
| `recursive-tree-d5b8` | wide recursion, ~37k nodes |
| `rows-50k` | payload-dominated, with realistic string repetition (v4 dedups via its string table; v5 leans on the frame codec) |
| `ir-program`, `type-value` | schema-dominated — where the well-known type section and the #417 cache pay off |
| `ui-component` | the largest schema in the platform (optional; needs east-ui built) |
| `fuzz-00..19` | random nested/recursive schemas from `src/fuzz.ts`, 2000 elements each |

## Running it

```bash
# 0. build the runtimes you want to measure
cd libs/east    && make build
cd libs/east-c  && make build          # Release for meaningful C numbers
cd libs/east-py && make build

export DIR=${TMPDIR:-/tmp}/beast2-bench   # default; override with BEAST2_BENCH_DIR

# 1. corpus (from libs/east)
node dist/contrib/beast2-bench/generate-corpus.js

# 2. per-runtime results
node dist/contrib/beast2-bench/bench-ts.js                      # -> $DIR/ts.json
libs/east-c/build/packages/east-c/bench_beast2_versions $DIR > $DIR/c.json
cd libs/east-py && uv run --package elaraai-east-py \
    python scripts/bench_beast2_versions.py $DIR > $DIR/py.json

# 3. tables
node dist/contrib/beast2-bench/report.js
```

`report.js` renders whichever result files exist, so you can run a subset.

## A/B against another build

`bench-ts.js` takes `EAST_DIST` (a path to another build of east's
`dist/src/index.js`) and `HAS_V5=0` for builds predating the v5 container.
Save the baseline as `$DIR/ts-main.json` and `report.js` adds a comparison
column:

```bash
git worktree add /tmp/east-main main && (cd /tmp/east-main/libs/east && pnpm install && pnpm run build)
EAST_DIST=/tmp/east-main/libs/east/dist/src/index.js HAS_V5=0 \
  OUT=$DIR/ts-main.json node dist/contrib/beast2-bench/bench-ts.js
```

## Notes

- `BUDGET_MS` (default 400) sets the per-measurement time budget.
- The fuzz corpus is regenerated randomly each run, so fuzz-case numbers are
  comparable *within* a run, not across runs. The named cases are
  deterministic and stable across runs.
- east-py currently skips cases whose type is **recursive**: a recursive type
  rehydrated from a blob fails to convert back through the Cython bridge
  (`_eastc_bridge.pyx`, "an integer is required"). That is on the v4 path and
  unrelated to v5.
