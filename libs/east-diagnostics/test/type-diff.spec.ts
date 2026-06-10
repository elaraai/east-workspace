/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, test } from "node:test";
import assert from "node:assert";
import * as ts from "typescript";
import { join } from "node:path";
import * as east from "@elaraai/east";
import { rewriteEastAssignability, ASSIGNABILITY_CODES, type EastModule } from "../src/index.js";

const eastModule = east as unknown as EastModule;

// Virtual fixture under the package dir so "@elaraai/east" resolves through
// the real workspace node_modules (same trick as harness.ts).
const FIXTURE = join(process.cwd(), "__east_type_diff_fixture__.ts");

interface Analysis {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  diagnostics: readonly ts.Diagnostic[];
}

function compile(source: string): Analysis {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    lib: ["lib.esnext.d.ts"],
  };
  const host = ts.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (name === FIXTURE) return ts.createSourceFile(name, source, languageVersion, true);
    return getSourceFile(name, languageVersion, onError, shouldCreate);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => name === FIXTURE || fileExists(name);
  const readFile = host.readFile.bind(host);
  host.readFile = (name) => (name === FIXTURE ? source : readFile(name));

  const program = ts.createProgram([FIXTURE], compilerOptions, host);
  const sourceFile = program.getSourceFile(FIXTURE);
  if (sourceFile === undefined) throw new Error("fixture source file not found");
  return { program, sourceFile, diagnostics: program.getSemanticDiagnostics(sourceFile) };
}

/** Rewrite every assignability diagnostic in the fixture; return the results. */
function rewriteAll(source: string): { native: string; rewritten: string | undefined }[] {
  const { program, sourceFile, diagnostics } = compile(source);
  const candidates = diagnostics.filter((d) => ASSIGNABILITY_CODES.has(d.code));
  assert.ok(candidates.length > 0, `expected an assignability diagnostic, got: ${diagnostics.map((d) => d.code).join(", ")}`);
  return candidates.map((d) => ({
    native: ts.flattenDiagnosticMessageText(d.messageText, " "),
    rewritten: rewriteEastAssignability(ts, program, sourceFile, d, eastModule),
  }));
}

describe("rewriteEastAssignability", () => {
  test("primitive mismatch inside a struct literal", () => {
    const results = rewriteAll(`
      import type { SubtypeExprOrValue, StructType, IntegerType, StringType } from "@elaraai/east";
      const x: SubtypeExprOrValue<StructType<{ a: IntegerType, b: StringType }>> = { a: 1.5, b: "ok" };
    `);
    const hit = results.find((r) => r.rewritten !== undefined);
    assert.ok(hit, `no rewrite produced; native: ${results.map((r) => r.native).join(" || ")}`);
    assert.match(hit.rewritten!, /East type mismatch/);
    assert.match(hit.rewritten!, /\.Integer/);
    assert.match(hit.rewritten!, /\.Float/);
  });

  test("deep mismatch in a large Expr type is localized and short", () => {
    const results = rewriteAll(`
      import type { Expr, StructType, IntegerType, FloatType, StringType, BooleanType, ArrayType, DictType } from "@elaraai/east";
      type Right = StructType<{
        id: StringType,
        name: StringType,
        enabled: BooleanType,
        tags: ArrayType<StringType>,
        scores: DictType<StringType, FloatType>,
        config: StructType<{ retries: IntegerType, timeout: FloatType }>,
      }>;
      type Wrong = StructType<{
        id: StringType,
        name: StringType,
        enabled: BooleanType,
        tags: ArrayType<StringType>,
        scores: DictType<StringType, FloatType>,
        config: StructType<{ retries: FloatType, timeout: FloatType }>,
      }>;
      declare const e: Expr<Wrong>;
      const x: Expr<Right> = e;
    `);
    const hit = results.find((r) => r.rewritten !== undefined);
    assert.ok(hit, `no rewrite produced; native: ${results.map((r) => r.native).join(" || ")}`);
    assert.match(hit.rewritten!, /\.config\.retries/);
    assert.match(hit.rewritten!, /\.Integer/);
    assert.match(hit.rewritten!, /\.Float/);
    // The whole point: the rewrite localizes instead of restating both types.
    assert.ok(hit.rewritten!.length < 200, `expected a short message, got ${hit.rewritten!.length} chars`);
    assert.ok(!hit.rewritten!.includes("scores"), "compatible fields must be pruned from the diff");
  });

  test("missing struct field", () => {
    const results = rewriteAll(`
      import type { SubtypeExprOrValue, StructType, IntegerType, StringType } from "@elaraai/east";
      const x: SubtypeExprOrValue<StructType<{ a: IntegerType, b: StringType }>> = { a: 1n };
    `);
    const hit = results.find((r) => r.rewritten !== undefined);
    assert.ok(hit, `no rewrite produced; native: ${results.map((r) => r.native).join(" || ")}`);
    assert.match(hit.rewritten!, /missing field "b"/);
  });

  test("recursive type mismatch reifies through the marker", () => {
    const results = rewriteAll(`
      import type { Expr, RecursiveType, RecursiveTypeMarker, StructType, IntegerType, FloatType, ArrayType } from "@elaraai/east";
      type IntTree = RecursiveType<StructType<{ value: IntegerType, kids: ArrayType<RecursiveTypeMarker> }>>;
      type FloatTree = RecursiveType<StructType<{ value: FloatType, kids: ArrayType<RecursiveTypeMarker> }>>;
      declare const e: Expr<FloatTree>;
      const x: Expr<IntTree> = e;
    `);
    const hit = results.find((r) => r.rewritten !== undefined);
    assert.ok(hit, `no rewrite produced; native: ${results.map((r) => r.native).join(" || ")}`);
    assert.match(hit.rewritten!, /\.value/);
    assert.match(hit.rewritten!, /\.Integer/);
    assert.match(hit.rewritten!, /\.Float/);
  });

  test("plain TypeScript mismatch in an East file is left alone", () => {
    const results = rewriteAll(`
      import type { Expr, IntegerType } from "@elaraai/east";
      declare const used: Expr<IntegerType>;
      void used;
      const s: string = 1;
    `);
    for (const r of results) {
      assert.strictEqual(r.rewritten, undefined, `plain TS error must not be rewritten: ${r.rewritten}`);
    }
  });

  test("variant case mismatch via the variant container", () => {
    const results = rewriteAll(`
      import type { SubtypeExprOrValue, VariantType, IntegerType, StringType } from "@elaraai/east";
      import { variant } from "@elaraai/east";
      const x: SubtypeExprOrValue<VariantType<{ ok: IntegerType, err: StringType }>> = variant("nope", 1n);
    `);
    const hit = results.find((r) => r.rewritten !== undefined);
    assert.ok(hit, `no rewrite produced; native: ${results.map((r) => r.native).join(" || ")}`);
    assert.match(hit.rewritten!, /unexpected variant case "nope"/);
  });
});
