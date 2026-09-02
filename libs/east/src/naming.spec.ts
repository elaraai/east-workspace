/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Authoring names in the IR (#639): a body's parameter names and the
 * `$.let` / `$.const` binding names reach the IR's variables, unique per
 * build, and come back out of `East.toSource`. Python twin:
 * `libs/east-py/packages/east-py/tests/test_authoring_names.py`.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { East, ArrayType, FloatType, IntegerType, StringType, VariantType, variant } from "./index.js";
import { bindingNameAt, parameterNames } from "./naming.js";

/** Every distinct `Variable` name in the IR, in first-seen order. */
function variableNames(ir: unknown): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
    } else if (node !== null && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (rec.type === "Variable" && rec.value !== null && typeof rec.value === "object") {
        const name = (rec.value as Record<string, unknown>).name;
        if (typeof name === "string" && !names.includes(name)) names.push(name);
      }
      for (const child of Object.values(rec)) walk(child);
    }
  };
  walk(ir);
  return names;
}

describe("parameterNames", () => {
  test("reads arrows, functions, a bare parameter, defaults and async", () => {
    assert.deepEqual(parameterNames(($: unknown, items: unknown, threshold: unknown) => [$, items, threshold]), ["$", "items", "threshold"]);
    assert.deepEqual(parameterNames(function ($: unknown, a: unknown) { return [$, a]; }), ["$", "a"]);
    assert.deepEqual(parameterNames((x: unknown) => x), ["x"]);
    assert.deepEqual(parameterNames(($: unknown, a = 1) => [$, a]), ["$", "a"]);
    assert.deepEqual(parameterNames(async ($: unknown, a: unknown) => [$, a]), ["$", "a"]);
    assert.deepEqual(parameterNames(() => 0), []);
  });

  test("a destructured parameter names no slot; nothing past a rest parameter", () => {
    assert.deepEqual(parameterNames(($: unknown, { a }: { a: number }, b: unknown) => [$, a, b]), ["$", "", "b"]);
    assert.deepEqual(parameterNames(($: unknown, ...rest: unknown[]) => [$, rest]), ["$"]);
  });

  test("gives up on what has no readable source", () => {
    assert.equal(parameterNames(Math.max), null);
    assert.equal(parameterNames((($: unknown, a: unknown) => [$, a]).bind(null)), null);
    assert.equal(parameterNames(null), null);
    assert.equal(parameterNames("($, a) => a"), null);
  });
});

describe("bindingNameAt", () => {
  const dir = mkdtempSync(join(tmpdir(), "east-naming-"));
  const file = join(dir, "body.ts");
  writeFileSync(file, [
    "const total = $.let(0n);",
    "$.let(1n);",
    "const wide =",
    "    $.let(2n);",
    "const a = $.let(1n), b = $.let(2n);",
    "let count: bigint = $.let(3n);",
    "const outer = $.let(f($.const(1n)));",
    "const chained = $.let(0n).add(1n);",
    "let later; later = $.let(4n);",
    "const split = $",
    "    .let(5n);",
  ].join("\n"));
  const at = (line: number, column: number) => bindingNameAt([{ filename: file, line: BigInt(line), column: BigInt(column) }]);

  test("names the binding on the calling line, at the callee or its property", () => {
    assert.equal(at(1, 17), "total");   // `let`, where V8 points
    assert.equal(at(1, 15), "total");   // `$`, where a source map may
    assert.equal(at(6, 23), "count");
  });

  test("a bare statement binds nothing", () => {
    assert.equal(at(2, 1), null);
  });

  test("a call indented under `const x =` takes the name above", () => {
    assert.equal(at(4, 7), "wide");
  });

  test("two bindings on one line resolve by column", () => {
    assert.equal(at(5, 13), "a");
    assert.equal(at(5, 28), "b");
  });

  test("only the call that is the initializer names the variable", () => {
    assert.equal(at(7, 17), "outer");   // `$.let(` — the `let` token, where V8 points
    assert.equal(at(7, 25), null);      // `$.const(` inside the arguments
    assert.equal(at(8, 19), null);      // `$.let(0n).add(1n)` binds the sum
    assert.equal(at(9, 22), "later");   // an assignment, not a declaration
    assert.equal(at(11, 6), "split");   // the callee split over two lines
  });

  test("a file:// location, a missing file and no frames", () => {
    assert.equal(bindingNameAt([{ filename: pathToFileURL(file).href, line: 1n, column: 17n }]), "total");
    assert.equal(bindingNameAt([{ filename: join(dir, "missing.ts"), line: 1n, column: 17n }]), null);
    assert.equal(bindingNameAt([]), null);
  });
});

describe("IR variables carry the authoring names", () => {
  const Shape = VariantType({ circle: FloatType, square: FloatType });
  const fn = East.function([ArrayType(IntegerType), StringType], StringType, ($, items, label) => {
    const total = $.let(0n);
    $.for(items, ($, item, index) => {
      $.assign(total, total.add(item.multiply(index)));
    });
    const doubled = $.const(items.map(($, x) => x.multiply(2n)).reduce(($, acc, x) => acc.add(x), 0n));
    const shape = $.const(variant("circle", 2.0), Shape);
    const area = $.const(shape.match({
      circle: ($, radius) => radius.multiply(radius),
      square: ($, side) => side.multiply(side),
    }));
    return label.concat(East.print(total)).concat(East.print(doubled)).concat(East.print(area));
  });
  const names = variableNames(fn.toIR().ir);

  test("parameters, bindings, loop and callback variables, match arms", () => {
    for (const expected of ["items", "label", "total", "item", "index", "doubled", "x", "acc", "area", "radius", "side"]) {
      assert.ok(names.includes(expected), `${expected} in ${names.join(", ")}`);
    }
  });

  test("a collision takes a suffix; a slot the body did not name stays _N", () => {
    assert.ok(names.includes("x_2"), `x_2 in ${names.join(", ")}`);
    assert.ok(names.some(n => /^_\d+$/.test(n)), `an unnamed slot in ${names.join(", ")}`);
    assert.ok(!names.includes("$"));
  });

  test("the names come back out of East.toSource", () => {
    const source = East.toSource(fn);
    assert.match(source, /const total = \$\.let\(0n\)/);
    assert.match(source, /\$\.for\(items, \(\$, item, index/);
    assert.match(source, /circle: \(\$, radius\) => radius\.multiply\(radius\)/);
    assert.match(source, /reduce\(\(\$, acc, x_2/);
  });

  test("names start afresh for every build", () => {
    const again = East.function([IntegerType], IntegerType, ($, x) => $.const(x.add(1n)));
    assert.deepEqual(variableNames(again.toIR().ir).filter(n => n === "x"), ["x"]);
    assert.deepEqual(variableNames(fn.toIR().ir), names);
  });
});
