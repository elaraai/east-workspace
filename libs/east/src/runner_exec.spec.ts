/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `executeUnit` and what it asks of its host: the platform functions of each
 * package a unit lists, the host's memory gauges, who hears how a run unit's
 * inputs are read, and the segments a unit whose host places them as they are
 * read asks for. What a unit's work comes to — its outputs and outcome, byte
 * for byte — the runner corpus holds it to (`test/runner_corpus.spec.ts`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DictType, IntegerType, StringType,
  East, InMemoryUnitIO, UnitOutcomeType,
  Beast2ManifestWriter, decodeBeast2For, decodeCollectionManifest, encodeBeast2For, encodeEastIR, equalFor, executeUnit,
  isTypeValueEqual, none, printFor, toEastTypeValue, variant,
  type Beast2LazyStats, type EastTypeValue, type Unit, type UnitRunReport,
} from "./index.js";

const DT = DictType(IntegerType, StringType);

/** An outcome as a message shows it. */
const printOutcome = printFor(UnitOutcomeType);

/** A unit's files: a Dict staged as e3 stages one, as `table.beast2` and the
 *  segments beside it, and whatever else is given. */
function staged(rows: number, others: [string, Uint8Array][] = []): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>(others);
  const writer = new Beast2ManifestWriter(DT, {
    object: (hash, blob) => { files.set(`table.beast2.segments/${hash}.beast2`, blob.slice()); },
    manifest: (blob) => { files.set("table.beast2", blob.slice()); },
  });
  for (let i = 0; i < rows; i++) writer.add([BigInt(i), `row-${i}`]);
  writer.finish();
  return files;
}

/** A run unit over `inputs`, its output a value. */
function runUnit(inputs: string[], options: { platforms?: string[]; fetch?: boolean; decode?: "lazy" | "whole" } = {}): Unit {
  return {
    work: variant("run", {
      program: "program.beast2",
      inputs,
      output: variant("value", "out.beast2"),
      decode: options.decode === "whole" ? variant("whole", null) : variant("lazy", null),
    }),
    platforms: options.platforms ?? [],
    threads: 1n,
    fetch: options.fetch ?? false,
    result: "result.beast2",
  };
}

/** A resolver for units that list no platform package. */
const noPackages = (name: string): never => {
  throw new Error(`no platform package ${name} here`);
};

/** An IO that records every segment it is asked to make there. */
class AskedIO extends InMemoryUnitIO {
  readonly asked: [path: string, fetch: boolean][] = [];

  override segment(path: string, fetch: boolean): void {
    this.asked.push([path, fetch]);
    super.segment(path, fetch);
  }
}

