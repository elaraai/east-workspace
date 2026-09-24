/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
    ArrayType, BlobType, BooleanType, DictType, FloatType, FunctionType, IntegerType, NullType, OptionType, SetType, StringType, StructType,
    East, EastError, SortedMap, SortedSet, compareFor, none, some, variant,
    Beast2ManifestWriter, Beast2RunSorter, UnitOutcomeType, UnitType,
    decodeBeast2For, decodeCollectionManifest, encodeBeast2For, encodeBeast2PagedFor, encodeEastIR, mergeBeast2For, openBeast2LazyFor, spliceBeast2,
    type Beast2ManifestSource, type Beast2RunSorterOptions, type EastIR, type EastType, type ValueTypeOf,
} from "../src/index.js";

/* The runner protocol's conformance corpus: units, each with the outputs and
 * the outcome every runner must come to for it.
 *
 * Each case is a directory — `unit.beast2` beside the files it names, under
 * relative paths — and a `case.beast2` holding what executing it must come
 * to: the outcome, every file the unit writes besides its result, byte for
 * byte, and paths it must not write. TypeScript works each case out with the
 * library's own Writer, RunSorter and Merger, from what the program emits or
 * returns when TypeScript runs it: the oracle the three runners are held to.
 * Under EXPORT_TEST_IR (`make test-export`) the cases are written to
 * <dir>/runner_corpus/<case>/, with their names in <dir>/runner_corpus/
 * index.beast2, where each runner's tests execute every case with `exec`. */

/** What executing a case's unit must come to. */
const RunnerCaseType = StructType({
    /** What the case holds. */
    name: StringType,
    /** Whether the case runs with every collection input opened lazily:
     *  `EAST_LAZY_INPUT_BYTES=1`. */
    lazy: BooleanType,
    /** The outcome. */
    outcome: UnitOutcomeType,
    /** Every file the unit writes besides its result, relative to the case's
     *  directory, with its bytes. Empty for a failure, whose partial output
     *  no reader takes. */
    outputs: ArrayType(StructType({ path: StringType, bytes: BlobType })),
    /** Paths the unit must not write: the run after its last. */
    absent: ArrayType(StringType),
});

/** A case: its directory, the files it holds, and what executing it must
 *  come to. */
interface RunnerCase {
    dir: string;
    files: Map<string, Uint8Array>;
    expected: ValueTypeOf<typeof RunnerCaseType>;
}

const cases: RunnerCase[] = [];

type Program = EastIR<any[], any>;

/** Adds the manifest directory of a collection to `files`: the manifest at
 *  `path`, every object it names in `<path>.segments/`. */
function addManifest(files: Map<string, Uint8Array>, path: string, type: EastType, elements: Iterable<unknown>): void {
    const writer = new Beast2ManifestWriter(type, {
        object: (hash, bytes) => { files.set(`${path}.segments/${hash}.beast2`, bytes.slice()); },
        manifest: (bytes) => { files.set(path, bytes.slice()); },
    });
    for (const element of elements) writer.add(element as never);
    writer.finish();
}

/** Adds a value output to `files` as a unit writes it: a collection as a
 *  manifest directory, anything else as one blob. */
function addValue(files: Map<string, Uint8Array>, path: string, type: EastType, value: unknown): void {
    if (type.type === "Dict") addManifest(files, path, type, (value as SortedMap<unknown, unknown>).entries());
    else if (type.type === "Array" || type.type === "Set") addManifest(files, path, type, value as Iterable<unknown>);
    else files.set(path, encodeBeast2For(type)(value as never));
}

/** Adds the runs a RunSorter writes for `elements` to `files`, each the
 *  manifest directory `<dir>/<n>.beast2`, and returns how many there are. */
function addRuns(files: Map<string, Uint8Array>, dir: string, type: EastType, elements: Iterable<unknown>, options: Beast2RunSorterOptions): number {
    const sorter = new Beast2RunSorter(type, (run) => ({
        object: (hash, bytes) => { files.set(`${dir}/${run}.beast2.segments/${hash}.beast2`, bytes.slice()); },
        manifest: (bytes) => { files.set(`${dir}/${run}.beast2`, bytes.slice()); },
    }), options);
    for (const element of elements) sorter.add(element as never);
    sorter.finish();
    return sorter.runs;
}

