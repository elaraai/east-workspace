# Runners, units, IR and checking a module

Running a program from the command line, a runner-protocol unit in a host of your own, IR to source, and `east-node check`. Part of the `east` skill.

## Contents
- Runners: running a program from the command line
- Units in a host of your own: `executeUnit` and `UnitIO`
- IR → source: `East.toSource` and `east-node transpile`
- Checking that a module builds: `east-node check`

## Runners: running a program from the command line

A program's IR runs on any of three runners, which take the same arguments.
Write it with `writeFileSync("prog.beast2", encodeEastIR(fn.toIR()))` — which
keeps its source map, so errors name your lines — or `fn.toIR().toJSON()`.

```bash
east-node run prog.beast2 -p @elaraai/east-node-std -i a.beast2 -i b.beast2 -o out.beast2   # -v: timing and peak memory
east-c    run prog.beast2 -p east-c-std -i a.beast2 -o out.beast2 [--profile]             # native; --profile: time per function
east-py   run prog.beast2 -p east-py-std -i a.beast2 -o out.beast2 [--profile]            # python (the east-py skill)
```

- `--profile` (east-c and east-py, `run` and `exec`) prints every East
  function and platform function the work called, by self time, with its
  calls and where it is defined and called. `EAST_PROFILE=1` profiles without
  the flag — e3 hands its environment to the runners, so a task's report
  lands in its log — and `EAST_PROFILE_INTERVAL=N` prints the profile so far
  every N seconds while the work runs.
- Each `-i` is one argument, in parameter order, and each `-p` loads one
  platform package (east-node needs at least one); `-o` writes the result,
  else it is printed. IR and values may be `.beast2`, `.beast`, `.east` or
  `.json`.
- `exec <unit>` is the runner protocol e3 speaks: it runs one unit file — a
  program over its inputs, a merge of an output's parts, or the intake of a
  delivered collection — writes the output by its kind and records a result;
  exit 0 when it succeeded, 1 when it failed.
- `version [-p <package>…]` prints the runner's version and each package's.
- east-c also has `convert <file> [-o <file>] [--type <east-type>]`, a value
  from one format to another, and the IR toolbox: `ir normalize` (the canonical
  form — the round-trip equality contract), `ir diff a b` (the first structural
  difference) and `ir convert` (JSON ↔ beast2, the source map kept).
- east-node also has `transpile`, `check`, `lsp` and `export-functions`, below;
  east-py has the python twins, and `lint`.

### Units in a host of your own: `executeUnit` and `UnitIO`

east-node's `exec` is a file wrapper around `executeUnit`, the one TypeScript
unit runner, which does a unit's work over a `UnitIO` rather than a file
system — so a host with none runs units too: e3-web runs them in a browser's
Web Workers. east-c has the same shape (`east/unit.h`).

| Signature | Description |
|-----------|-------------|
| `executeUnit(unit: Unit, io: UnitIO, options: ExecuteUnitOptions): Promise<UnitResult>` | Does the unit's work — a run, a merge or an intake — over `io`, writing its output there by its kind, and returns the result, which the host writes where `unit.result` says if it keeps it. A failure is the result's `outcome`, `failed` with its message and source locations, never a throw |
| `options.platforms(name: string): readonly PlatformFunction[] \| Promise<…>` | Each package the unit lists, asked once, in the unit's order, before the work begins; a throw fails the unit with its message |
| `options.resident?: () => number` · `options.peakBytes?: () => bigint` | The host's memory gauges. Without `resident`, what reading a lazy input whole weighs and what decoding an input whole added both come to 0; without `peakBytes`, the result's `peakBytes` is 0, as a browser's is |
| `options.report?: UnitRunReport` | Hears how a run unit's inputs open and what reading them came to: the account `exec -v` prints |
| `UnitIO` | The unit's files, by the paths it names: `read`, `size`, `readRange`, `segment(path, fetch)`, `list`, `makeDirectory`, `write` — every one synchronous, since compiled East reads a lazy input without awaiting |
| `new InMemoryUnitIO(files?: Iterable<[path: string, bytes: Uint8Array]>)` | A `UnitIO` in memory, for a host with no file system: given every file the unit names, segments included; `.files` then holds them and every file the unit wrote |
| `UnitType` · `UnitResultType` | The unit and its result as East types, for a host that keeps them as beast2 |