describe("executeUnit", () => {
  it("resolves each platform package the unit lists, once and in order, and runs the program with their functions", async () => {
    const double = East.platform("exec_spec_double", [IntegerType], IntegerType);
    const inc = East.platform("exec_spec_inc", [IntegerType], IntegerType);
    const program = East.function([IntegerType], IntegerType, ($, x) => inc(double(x)));
    const io = new InMemoryUnitIO([
      ["program.beast2", encodeEastIR(program.toIR())],
      ["x.beast2", encodeBeast2For(IntegerType)(7n)],
    ]);
    const resolved: string[] = [];
    const result = await executeUnit(runUnit(["x.beast2"], { platforms: ["pkg-double", "pkg-inc"] }), io, {
      platforms: (name) => {
        resolved.push(name);
        // A host may resolve a package at once, or later.
        return name === "pkg-double"
          ? [double.implement((x: bigint) => x * 2n)]
          : Promise.resolve([inc.implement((x: bigint) => x + 1n)]);
      },
    });
    assert.ok(equalFor(UnitOutcomeType)(result.outcome, variant("ok", null)), printOutcome(result.outcome));
    assert.deepEqual(resolved, ["pkg-double", "pkg-inc"]);
    assert.equal(decodeBeast2For(IntegerType)(io.read("out.beast2")), 15n);
  });

  it("fails a unit whose package its host cannot resolve, in the host's words, before any work", async () => {
    // The program the unit names is not there: the resolver's refusal comes
    // first, so its words are the outcome's.
    const io = new InMemoryUnitIO([["x.beast2", encodeBeast2For(IntegerType)(7n)]]);
    const result = await executeUnit(runUnit(["x.beast2"], { platforms: ["pkg-missing"] }), io, { platforms: noPackages });
    assert.ok(equalFor(UnitOutcomeType)(result.outcome, variant("failed", { message: "no platform package pkg-missing here", locations: [] })),
      printOutcome(result.outcome));
    assert.deepEqual([...io.files.keys()], ["x.beast2"], "nothing is written");
  });

  it("tells its report how a run unit reads its inputs, and weighs them by the host's gauges", async () => {
    const program = East.function([DT, IntegerType], StringType, ($, table, key) => table.get(key));
    const io = new InMemoryUnitIO(staged(20_000, [
      ["program.beast2", encodeEastIR(program.toIR())],
      ["x.beast2", encodeBeast2For(IntegerType)(123n)],
    ]));
    const segments = decodeCollectionManifest(io.read("table.beast2")).entries.length;
    const heard: unknown[] = [];
    let inputTypes: readonly EastTypeValue[] = [];
    const report: UnitRunReport = {
      running: (path, inputs) => {
        heard.push(["running", path, inputs.map((input) => input.path)]);
        inputTypes = inputs.map((input) => input.type);
      },
      openedLazily: (i) => { heard.push(["lazily", i]); },
      decodedWhole: (i, grown) => { heard.push(["whole", i, grown]); },
      lazyReads: (i, path, stats: Beast2LazyStats, read) => { heard.push(["reads", i, path, stats, read > 0]); },
    };
    let gauge = 1_000;
    const result = await executeUnit(runUnit(["table.beast2", "x.beast2"]), io, {
      platforms: noPackages,
      resident: () => (gauge += 10),
      peakBytes: () => 42n,
      report,
    });
    assert.ok(equalFor(UnitOutcomeType)(result.outcome, variant("ok", null)), printOutcome(result.outcome));
    assert.equal(decodeBeast2For(StringType)(io.read("out.beast2")), "row-123");
    assert.equal(result.peakBytes, 42n, "the peak is the host's gauge's");

    assert.deepEqual(heard, [
      ["running", "program.beast2", ["table.beast2", "x.beast2"]],
      ["lazily", 0],
      ["whole", 1, 10],
      ["reads", 0, "table.beast2", { segments, segmentsDecoded: 1, fencesProbed: segments, hydrated: false, hydratedBytes: 0 }, true],
    ], "the collection opened lazily, and its one keyed read decoded one segment; the Integer decoded whole, weighed by the gauge");
    assert.equal(inputTypes.length, 2);
    assert.ok(isTypeValueEqual(inputTypes[0]!, toEastTypeValue(DT)), "the table is read as its parameter's type");
    assert.ok(isTypeValueEqual(inputTypes[1]!, toEastTypeValue(IntegerType)), "the key is read as its parameter's type");
  });

  it("gives each lazily opened input's pager the decoded weight its host keeps", async () => {
    // Keyed reads that cycle over three segments far apart, so no run of reads
    // in key order forms: kept, each segment decodes once; at a budget of 1,
    // every read decodes its segment again.
    const program = East.function([DT], IntegerType, ($, table) => {
      const hits = $.let(0n);
      $.for(East.Array.range(0n, 30n), ($, i) => {
        $.if(table.has(i.remainder(3n).multiply(9_000n)), ($) => {
          $.assign(hits, hits.add(1n));
        });
      });
      return hits;
    });
    for (const [cacheBytes, decodes] of [[1, 30], [undefined, 3]] as const) {
      const io = new InMemoryUnitIO(staged(20_000, [["program.beast2", encodeEastIR(program.toIR())]]));
      let stats: Beast2LazyStats | undefined;
      const report: UnitRunReport = {
        running: () => {},
        openedLazily: () => {},
        decodedWhole: () => {},
        lazyReads: (_i, _path, read) => { stats = read; },
      };
      const result = await executeUnit(runUnit(["table.beast2"]), io, {
        platforms: noPackages,
        report,
        ...(cacheBytes !== undefined && { cacheBytes }),
      });
      assert.ok(equalFor(UnitOutcomeType)(result.outcome, variant("ok", null)), printOutcome(result.outcome));
      assert.equal(decodeBeast2For(IntegerType)(io.read("out.beast2")), 30n);
      assert.equal(stats?.segmentsDecoded, decodes, `at a budget of ${cacheBytes ?? "256 MiB"}`);
    }
  });

  it("measures nothing its host gives it no gauge for", async () => {
    const io = new InMemoryUnitIO([["program.beast2", encodeEastIR(East.function([], IntegerType, (_$) => 1n).toIR())]]);
    const result = await executeUnit(runUnit([]), io, { platforms: noPackages });
    assert.ok(equalFor(UnitOutcomeType)(result.outcome, variant("ok", null)), printOutcome(result.outcome));
    assert.equal(result.peakBytes, 0n, "a host that does not measure memory reports no peak");
    for (const phase of ["load", "compile", "execute", "output"] as const) assert.ok(result.timings[phase] >= 0, phase);
  });

  it("asks its IO for each segment a unit reads, saying whether the unit's host places them as they are read", async () => {
    const program = East.function([DT], StringType, ($, table) => table.get(9_999n));
    const files = staged(20_000, [["program.beast2", encodeEastIR(program.toIR())]]);
    const segments = decodeCollectionManifest(files.get("table.beast2")!).entries.map((entry) => `table.beast2.segments/${entry.hash}.beast2`);
    assert.ok(segments.length > 2, `several segments, got ${segments.length}`);

    // Lazily, one keyed read reads one segment.
    const lazy = new AskedIO(files);
    const fetched = await executeUnit(runUnit(["table.beast2"], { fetch: true }), lazy, { platforms: noPackages });
    assert.ok(equalFor(UnitOutcomeType)(fetched.outcome, variant("ok", null)), printOutcome(fetched.outcome));
    assert.equal(lazy.asked.length, 1, `one segment asked for: ${JSON.stringify(lazy.asked)}`);
    assert.ok(segments.includes(lazy.asked[0]![0]) && lazy.asked[0]![1], "a segment the manifest names, asked of a host that places them");

    // Decoded whole, every segment is read, and the unit's host places none.
    const whole = new AskedIO(files);
    const decoded = await executeUnit(runUnit(["table.beast2"], { decode: "whole" }), whole, { platforms: noPackages });
    assert.ok(equalFor(UnitOutcomeType)(decoded.outcome, variant("ok", null)), printOutcome(decoded.outcome));
    assert.deepEqual(whole.asked, segments.map((path) => [path, false]));
  });

  it("refuses an output directory that holds anything already", async () => {
    const io = new InMemoryUnitIO([["out/stale.beast2", new Uint8Array([1])]]);
    const unit: Unit = {
      work: variant("merge", { parts: ["part.beast2"], range: none, output: variant("set", "out") }),
      platforms: [],
      threads: 1n,
      fetch: false,
      result: "result.beast2",
    };
    const result = await executeUnit(unit, io, { platforms: noPackages });
    assert.ok(equalFor(UnitOutcomeType)(result.outcome, variant("failed", { message: "exec: the output directory out is not empty", locations: [] })),
      printOutcome(result.outcome));
    assert.deepEqual([...io.files.keys()], ["out/stale.beast2"], "nothing is written");
  });
});