/** The manifest directory at `path` among `files`, as a merge reads it. */
function manifestSource(files: Map<string, Uint8Array>, path: string): Beast2ManifestSource {
    const manifest = decodeCollectionManifest(files.get(path)!);
    return { manifest, segment: (i) => files.get(`${path}.segments/${manifest.entries[i]!.hash}.beast2`)! };
}

/** What a program emits when TypeScript runs it on `inputs`: elements, or
 *  `[key, value]` pairs for a dict's emit. */
function emissionsOf(program: Program, inputs: unknown[], pairs: boolean): unknown[] {
    const emitted: unknown[] = [];
    program.compile([])(...inputs, pairs
        ? (key: unknown, value: unknown) => { emitted.push([key, value]); return null; }
        : (value: unknown) => { emitted.push(value); return null; });
    return emitted;
}

/** The error a program raises when TypeScript runs it on `inputs`. */
function errorOf(program: Program, inputs: unknown[]): EastError {
    try {
        program.compile([])(...inputs);
    } catch (err) {
        if (err instanceof EastError) return err;
        throw err;
    }
    throw new Error("the program did not fail");
}

const EmitInteger = FunctionType([IntegerType], NullType);
const EmitString = FunctionType([StringType], NullType);
const EmitFloat = FunctionType([FloatType], NullType);
const EmitStringInteger = FunctionType([StringType, IntegerType], NullType);
const EmitStringFloat = FunctionType([StringType, FloatType], NullType);
const TallyType = StructType({ count: IntegerType, total: FloatType });