- The unit's thread grant (`threads`) caps the frame pool for the rest of the
  process: a grant of one frames every output inline.
- A unit whose host places segments as they are read (`fetch: true`) has
  `io.segment` asked for each segment of a staged manifest before it is read.
  `InMemoryUnitIO` holds every segment already, so its unit says `fetch: false`,
  and a segment it does not hold fails at once, as any absent file does.

```typescript
import { East, IntegerType, InMemoryUnitIO, decodeBeast2For, encodeBeast2For, encodeEastIR, executeUnit, variant, type Unit } from "@elaraai/east";

const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));

// A unit names its files by path: here, the program, its one input and its output.
const unit: Unit = {
    work: variant("run", {
        program: "program.beast2",
        inputs: ["x.beast2"],
        output: variant("value", "out.beast2"),
        decode: variant("lazy", null),
    }),
    platforms: [],          // the platform packages it needs, each resolved by `options.platforms`
    threads: 1n,
    fetch: false,           // every segment it reads is in the IO already
    result: "result.beast2",
};
const io = new InMemoryUnitIO([
    ["program.beast2", encodeEastIR(double.toIR())],
    ["x.beast2", encodeBeast2For(IntegerType)(21n)],
]);
const result = await executeUnit(unit, io, { platforms: () => [] });
// result.outcome: ok, or failed with its message and source locations; a failure is never thrown
decodeBeast2For(IntegerType)(io.read("out.beast2"));   // 42n
```

## IR → source: `East.toSource` and `east-node transpile`

Any IR — yours, or one exported from python — prints back as a module whose
`East.function(...)` rebuilds the same IR (equal under `east-c ir normalize`).

```typescript
const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
console.log(East.toSource(double));
// import { East, … IntegerType } from "@elaraai/east";
// export const main = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
```

```bash
east-node transpile double.beast2 -o double.ts                  # any runtime's IR
east-node transpile ./ir/ -o ./ts/ --rebuild ./rebuilt/          # a directory, and the IR each module builds back
east-py transpile double.beast2 -o double.py                     # the python twin
```

- Statements print as the `$`-forms, a bound value as `$.let(value, T)`, an
  Option as `some(v)` / `none`, other values as `East.value(v, T)`, builtins as
  their methods; one with no method spelling prints as
  `East.builtin(name, [T...], [args], out)`, which rebuilds. `East.as(v, T)` and
  `East.wrapRecursive(v, T)` spell the `As` and `WrapRecursive` nodes.
- A platform call prints as its library spells it when you pass the library:
  `East.toSource(fn, { libraries: { "@elaraai/east-node-io": await import("@elaraai/east-node-io") } })`.
  Without it the call hoists to a declaration named after the function
  (`const tar_create = East.asyncPlatform("tar_create", …)`). The printer finds
  the handles in the module's exports — each handle `East.platform` returns
  carries its `name`, `inputs`, `output` and `async`, and
  `isPlatformDeclaration(x)` tells one from a function.
- Variables keep the names you wrote, read by the TypeScript compiler (an
  optional peer); without it, or in a browser, they print as `_N`, as does a
  slot the body did not name (`($, x) =>` for a `(value, index)` callback).
- The contract and the round-trip suites: `docs/conventions/EAST_CODEGEN.md`.

## Checking that a module builds: `east-node check`

`tsc` type-checks the TypeScript around a program, not the program: East's own
refusals — a body whose type differs from the declared output, a capture the
builder refuses, an `IRAnalysisError` — happen when `East.function` runs, at
import.

```bash
east-node check dist/index.js                 # every broken function, at its line
east-node check dist/index.js --format json   # the records `east-py check --format json` emits
east-node lsp                                 # the diagnostics over stdio (needs @elaraai/east-diagnostics)
```

It reports **every** broken function, not the first. Importing a module runs
it, so `EAST_CHECK=1` is set meanwhile, and a module should skip import-time
work when it sees it. Edit-time idiom checks are separate:
`@elaraai/tsserver-plugin-east` in the editor, `@elaraai/eslint-plugin-east`'s
`east/east-rules` in `make lint`.
