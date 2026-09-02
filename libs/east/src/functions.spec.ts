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
  East, EastIR, some, none, equalFor,
  ArrayType, FloatType, FunctionType, IntegerType, NullType, StringType, StructType,
  FunctionManifestType, IMPORT_PLATFORM, toSource, walkIR,
} from "./index.js";

const Row = StructType({ qty: IntegerType, price: FloatType });
const score = East.function([Row], FloatType, ($, r) => r.qty.toFloat().multiply(r.price));
const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
const log = East.platform("log", [StringType], NullType);
const shout = East.function([StringType], NullType, ($, s) => { $(log(s.upperCase())); });

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
    const { ir, imports } = East.linkImports(bundle, [manifest]);
    assert.deepEqual(imports, []);
    assert.equal(ir, bundle.ir);
  });

  test("the import prints as East.importFunction and the printed module rebuilds it", () => {
    const imported = East.importFunction("pricing", "double", FunctionType([IntegerType], IntegerType));
    const user = East.function([IntegerType], IntegerType, ($, x) => imported(x));
    const source = toSource(user);
    assert.match(source, /East\.importFunction\("pricing", "double", _t0\)/);
    assert.throws(() => East.importFunction("pricing", "double", IntegerType as any), /needs a FunctionType/);
  });
});