describe("runner protocol corpus", () => {
    after(() => {
        if (!process.env.EXPORT_TEST_IR) return;
        const root = join(process.env.EXPORT_TEST_IR, "runner_corpus");
        for (const c of cases) {
            for (const [path, bytes] of c.files) {
                const file = join(root, c.dir, path);
                mkdirSync(dirname(file), { recursive: true });
                writeFileSync(file, bytes);
            }
            writeFileSync(join(root, c.dir, "case.beast2"), encodeBeast2For(RunnerCaseType)(c.expected));
        }
        writeFileSync(join(root, "index.beast2"), encodeBeast2For(ArrayType(StringType))(cases.map((c) => c.dir)));
    });

    describe("run", () => {
        test("a value: the sum of an Array blob", () => {
            const program = East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => xs.reduce(($, acc, x) => acc.add(x), 0n)).toIR();
            const xs = Array.from({ length: 10_000 }, (_, i) => BigInt(i * 3 - 7_000));
            const out = new Map<string, Uint8Array>();
            addValue(out, "output.beast2", IntegerType, program.compile([])(xs));
            cases.push({
                dir: "value-sum",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["input-0.beast2", encodeBeast2PagedFor(ArrayType(IntegerType))(xs)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: ["input-0.beast2"], output: variant("value", "output.beast2") }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "a value: the sum of an Array blob", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: [] },
            });
        });

        test("a Dict value, written as a manifest directory, from a manifest input", () => {
            const type = DictType(StringType, IntegerType);
            const program = East.function([type], type, ($, d) => d.map(($, value, _key) => value.multiply(2n))).toIR();
            const input = new SortedMap(Array.from({ length: 20_000 }, (_, i) => [`k${String(i).padStart(7, "0")}`, BigInt(i)] as [string, bigint]), compareFor(StringType));
            const files = new Map<string, Uint8Array>([["program.beast2", encodeEastIR(program)]]);
            addManifest(files, "input-0.beast2", type, input.entries());
            files.set("unit.beast2", encodeBeast2For(UnitType)({
                work: variant("run", { program: "program.beast2", inputs: ["input-0.beast2"], output: variant("value", "output.beast2") }),
                platforms: [],
                threads: 1n,
                result: "result.beast2",
            }));
            const out = new Map<string, Uint8Array>();
            addValue(out, "output.beast2", type, program.compile([])(input));
            assert.ok(decodeCollectionManifest(out.get("output.beast2")!).entries.length > 1, "the output spans segments");
            cases.push({
                dir: "value-dict",
                files,
                expected: { name: "a Dict value, written as a manifest directory, from a manifest input", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: [] },
            });
        });

        test("a value from a Set input opened lazily, and a Dict input beside it", () => {
            const program = East.function([SetType(StringType), DictType(StringType, IntegerType)], IntegerType, ($, s, d) =>
                s.reduce(($, acc, x) => acc.add(x.length()).add(d.get(x, ($, _k) => 0n)), 0n)).toIR();
            const set = new SortedSet(Array.from({ length: 30_000 }, (_, i) => `e${i * 7}`), compareFor(StringType));
            const dict = new SortedMap(Array.from({ length: 5_000 }, (_, i) => [`e${i * 3}`, BigInt(i)] as [string, bigint]), compareFor(StringType));
            const files = new Map<string, Uint8Array>([
                ["program.beast2", encodeEastIR(program)],
                ["input-0.beast2", encodeBeast2PagedFor(SetType(StringType))(set)],
            ]);
            addManifest(files, "input-1.beast2", DictType(StringType, IntegerType), dict.entries());
            files.set("unit.beast2", encodeBeast2For(UnitType)({
                work: variant("run", { program: "program.beast2", inputs: ["input-0.beast2", "input-1.beast2"], output: variant("value", "output.beast2") }),
                platforms: [],
                threads: 1n,
                result: "result.beast2",
            }));
            const out = new Map<string, Uint8Array>();
            addValue(out, "output.beast2", IntegerType, program.compile([])(set, dict));
            cases.push({
                dir: "value-lazy-inputs",
                files,
                expected: { name: "a value from a Set input opened lazily, and a Dict input beside it", lazy: true, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: [] },
            });
        });

        test("an Array emitted by a producer", () => {
            const program = East.function([EmitInteger], NullType, ($, emit) => {
                $.for(East.Array.range(0n, 2_500n), ($, i) => {
                    $(emit(i.multiply(2n)));
                });
            }).toIR();
            const out = new Map<string, Uint8Array>();
            addManifest(out, "out/0.beast2", ArrayType(IntegerType), emissionsOf(program, [], false));
            cases.push({
                dir: "array-producer",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: [], output: variant("array", "out") }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "an Array emitted by a producer", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: ["out/1.beast2"] },
            });
        });

        test("an Array of wide strings, cut by size, on four threads", () => {
            // The same bytes as on one: framing on a pool changes nothing
            // but where the work is done.
            const program = East.function([EmitString], NullType, ($, emit) => {
                $.for(East.Array.range(0n, 1_500n), ($, i) => {
                    $(emit(East.str`${"x".repeat(4096)}-${i}`));
                });
            }).toIR();
            const out = new Map<string, Uint8Array>();
            addManifest(out, "out/0.beast2", ArrayType(StringType), emissionsOf(program, [], false));
            assert.ok(decodeCollectionManifest(out.get("out/0.beast2")!).entries.length > 3, "cut by size into several segments");
            for (const threads of [1n, 4n]) {
                cases.push({
                    dir: `array-wide-threads-${threads}`,
                    files: new Map([
                        ["program.beast2", encodeEastIR(program)],
                        ["unit.beast2", encodeBeast2For(UnitType)({
                            work: variant("run", { program: "program.beast2", inputs: [], output: variant("array", "out") }),
                            platforms: [],
                            threads,
                            result: "result.beast2",
                        })],
                    ]),
                    expected: { name: `an Array of wide strings, cut by size, on ${threads} thread(s)`, lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: ["out/1.beast2"] },
                });
            }
        });

        test("a Set emitted in random order, with repeats, as sorted runs", () => {
            // 7919 is prime to 100,000: the keys come permuted, and each of
            // the first 40,000 twice, across the element cap.
            const program = East.function([EmitString], NullType, ($, emit) => {
                $.for(East.Array.range(0n, 140_000n), ($, i) => {
                    $(emit(East.str`e${i.multiply(7919n).remainder(100_000n)}`));
                });
            }).toIR();
            const type = SetType(StringType);
            const emitted = emissionsOf(program, [], false);
            const out = new Map<string, Uint8Array>();
            const runs = addRuns(out, "out", type, emitted, { union: true });
            assert.equal(runs, 2, "the element cap closes a run");

            // The runs merge to the Writer's blob of the sorted value.
            const chunks: Uint8Array[] = [];
            mergeBeast2For(type, { union: true })([0, 1].map((run) => manifestSource(out, `out/${run}.beast2`)), (bytes) => { chunks.push(bytes.slice()); });
            assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), encodeBeast2PagedFor(type)(new SortedSet(emitted as string[], compareFor(StringType))));

            cases.push({
                dir: "set-random",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: [], output: variant("set", "out") }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "a Set emitted in random order, with repeats, as sorted runs", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: ["out/2.beast2"] },
            });
        });

        test("a Dict emitted in random order, its repeated keys summed, as sorted runs", () => {
            const program = East.function([EmitStringInteger], NullType, ($, emit) => {
                $.for(East.Array.range(0n, 200_000n), ($, i) => {
                    $(emit(East.str`k${i.multiply(7919n).remainder(60_000n)}`, i));
                });
            }).toIR();
            const sum = East.function([StringType, IntegerType, IntegerType], IntegerType, (_$, _key, acc, value) => acc.add(value)).toIR();
            const type = DictType(StringType, IntegerType);
            const merge = sum.compile([]) as (key: unknown, acc: unknown, value: unknown) => unknown;
            const emitted = emissionsOf(program, [], true) as [string, bigint][];
            const out = new Map<string, Uint8Array>();
            const runs = addRuns(out, "out", type, emitted, { merge });
            assert.equal(runs, 2, "the element cap closes a run");

            // The runs merge to the Writer's blob of the folded value.
            const folded = new SortedMap<string, bigint>(undefined, compareFor(StringType));
            for (const [key, value] of emitted) folded.set(key, (folded.get(key) ?? 0n) + value);
            const chunks: Uint8Array[] = [];
            mergeBeast2For(type, { merge })([0, 1].map((run) => manifestSource(out, `out/${run}.beast2`)), (bytes) => { chunks.push(bytes.slice()); });
            assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), encodeBeast2PagedFor(type)(folded));

            cases.push({
                dir: "dict-sum",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["sum.beast2", encodeEastIR(sum)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: [], output: variant("dict", { dir: "out", merge: some("sum.beast2") }) }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "a Dict emitted in random order, its repeated keys summed, as sorted runs", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: ["out/2.beast2"] },
            });
        });

        test("a Dict of floats summed across the element cap", () => {
            // Where the run closes decides how the floats group before they
            // sum, and so the output's bytes.
            const program = East.function([EmitStringFloat], NullType, ($, emit) => {
                $.for(East.Array.range(0n, 140_000n), ($, i) => {
                    $(emit(East.str`f${i.remainder(7n)}`, i.remainder(11n).add(1n).toFloat().multiply(0.1)));
                });
            }).toIR();
            const sum = East.function([StringType, FloatType, FloatType], FloatType, (_$, _key, acc, value) => acc.add(value)).toIR();
            const out = new Map<string, Uint8Array>();
            const runs = addRuns(out, "out", DictType(StringType, FloatType), emissionsOf(program, [], true), { merge: sum.compile([]) as (key: unknown, acc: unknown, value: unknown) => unknown });
            assert.equal(runs, 2);
            cases.push({
                dir: "dict-floats",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["sum.beast2", encodeEastIR(sum)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: [], output: variant("dict", { dir: "out", merge: some("sum.beast2") }) }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "a Dict of floats summed across the element cap", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: ["out/2.beast2"] },
            });
        });

        test("a Dict that emits nothing writes no run", () => {
            const program = East.function([EmitStringInteger], NullType, (_$, _emit) => null).toIR();
            cases.push({
                dir: "dict-empty",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: [], output: variant("dict", { dir: "out", merge: none }) }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "a Dict that emits nothing writes no run", lazy: false, outcome: variant("ok", null), outputs: [], absent: ["out/0.beast2"] },
            });
        });

        test("a Dict key emitted twice without a merge fails, naming it", () => {
            const program = East.function([EmitStringInteger], NullType, ($, emit) => {
                $(emit("b", 1n));
                $(emit("a", 2n));
                $(emit("b", 3n));
            }).toIR();
            const type = DictType(StringType, IntegerType);
            let refusal = "";
            try {
                addRuns(new Map(), "out", type, emissionsOf(program, [], true), {});
            } catch (err) {
                refusal = (err as Error).message;
            }
            assert.equal(refusal, `beast2 v5: duplicate Dict key emitted: "b" — Dict keys must be unique`);
            cases.push({
                dir: "dict-duplicate",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: [], output: variant("dict", { dir: "out", merge: none }) }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                // The run is written once the program has returned, so no
                // East code is running when the key is refused.
                expected: { name: "a Dict key emitted twice without a merge fails, naming it", lazy: false, outcome: variant("failed", { message: refusal, locations: [] }), outputs: [], absent: [] },
            });
        });

        test("a fold of emitted floats, from zero", () => {
            const program = East.function([EmitFloat], NullType, ($, emit) => {
                $.for(East.Array.range(0n, 5_000n), ($, i) => {
                    $(emit(i.remainder(13n).toFloat().multiply(0.25).subtract(1.5)));
                });
            }).toIR();
            const add = East.function([FloatType, FloatType], FloatType, (_$, acc, value) => acc.add(value)).toIR();
            const combine = add.compile([]) as (acc: number, value: number) => number;
            const out = new Map<string, Uint8Array>();
            addValue(out, "total.beast2", FloatType, (emissionsOf(program, [], false) as number[]).reduce((acc, value) => combine(acc, value), 0));
            cases.push({
                dir: "fold-floats",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["add.beast2", encodeEastIR(add)],
                    ["zero.beast2", encodeBeast2For(FloatType)(0)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: [], output: variant("fold", { path: "total.beast2", zero: "zero.beast2", combine: "add.beast2" }) }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "a fold of emitted floats, from zero", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: [] },
            });
        });

        test("a fold of structs, field by field, over an input", () => {
            const program = East.function([ArrayType(FloatType), FunctionType([TallyType], NullType)], NullType, ($, xs, emit) => {
                $.for(xs, ($, x, _i, _label) => {
                    $(emit({ count: 1n, total: x }));
                });
            }).toIR();
            const add = East.function([TallyType, TallyType], TallyType, (_$, acc, value) => ({
                count: acc.count.add(value.count),
                total: acc.total.add(value.total),
            })).toIR();
            const combine = add.compile([]) as (acc: unknown, value: unknown) => unknown;
            const xs = Array.from({ length: 3_000 }, (_, i) => (i % 9) * 0.1);
            const out = new Map<string, Uint8Array>();
            addValue(out, "tally.beast2", TallyType, emissionsOf(program, [xs], false).reduce((acc, value) => combine(acc, value), { count: 0n, total: 0 }));
            cases.push({
                dir: "fold-tally",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["add.beast2", encodeEastIR(add)],
                    ["zero.beast2", encodeBeast2For(TallyType)({ count: 0n, total: 0 })],
                    ["input-0.beast2", encodeBeast2PagedFor(ArrayType(FloatType))(xs)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: ["input-0.beast2"], output: variant("fold", { path: "tally.beast2", zero: "zero.beast2", combine: "add.beast2" }) }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "a fold of structs, field by field, over an input", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: [] },
            });
        });

        test("a program that raises an error fails with its message and location", () => {
            const program = East.function([IntegerType], IntegerType, ($, x) => {
                $.if(East.greater(x, 10n), ($) => {
                    $.error(East.str`too large: ${x}`);
                });
                return x;
            }).toIR();
            const err = errorOf(program, [42n]);
            assert.ok(err.location.length > 0, "the error has a location");
            cases.push({
                dir: "failed-error",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["input-0.beast2", encodeBeast2For(IntegerType)(42n)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: ["input-0.beast2"], output: variant("value", "output.beast2") }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "a program that raises an error fails with its message and location", lazy: false, outcome: variant("failed", { message: err.eastMessage, locations: err.location }), outputs: [], absent: [] },
            });
        });

        test("mutating a lazily opened input fails with the frozen-input error", () => {
            const type = DictType(IntegerType, StringType);
            const program = East.function([type], NullType, ($, d) => {
                $.for(d, (_$, _value, _key) => d.insert(999n, "x"));
                return null;
            }).toIR();
            const input = new SortedMap(Array.from({ length: 10 }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]), compareFor(IntegerType));
            const blob = encodeBeast2PagedFor(type)(input);
            const err = errorOf(program, [decodeBeast2For(type, { frozen: true })(blob)]);
            cases.push({
                dir: "failed-frozen",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["input-0.beast2", blob],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: ["input-0.beast2"], output: variant("value", "output.beast2") }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "mutating a lazily opened input fails with the frozen-input error", lazy: true, outcome: variant("failed", { message: err.eastMessage, locations: err.location }), outputs: [], absent: [] },
            });
        });

        test("writing through an element of a lazily opened input fails with the frozen-input error", () => {
            const type = DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) }));
            const program = East.function([type], IntegerType, ($, d) => {
                const row = $.let(d.get(1n));
                $(row.xs.pushLast(42n));
                return d.get(1n).xs.size();
            }).toIR();
            const input = new SortedMap<bigint, { xs: bigint[] }>([[1n, { xs: [1n, 2n] }], [2n, { xs: [] }], [3n, { xs: [3n] }]], compareFor(IntegerType));
            const files = new Map<string, Uint8Array>([["program.beast2", encodeEastIR(program)]]);
            addManifest(files, "input-0.beast2", type, input.entries());
            files.set("unit.beast2", encodeBeast2For(UnitType)({
                work: variant("run", { program: "program.beast2", inputs: ["input-0.beast2"], output: variant("value", "output.beast2") }),
                platforms: [],
                threads: 1n,
                result: "result.beast2",
            }));
            const err = errorOf(program, [openBeast2LazyFor(type, { frozen: true })(manifestSource(files, "input-0.beast2"))]);
            cases.push({
                dir: "failed-frozen-nested",
                files,
                expected: { name: "writing through an element of a lazily opened input fails with the frozen-input error", lazy: true, outcome: variant("failed", { message: err.eastMessage, locations: err.location }), outputs: [], absent: [] },
            });
        });

        test("a keyed read of a corrupt input opened lazily fails at the read, naming the segments", () => {
            // A high key range spliced before a low one: the segments' first
            // keys do not ascend, which the read checks before it looks.
            const type = DictType(IntegerType, StringType);
            const program = East.function([type], BooleanType, (_$, d) => d.has(5n)).toIR();
            const blob = spliceBeast2([1000, 0].map((from) => encodeBeast2PagedFor(type)(
                new SortedMap(Array.from({ length: 6 }, (_, i) => [BigInt(from + i), `row-${from + i}`] as [bigint, string]), compareFor(IntegerType)))));
            const err = errorOf(program, [openBeast2LazyFor(type, { frozen: true })(blob)]);
            assert.equal(err.eastMessage, "beast2 v5: segments 0 and 1 are not disjoint ascending key ranges — the wire must hold the canonical value (corrupt or pre-contract blob)");
            assert.ok(err.location.length > 0, "the error is at the read");
            cases.push({
                dir: "failed-corrupt-read",
                files: new Map([
                    ["program.beast2", encodeEastIR(program)],
                    ["input-0.beast2", blob],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("run", { program: "program.beast2", inputs: ["input-0.beast2"], output: variant("value", "output.beast2") }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "a keyed read of a corrupt input opened lazily fails at the read, naming the segments", lazy: true, outcome: variant("failed", { message: err.eastMessage, locations: err.location }), outputs: [], absent: [] },
            });
        });
    });

    describe("merge", () => {
        test("Set runs, overlapping, unioned into one run", () => {
            const type = SetType(StringType);
            const files = new Map<string, Uint8Array>();
            const parts = [0, 1, 2].map((j) => new SortedSet(Array.from({ length: 15_000 }, (_, i) => `e${String(j * 7_000 + i).padStart(7, "0")}`), compareFor(StringType)));
            parts.forEach((part, j) => addManifest(files, `part-${j}.beast2`, type, part));
            files.set("unit.beast2", encodeBeast2For(UnitType)({
                work: variant("merge", { parts: ["part-0.beast2", "part-1.beast2", "part-2.beast2"], range: none, output: variant("set", "out") }),
                platforms: [],
                threads: 1n,
                result: "result.beast2",
            }));
            const out = new Map<string, Uint8Array>();
            mergeBeast2For(type, { union: true })([0, 1, 2].map((j) => manifestSource(files, `part-${j}.beast2`)), {
                object: (hash, bytes) => { out.set(`out/0.beast2.segments/${hash}.beast2`, bytes.slice()); },
                manifest: (bytes) => { out.set("out/0.beast2", bytes.slice()); },
            });
            cases.push({
                dir: "merge-sets",
                files,
                expected: { name: "Set runs, overlapping, unioned into one run", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: ["out/1.beast2"] },
            });
        });

        test("Dict parts summed over a key range", () => {
            const type = DictType(StringType, IntegerType);
            const sum = East.function([StringType, IntegerType, IntegerType], IntegerType, (_$, _key, acc, value) => acc.add(value)).toIR();
            const parts = [0, 1].map((j) => encodeBeast2PagedFor(type)(new SortedMap(Array.from({ length: 25_000 }, (_, i) => [`k${String(i + j * 10_000).padStart(7, "0")}`, BigInt(i)] as [string, bigint]), compareFor(StringType))));
            const range = { from: some("k0012000"), to: some("k0030000") };
            const out = new Map<string, Uint8Array>();
            mergeBeast2For(type, { merge: sum.compile([]) as (key: unknown, acc: unknown, value: unknown) => unknown, from: "k0012000", to: "k0030000" })(parts, {
                object: (hash, bytes) => { out.set(`out/0.beast2.segments/${hash}.beast2`, bytes.slice()); },
                manifest: (bytes) => { out.set("out/0.beast2", bytes.slice()); },
            });
            cases.push({
                dir: "merge-dicts-range",
                files: new Map([
                    ["sum.beast2", encodeEastIR(sum)],
                    ["part-0.beast2", parts[0]!],
                    ["part-1.beast2", parts[1]!],
                    ["range.beast2", encodeBeast2For(StructType({ from: OptionType(StringType), to: OptionType(StringType) }))(range)],
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("merge", { parts: ["part-0.beast2", "part-1.beast2"], range: some("range.beast2"), output: variant("dict", { dir: "out", merge: some("sum.beast2") }) }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "Dict parts summed over a key range", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: ["out/1.beast2"] },
            });
        });

        test("fold partials, folded in order from zero", () => {
            const add = East.function([FloatType, FloatType], FloatType, (_$, acc, value) => acc.add(value)).toIR();
            const combine = add.compile([]) as (acc: number, value: number) => number;
            const partials = [1e16, 3.3, -1e16, 0.1];
            const out = new Map<string, Uint8Array>();
            addValue(out, "total.beast2", FloatType, partials.reduce((acc, value) => combine(acc, value), 0));
            cases.push({
                dir: "merge-folds",
                files: new Map([
                    ["add.beast2", encodeEastIR(add)],
                    ["zero.beast2", encodeBeast2For(FloatType)(0)],
                    ...partials.map((partial, i) => [`part-${i}.beast2`, encodeBeast2For(FloatType)(partial)] as [string, Uint8Array]),
                    ["unit.beast2", encodeBeast2For(UnitType)({
                        work: variant("merge", { parts: partials.map((_, i) => `part-${i}.beast2`), range: none, output: variant("fold", { path: "total.beast2", zero: "zero.beast2", combine: "add.beast2" }) }),
                        platforms: [],
                        threads: 1n,
                        result: "result.beast2",
                    })],
                ]),
                expected: { name: "fold partials, folded in order from zero", lazy: false, outcome: variant("ok", null), outputs: [...out].map(([path, bytes]) => ({ path, bytes })), absent: [] },
            });
        });
    });
});
