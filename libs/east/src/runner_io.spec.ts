/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a unit's work reads and writes through: the in-memory `UnitIO` a
 * browser runs units over, the paths a unit names resolved as east-c's
 * `east_unit_read` resolves them, and the readers of a unit's program and
 * inputs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AsyncEastIR, EastIR, InMemoryUnitIO, UnitType,
  DictType, IntegerType, StringType, IRType,
  East, SortedMap, beast2LazyStats, compareFor, encodeBeast2For, encodeBeast2PagedFor, encodeEastIR, encodeEastFor, encodeJSONFor,
  equalFor, isFrozenValue, none, printFor, some, toEastTypeValue, variant,
  Beast2ManifestWriter, decodeCollectionManifest,
  type Unit,
} from "./index.js";
import {
  lazyInputBytesRead, loadUnitInput, loadUnitProgram, openUnitInputLazy, openUnitInputs, resolveUnitPaths, unitFileFormat, unitInputBytes,
} from "./internal.js";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe("InMemoryUnitIO", () => {
  it("reads what it holds, whole, by size and by range, a range fewer bytes only where the file ends", () => {
    const io = new InMemoryUnitIO([["dir/a.beast2", bytes(1, 2, 3, 4, 5)]]);
    assert.deepEqual(io.read("dir/a.beast2"), bytes(1, 2, 3, 4, 5));
    assert.equal(io.size("dir/a.beast2"), 5);
    assert.deepEqual(io.readRange("dir/a.beast2", 1, 3), bytes(2, 3, 4));
    assert.deepEqual(io.readRange("dir/a.beast2", 3, 10), bytes(4, 5));
    assert.throws(() => io.read("dir/b.beast2"), { message: "no such file: dir/b.beast2" });
    assert.throws(() => io.size("dir"), { message: "no such file: dir" }, "a directory has no size");
  });

  it("holds one file by one path, however the unit writes it", () => {
    const io = new InMemoryUnitIO([["./a/../b//c.beast2", bytes(7)], ["/abs/d.beast2", bytes(8)]]);
    assert.deepEqual([...io.files.keys()], ["b/c.beast2", "/abs/d.beast2"]);
    assert.deepEqual(io.read("b/./c.beast2"), bytes(7));
    assert.deepEqual(io.read("/abs/../abs/d.beast2"), bytes(8));
    assert.deepEqual(io.list("."), ["b"], "the relative root lists relative paths");
    assert.deepEqual(io.list("/"), ["abs"]);
  });

  it("writes into a directory that is there, and keeps its own copy of the bytes", () => {
    const io = new InMemoryUnitIO([["unit.beast2", bytes(0)]]);
    const out = bytes(1, 2);
    io.write("out.beast2", out);
    out[0] = 9;
    assert.deepEqual(io.read("out.beast2"), bytes(1, 2), "a write copies what it is given");
    io.write("out.beast2", bytes(3));
    assert.deepEqual(io.read("out.beast2"), bytes(3), "a write replaces the file");
    assert.throws(() => io.write("runs/0.beast2", bytes(1)), { message: "no such directory: runs" });
    io.makeDirectory("runs/0.beast2.segments");
    io.write("runs/0.beast2.segments/h.beast2", bytes(4));
    assert.deepEqual(io.list("runs"), ["0.beast2.segments"], "a directory made with its parents");
    assert.deepEqual(io.list("runs/0.beast2.segments"), ["h.beast2"]);
    assert.throws(() => io.write("runs", bytes(1)), { message: "is a directory: runs" });
  });

  it("lists what a directory holds, files and directories, and refuses a file or nothing", () => {
    const io = new InMemoryUnitIO([["in.beast2", bytes(1)], ["in.beast2.segments/x.beast2", bytes(2)]]);
    io.makeDirectory("out");
    assert.deepEqual(io.list(""), ["in.beast2", "in.beast2.segments", "out"]);
    assert.deepEqual(io.list("out"), [], "a directory made and still empty");
    io.makeDirectory("out");
    assert.throws(() => io.list("in.beast2"), { message: "not a directory: in.beast2" });
    assert.throws(() => io.list("missing"), { message: "no such directory: missing" });
    assert.throws(() => io.makeDirectory("in.beast2/sub"), { message: "not a directory: in.beast2" });
  });

  it("never asks a host for a segment: every file it reads is held, and one not held is absent", () => {
    const io = new InMemoryUnitIO([["in.beast2.segments/x.beast2", bytes(1)]]);
    io.segment("in.beast2.segments/x.beast2", true);
    io.segment("in.beast2.segments/y.beast2", true);
    assert.deepEqual([...io.files.keys()], ["in.beast2.segments/x.beast2"], "asking wrote nothing");
    assert.throws(() => io.read("in.beast2.segments/y.beast2"), { message: "no such file: in.beast2.segments/y.beast2" });
  });
});

