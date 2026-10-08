/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Cross-language functions (#628): export a manifest, import by name,
 * link into self-contained IR, and run it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  East, EastIR, EastError, some, none, equalFor,
  ArrayType, FloatType, FunctionType, IntegerType, NullType, StringType, StructType,
  FunctionManifestType, IMPORT_PLATFORM, toSource, walkIR,
} from "./index.js";

const Row = StructType({ qty: IntegerType, price: FloatType });
const score = East.function([Row], FloatType, ($, r) => r.qty.toFloat().multiply(r.price));
const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
const log = East.platform("log", [StringType], NullType);
const shout = East.function([StringType], NullType, ($, s) => { $(log(s.upperCase())); });
// The line `pick` is written on, which an error inside it names wherever it is linked.
const pickLine = BigInt(/:(\d+):\d+\)?$/.exec(new Error().stack!.split("\n")[1]!)![1]!) + 1n;
const pick = East.function([ArrayType(IntegerType), IntegerType], IntegerType, ($, xs, i) => xs.get(i));

function countImports(ir: unknown): number {
  let n = 0;
  walkIR(ir as any, node => { if (node.type === "Platform" && node.value.name === IMPORT_PLATFORM) n += 1; });
  return n;
}

describe("functions: export", () => {
  test("a manifest carries each function's IR, declared type and platform dependencies, sorted by name", () => {
    const manifest = East.exportFunctions("pricing", "1.2.3", { score, double, shout }, { providers: { log: "@elaraai/east-node-std" } });
    assert.equal(manifest.package, "pricing");
    assert.equal(manifest.version, "1.2.3");
    assert.deepEqual(manifest.functions.map(f => f.name), ["double", "score", "shout"]);
    const [d, s, sh] = manifest.functions;
    assert.equal(d!.ir.type, "Function");
    assert.equal(s!.type.type, "Function");
    assert.deepEqual(d!.platforms, []);
    assert.equal(sh!.platforms.length, 1);
    assert.equal(sh!.platforms[0]!.name, "log");
    assert.equal(sh!.platforms[0]!.async, false);
    assert.deepEqual(sh!.platforms[0]!.provider, some("@elaraai/east-node-std"));
    assert.equal(sh!.platforms[0]!.inputs.length, 1);
  });

  test("the manifest round trips through beast2", () => {
    const manifest = East.exportFunctions("pricing", "1.0.0", { score, shout });
    const back = East.decodeFunctionManifest(East.encodeFunctionManifest(manifest));
    assert.ok(equalFor(FunctionManifestType)(back, manifest));
    assert.deepEqual(back.functions[1]!.platforms[0]!.provider, none);
  });

  test("a closure and an unlinked importer are refused", () => {
    const outer = East.function([IntegerType], IntegerType, ($, n) => {
      const k = $.const(n.add(1n));
      const inner = $.const(East.function([IntegerType], IntegerType, ($, x) => x.add(k)));
      return inner(n);
    });
    // the nested closure is not reachable as a value here; export the outer (closed) fine
    assert.doesNotThrow(() => East.exportFunctions("p", "1", { outer }));
    const imported = East.importFunction("pricing", "double", FunctionType([IntegerType], IntegerType));
    const user = East.function([IntegerType], IntegerType, ($, x) => imported(x));
    assert.throws(() => East.exportFunctions("p", "1", { user }), /unresolved import/);
  });

  test("each function carries the locations its IR names, in a source map of its own", () => {
    const manifest = East.exportFunctions("pricing", "1.0.0", { score, double });
    for (const f of manifest.functions) {
      assert.deepEqual(f.source_map[0], []);
      const named = new Set<bigint>();
      walkIR(f.ir as any, node => { if (node.value.loc_id > 0n) named.add(node.value.loc_id); });
      assert.ok(named.size > 0, `${f.name} names no location`);
      // every stack but the empty one is one the IR names, and each is here
      assert.equal(f.source_map.length, named.size + 1);
      for (const id of named) assert.match(f.source_map[Number(id)]![0]!.filename, /functions\.spec\.[jt]s$/);
    }
    // a bare IR value carries no map, so it exports with no locations
    const bare = East.exportFunctions("p", "1", { double: double.toIR().ir });
    assert.deepEqual(bare.functions[0]!.source_map, [[]]);
    walkIR(bare.functions[0]!.ir as any, node => assert.equal(node.value.loc_id, 0n));
  });
});

