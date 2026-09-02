/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The layout document algebra (#639): the fits-or-breaks rule, hard lines,
 * hugging, member chains — each pinned on a small document, so the
 * printers' layout rests on stated semantics rather than on their output.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  type Doc, bracket, callArgs, choice, flat, fn, group, hardline, hug, ifBreak, indent, join, line, render, softline,
  willBreak,
} from "./doc.js";

describe("codegen doc: the layout algebra", () => {
  test("a group is flat when it fits the remaining width and breaks otherwise", () => {
    const items = ["aaaa", "bbbb", "cccc"];
    assert.equal(render(bracket("[", items, "]"), 40), "[aaaa, bbbb, cccc]");
    assert.equal(render(bracket("[", items, "]"), 10), "[\n  aaaa,\n  bbbb,\n  cccc,\n]");
    // what follows the group on its line counts: the same list breaks when a tail no longer fits
    assert.equal(render([bracket("[", items, "]"), " + tail"], 20), "[\n  aaaa,\n  bbbb,\n  cccc,\n] + tail");
    assert.equal(render(bracket("{", ["a: 1"], "}", " "), 80), "{ a: 1 }");
    assert.equal(render(bracket("{", [], "}", " "), 80), "{}");
    assert.equal(flat(bracket("[", items, "]")), "[aaaa, bbbb, cccc]");
  });

  test("nested groups take their own turn: the outer breaks, an inner that fits stays flat", () => {
    const inner = bracket("[", ["1n", "2n"], "]");
    const outer = bracket("(", ["first", inner, "third"], ")");
    assert.equal(render(["f", outer], 14), "f(\n  first,\n  [1n, 2n],\n  third,\n)");
  });

  test("a hard line breaks every group around it, and a block body renders in break mode", () => {
    const body = group(["{", indent([hardline, bracket("(", ["a", "b"], ")")]), hardline, "}"]);
    assert.equal(render(["x = ", bracket("[", [body], "]")], 80), "x = [\n  {\n    (a, b)\n  },\n]");
    assert.ok(willBreak(body));
    assert.ok(!willBreak(bracket("[", ["a"], "]")));
  });

  test("a choice takes the first option that fits up to its first line break, else the last", () => {
    const block = fn(group(["() => {", indent([hardline, "body;"]), hardline, "}"]));
    // the hug: the head fits, so the block stays on the line and breaks inside
    assert.equal(render(["f", callArgs(["a", block])], 20), "f(a, () => {\n  body;\n})");
    // the head does not fit: every argument on its own line
    assert.equal(render(["f", callArgs(["a-long-argument", block])], 20), "f(\n  a-long-argument,\n  () => {\n    body;\n  },\n)");
    // a plain choice
    const c = choice("short", "a much longer fallback");
    assert.equal(render(c, 10), "short");
    assert.equal(render(["0123456789", c], 12), "0123456789a much longer fallback");
  });

  test("a hug never hides a block from the plain groups around the call: they break out", () => {
    const block = fn(group(["($, x) => {", indent([hardline, "body;"]), hardline, "}"]));
    const call = ["xs.map", callArgs([block])];
    assert.equal(render(["const y = $.const", callArgs([call]), ";"], 80),
      "const y = $.const(\n  xs.map(($, x) => {\n    body;\n  }),\n);");
    // the call itself hugs
    assert.equal(render(["return ", call, ";"], 80), "return xs.map(($, x) => {\n  body;\n});");
  });

  test("a sole literal argument is hugged; a trailing literal after other arguments is too", () => {
    const lit = hug(bracket("{", ["a: 1", "b: 2"], "}", " "));
    assert.equal(render(["f", callArgs([lit])], 12), "f({\n  a: 1,\n  b: 2,\n})");
    assert.equal(render(["f", callArgs(["x", lit])], 15), "f(x, {\n  a: 1,\n  b: 2,\n})");
    // a trailing non-literal is not: the call breaks out, the literal then fitting its own line
    assert.equal(render(["f", callArgs([lit, "T"])], 19), "f(\n  { a: 1, b: 2 },\n  T,\n)");
  });

  test("a choice's fallback options never break the groups around it: a chain that fits stays on its line", () => {
    const chain = choice(["x", ".a()", ".b()", ".c()"], group(["x", indent([hardline, ".a()", hardline, ".b()", hardline, ".c()"])]));
    assert.equal(render(["const y = $.let", callArgs([chain]), ";"], 80), "const y = $.let(x.a().b().c());");
    assert.equal(render(["const y = $.let", callArgs([chain]), ";"], 20), "const y = $.let(\n  x.a().b().c(),\n);");
    assert.equal(render(["const y = $.let", callArgs([chain]), ";"], 12), "const y = $.let(\n  x\n    .a()\n    .b()\n    .c(),\n);");
    assert.ok(!willBreak(chain));
  });

  test("a hugged concise arrow that does not fit breaks after its arrow, the close on its own line; two trailing callbacks hug neither", () => {
    const concise = (names: string, body: Doc): Doc =>
      fn(group([`(${names}) =>`, indent([line, body])]), group([`(${names}) =>`, indent([line, body]), ifBreak(","), softline]));
    const long = "East.equal(_f1(v, k), 4n).ifElse(a, b)";
    assert.equal(render(["return a.firstMap", callArgs([concise("$, v, k", long)]), ";"], 40),
      "return a.firstMap(($, v, k) =>\n  East.equal(_f1(v, k), 4n).ifElse(a, b),\n);");
    assert.equal(render(["x.ifElse", callArgs([concise("$", "aaaaaaaaaaaaaaaa"), concise("$", "bbbbbbbbbbbbbbbb")]), ";"], 40),
      "x.ifElse(\n  ($) => aaaaaaaaaaaaaaaa,\n  ($) => bbbbbbbbbbbbbbbb,\n);");
  });

  test("a leading block before one short argument is hugged (reduce(fn, init))", () => {
    const block = fn(group(["($, acc, x) => {", indent([hardline, "body;"]), hardline, "}"]));
    assert.equal(render(["xs.reduce", callArgs([block, "0n"])], 80), "xs.reduce(($, acc, x) => {\n  body;\n}, 0n)");
  });

  test("lines: line is a space or a newline, softline nothing or a newline, and trailing spaces are trimmed", () => {
    const g = group(["a", line, "b", softline, "c"]);
    assert.equal(render(g, 80), "a bc");
    assert.equal(render(g, 2), "a\nb\nc");
    assert.equal(render(["x ", hardline, "y"], 80), "x\ny");
    assert.equal(render(indent(["a", hardline, "b"]), 80, "    "), "a\n    b");
    assert.equal(render(join(", ", ["1", "2", "3"]), 80), "1, 2, 3");
  });
});