describe("resolveUnitPaths", () => {
  const at = (path: string): string => `/staged/${path}`;
  const given = { platforms: ["@elaraai/east-node-std"], threads: 4n, fetch: true, result: "result.beast2" };
  const resolved = { ...given, result: "/staged/result.beast2" };
  const cases: [string, Unit, Unit][] = [
    ["a run unit's program, inputs and dict output with its merge", {
      ...given,
      work: variant("run", { program: "p.beast2", inputs: ["a.beast2", "b.beast2"], output: variant("dict", { dir: "out", merge: some("sum.beast2") }), decode: variant("whole", null) }),
    }, {
      ...resolved,
      work: variant("run", { program: "/staged/p.beast2", inputs: ["/staged/a.beast2", "/staged/b.beast2"], output: variant("dict", { dir: "/staged/out", merge: some("/staged/sum.beast2") }), decode: variant("whole", null) }),
    }],
    ["a merge unit's parts, range and fold", {
      ...given,
      work: variant("merge", { parts: ["p0.beast2"], range: some("range.beast2"), output: variant("fold", { path: "t.beast2", zero: "z.beast2", combine: "c.beast2" }) }),
    }, {
      ...resolved,
      work: variant("merge", { parts: ["/staged/p0.beast2"], range: some("/staged/range.beast2"), output: variant("fold", { path: "/staged/t.beast2", zero: "/staged/z.beast2", combine: "/staged/c.beast2" }) }),
    }],
    ["an intake unit's delivery, type and output, its piece kept", {
      ...given,
      work: variant("intake", { input: "d.beast2", type: "type.beast2", segments: some({ from: 1n, to: 3n }), output: "o.beast2" }),
    }, {
      ...resolved,
      work: variant("intake", { input: "/staged/d.beast2", type: "/staged/type.beast2", segments: some({ from: 1n, to: 3n }), output: "/staged/o.beast2" }),
    }],
    ["a dict output with no merge, and no range", {
      ...given,
      work: variant("merge", { parts: [], range: none, output: variant("dict", { dir: "runs", merge: none }) }),
    }, {
      ...resolved,
      work: variant("merge", { parts: [], range: none, output: variant("dict", { dir: "/staged/runs", merge: none }) }),
    }],
    ...(["value", "array", "set"] as const).map((kind): [string, Unit, Unit] => [`${kind === "array" ? "an" : "a"} ${kind} output`, {
      ...given,
      work: variant("run", { program: "p.beast2", inputs: [], output: variant(kind, "o"), decode: variant("lazy", null) }),
    }, {
      ...resolved,
      work: variant("run", { program: "/staged/p.beast2", inputs: [], output: variant(kind, "/staged/o"), decode: variant("lazy", null) }),
    }]),
  ];
  const equalUnit = equalFor(UnitType);
  const printUnit = printFor(UnitType);
  for (const [name, unit, expected] of cases) {
    it(`resolves ${name}`, () => {
      const got = resolveUnitPaths(unit, at);
      assert.ok(equalUnit(got, expected), `resolved to ${printUnit(got)}`);
      // What it resolves to is a unit, as its encoding says.
      assert.deepEqual(encodeBeast2For(UnitType)(got), encodeBeast2For(UnitType)(expected));
    });
  }
});