describe("functions: import and link", () => {
  const manifest = East.exportFunctions("pricing", "1.0.0", { score, double, shout }, { providers: { log: "@elaraai/east-node-std" } });

  test("an import is a callable expression whose IR is the east.importFunction platform node", () => {
    const imported = East.importFunction("pricing", "double", FunctionType([IntegerType], IntegerType));
    const user = East.function([IntegerType], IntegerType, ($, x) => imported(x).add(1n));
    assert.equal(countImports(user.toIR().ir), 1);
    assert.throws(() => East.compile(user, []), /east\.importFunction/);
  });

  test("linking embeds the exported IR and the program runs on the reference compiler", () => {
    const imported = East.importFunction("pricing", "double", FunctionType([IntegerType], IntegerType));
    const user = East.function([IntegerType], IntegerType, ($, x) => imported(x).add(1n));
    const { ir, imports } = East.linkImports(user, [manifest]);
    assert.equal(countImports(ir), 0);
    assert.deepEqual(imports.map(i => `${i.package}.${i.name}`), ["pricing.double"]);
    assert.equal(new EastIR(ir as any).compile([])(20n), 41n);
  });

  test("a use inside a callback captures the binding; several imports and repeated uses link once each", () => {
    const s = East.importFunction("pricing", "score", FunctionType([Row], FloatType));
    const d = East.importFunction("pricing", "double", FunctionType([IntegerType], IntegerType));
    const user = East.function([ArrayType(Row)], FloatType, ($, rows) => {
      const total = $.const(rows.map(($, r) => s(r)).sum());
      const n = $.const(d(d(rows.size())));
      return total.add(n.toFloat()).add(s(East.value({ qty: 1n, price: 0.5 }, Row)));
    });
    const { ir, imports } = East.linkImports(user, [manifest]);
    assert.deepEqual(imports.map(i => i.name), ["score", "double"]);
    const run = new EastIR(ir as any).compile([]);
    // (2*1.5 + 3*2.0) + 4*2 + 0.5
    assert.equal(run([{ qty: 2n, price: 1.5 }, { qty: 3n, price: 2.0 }]), 3 + 6 + 8 + 0.5);
    // the printed source rebuilds the linked program (no imports left)
    assert.doesNotMatch(toSource(ir), /importFunction/);
  });

  test("an import of a platform-calling function carries its dependencies and runs with the platform", () => {
    const sh = East.importFunction("pricing", "shout", FunctionType([StringType], NullType));
    const user = East.function([StringType], NullType, ($, s) => { $(sh(s)); });
    const { ir, imports } = East.linkImports(user, [manifest]);
    assert.equal(imports[0]!.platforms[0]!.name, "log");
    assert.deepEqual(imports[0]!.platforms[0]!.provider, some("@elaraai/east-node-std"));
    const seen: string[] = [];
    new EastIR(ir as any).compile([log.implement((s: string) => { seen.push(s); })])("hi");
    assert.deepEqual(seen, ["HI"]);
  });

  test("a missing manifest, a missing function and a type mismatch are build errors naming the import", () => {
    const wrongType = East.importFunction("pricing", "double", FunctionType([FloatType], FloatType));
    const user = East.function([FloatType], FloatType, ($, x) => wrongType(x));
    assert.throws(() => East.linkImports(user, []), /no function manifest for package "pricing"/);
    assert.throws(() => East.linkImports(user, [manifest]), /imported as .*Float.* but exported as .*Integer/);
    const missing = East.importFunction("pricing", "nope", FunctionType([IntegerType], IntegerType));
    const user2 = East.function([IntegerType], IntegerType, ($, x) => missing(x));
    assert.throws(() => East.linkImports(user2, [manifest]), /exports no function "nope" — it exports double, score, shout/);
  });

  test("a function without imports links to itself", () => {
    const bundle = double.toIR();
    const { ir, imports, sourceMap } = East.linkImports(bundle, [manifest]);
    assert.deepEqual(imports, []);
    assert.equal(ir, bundle.ir);
    assert.equal(sourceMap, bundle.source_map);
  });

  test("linking adds the embedded functions' locations to the importer's map, whose own keep their ids", () => {
    const imported = East.importFunction("pricing", "double", FunctionType([IntegerType], IntegerType));
    const user = East.function([IntegerType], IntegerType, ($, x) => imported(x).add(1n));
    const bundle = user.toIR();
    const { sourceMap } = East.linkImports(bundle, [manifest]);
    assert.ok(sourceMap !== null && bundle.source_map !== null);
    bundle.source_map.entries().forEach((stack, id) => assert.deepEqual(sourceMap.resolve(BigInt(id)), stack));
    assert.ok(sourceMap.size > bundle.source_map.size);
    // an IR value carries no map: the embedded functions carry no locations
    assert.equal(East.linkImports(bundle.ir, [manifest]).sourceMap, null);
  });

  test("an error inside an embedded function names the exporter's source", () => {
    const lists = East.exportFunctions("lists", "1.0.0", { pick });
    const imported = East.importFunction("lists", "pick", FunctionType([ArrayType(IntegerType), IntegerType], IntegerType));
    const user = East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => imported(xs, 5n));
    const { ir, sourceMap } = East.linkImports(user, [East.decodeFunctionManifest(East.encodeFunctionManifest(lists))]);
    const linked = new EastIR(ir as any);
    linked.source_map = sourceMap;
    const run = linked.compile([]);
    assert.throws(() => run([1n]), (e: unknown) => {
      assert.ok(e instanceof EastError);
      assert.match(e.location[0]!.filename, /functions\.spec\.[jt]s$/);
      assert.equal(e.location[0]!.line, pickLine);
      return true;
    });
  });

  test("the import prints as East.importFunction and the printed module rebuilds it", () => {
    const imported = East.importFunction("pricing", "double", FunctionType([IntegerType], IntegerType));
    const user = East.function([IntegerType], IntegerType, ($, x) => imported(x));
    const source = toSource(user);
    assert.match(source, /East\.importFunction\("pricing", "double", FunctionType\(\[IntegerType\], IntegerType\)\)/);
    assert.throws(() => East.importFunction("pricing", "double", IntegerType as any), /needs a FunctionType/);
  });
});