describe("reading a unit's program and inputs", () => {
  const DT = DictType(IntegerType, StringType);
  const rows = (n: number): SortedMap<bigint, string> => new SortedMap<bigint, string>(
    Array.from({ length: n }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]),
    compareFor(IntegerType),
  );

  /** A Dict staged as e3 stages one: its manifest, and every object it names
   *  beside it. */
  function staged(value: SortedMap<bigint, string>): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    const writer = new Beast2ManifestWriter(DT, {
      object: (hash, blob) => { files.set(`table.beast2.segments/${hash}.beast2`, blob.slice()); },
      manifest: (blob) => { files.set("table.beast2", blob.slice()); },
    });
    for (const entry of value) writer.add(entry);
    writer.finish();
    return files;
  }

  it("tells a file's encoding by its extension, and names one it cannot read", () => {
    assert.equal(unitFileFormat("x.beast2"), "beast2");
    assert.equal(unitFileFormat("dir.d/X.BEAST"), "beast2");
    assert.equal(unitFileFormat("x.east"), "east");
    assert.equal(unitFileFormat("x.json"), "json");
    assert.throws(() => unitFileFormat("x.csv"), { message: 'Unsupported file extension ".csv". Supported extensions: .beast2, .beast, .east, .json' });
    assert.throws(() => unitFileFormat(".beast2"), { message: 'Unsupported file extension "". Supported extensions: .beast2, .beast, .east, .json' });
  });

  it("loads a program in every encoding a unit may name it in, sync or async, and refuses IR that is no function", () => {
    const sync = East.function([IntegerType], IntegerType, ($, x) => x.add(1n)).toIR();
    const constant = variant("Value", { type: variant("Integer", null), loc_id: 0n, value: variant("Integer", 1n) });
    const io = new InMemoryUnitIO([
      ["sync.beast2", encodeEastIR(sync)],
      ["async.beast2", encodeEastIR(East.asyncFunction([IntegerType], IntegerType, ($, x) => x.add(2n)).toIR())],
      ["sync.json", encodeJSONFor(IRType)(sync.ir)],
      ["sync.east", encodeEastFor(IRType)(sync.ir)],
      ["constant.beast2", encodeBeast2For(IRType)(constant)],
      ["constant.json", encodeJSONFor(IRType)(constant)],
    ]);
    for (const path of ["sync.beast2", "sync.json", "sync.east"]) {
      const program = loadUnitProgram(io, path);
      assert.ok(program instanceof EastIR, path);
      assert.equal((program as EastIR<[bigint], bigint>).compile([])(1n), 2n, path);
    }
    assert.ok(loadUnitProgram(io, "async.beast2") instanceof AsyncEastIR);
    for (const path of ["constant.beast2", "constant.json"]) {
      assert.throws(() => loadUnitProgram(io, path), { message: 'IR file must contain a function or async function, got "Value"' }, path);
    }
  });

  it("opens a staged manifest lazily, frozen, reading only the segments a read reaches", () => {
    const table = rows(20_000);
    const io = new InMemoryUnitIO(staged(table));
    const segments = decodeCollectionManifest(io.read("table.beast2")).entries.length;
    assert.ok(segments > 2, `several segments, got ${segments}`);
    const lazy = openUnitInputLazy(io, "table.beast2", { fetch: false }) as SortedMap<bigint, string>;
    assert.ok(isFrozenValue(lazy), "an input opens frozen");
    assert.equal(lazy.size, 20_000, "the size is the manifest's");
    const before = lazyInputBytesRead(lazy)!;
    assert.equal(lazy.get(12_345n), "row-12345");
    assert.ok(lazyInputBytesRead(lazy)! > before, "the read reached a segment");
    const stats = beast2LazyStats(lazy)!;
    assert.deepEqual([stats.segmentsDecoded, stats.hydrated], [1, false], "one segment decoded, and the input not read whole");
    assert.ok(equalFor(DT)(lazy, table), "it is the collection the manifest names");
  });

  it("decodes a staged manifest whole to the collection it names, and weighs it by that collection", () => {
    const table = rows(5_000);
    const files = staged(table);
    const io = new InMemoryUnitIO(files);
    const whole = loadUnitInput(io, "table.beast2", toEastTypeValue(DT), false) as SortedMap<bigint, string>;
    assert.ok(equalFor(DT)(whole, table));
    const manifest = decodeCollectionManifest(files.get("table.beast2")!);
    const segmentBytes = manifest.entries.reduce((sum, entry) => sum + files.get(`table.beast2.segments/${entry.hash}.beast2`)!.length, 0);
    assert.equal(unitInputBytes(io, "table.beast2"), files.get("table.beast2")!.length + segmentBytes, "the manifest and every segment it names");
    const blob = new InMemoryUnitIO([["blob.beast2", encodeBeast2PagedFor(DT)(table)]]);
    assert.equal(unitInputBytes(blob, "blob.beast2"), blob.size("blob.beast2"), "a blob is its own file");
  });

  it("refuses a lazy open over a segment not held, and its whole decode fails naming the segment", () => {
    const files = staged(rows(5_000));
    const gone = `table.beast2.segments/${decodeCollectionManifest(files.get("table.beast2")!).entries[0]!.hash}.beast2`;
    files.delete(gone);
    const io = new InMemoryUnitIO(files);
    assert.equal(openUnitInputLazy(io, "table.beast2", { fetch: false }), undefined);
    assert.throws(() => loadUnitInput(io, "table.beast2", toEastTypeValue(DT), false), { message: `no such file: ${gone}` });
  });

  it("opens each input as the unit's decode says, and says how each opened", () => {
    const table = rows(2_000);
    const io = new InMemoryUnitIO([...staged(table), ["x.beast2", encodeBeast2For(IntegerType)(7n)]]);
    const heard: string[] = [];
    const report = {
      openedLazily: (i: number) => { heard.push(`${i} lazily`); },
      decodedWhole: (i: number, grown: number) => { heard.push(`${i} whole +${grown}`); },
    };
    let gauge = 100;
    const resident = (): number => (gauge += 50);
    const paths = ["table.beast2", "x.beast2"];
    const types = [toEastTypeValue(DT), toEastTypeValue(IntegerType)];

    const lazy = openUnitInputs(io, paths, types, variant("lazy", null), { fetch: false, resident, report });
    assert.deepEqual(heard, ["0 lazily", "1 whole +50"], "a collection opens lazily, and a value is decoded whole, weighed by the gauge");
    assert.notEqual(lazyInputBytesRead(lazy[0]), undefined);
    assert.equal(lazy[1], 7n);

    heard.length = 0;
    const whole = openUnitInputs(io, paths, types, variant("whole", null), { fetch: false, report });
    assert.deepEqual(heard, ["0 whole +0", "1 whole +0"], "whole decodes every input, and without a gauge weighs nothing");
    assert.equal(lazyInputBytesRead(whole[0]), undefined);
    assert.ok(equalFor(DT)(whole[0] as SortedMap<bigint, string>, table));
    assert.ok(isFrozenValue(whole[0]), "an input decoded whole is frozen too");
    assert.throws(() => (whole[0] as SortedMap<bigint, string>).set(1n, "x"), { message: "Cannot modify frozen SortedMap" });
  });
});
