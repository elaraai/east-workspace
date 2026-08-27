#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Export every `example()` in test/*.examples.ts as its own IR program, for
 * the cross-runtime codegen conformance suite (#627).
 *
 *   node scripts/export-examples-ir.mjs [outDir]      (default /tmp/east-examples-ir)
 *
 * Writes <outDir>/<suite>/<exportName>.json with the same `{ir, source_map}`
 * wrapper the test-IR export writes (east-c / east-py decode it as is), plus
 * the example's `inputs` and `returns` as type-directed JSON, its declared
 * input/output types, description and keywords — everything a runtime needs
 * to rebuild the function from printed source and check it computes the
 * example's answer. Requires `npm run build` first (imports dist/).
 */
import { mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";

const east = await import("../dist/src/index.js");
const { Expr, toJSONFor, toEastTypeValue, IRType, StructType, ArrayType, IntegerType, StringType } = east;

const outDir = process.argv[2] ?? "/tmp/east-examples-ir";
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const LocationType = StructType({ column: IntegerType, filename: StringType, line: IntegerType });
const SourceMapType = StructType({ stacks: ArrayType(ArrayType(LocationType)) });
const ExportWrapperType = StructType({ ir: IRType, source_map: SourceMapType });
const exportToJSON = toJSONFor(ExportWrapperType);

const testDir = new URL("../dist/test/", import.meta.url);
const files = readdirSync(testDir).filter(f => f.endsWith(".examples.js")).sort();
let count = 0;
for (const file of files) {
  const suite = basename(file, ".examples.js");
  const mod = await import(pathToFileURL(join(testDir.pathname, file)).href);
  const suiteDir = join(outDir, suite);
  mkdirSync(suiteDir, { recursive: true });
  for (const [name, ex] of Object.entries(mod)) {
    if (!ex || typeof ex !== "object" || !("fn" in ex) || !("inputs" in ex)) continue;
    const fnType = Expr.type(ex.fn);
    const ir = ex.fn.toIR();
    const stacks = (ir.source_map?.entries() ?? [[]]).map(
      stack => stack.map(frame => ({ column: frame.column, filename: frame.filename, line: frame.line })));
    const wrapper = exportToJSON({ ir: ir.ir, source_map: { stacks } });
    const inputs = ex.inputs.map((v, i) => (v instanceof Expr) ? null : toJSONFor(fnType.inputs[i])(v));
    const returns = ex.returns === undefined ? null
      : (ex.returns instanceof Expr ? null : toJSONFor(fnType.output)(ex.returns));
    const record = {
      suite, name,
      description: ex.description, keywords: ex.keywords,
      input_types: fnType.inputs.map(t => toEastTypeValue(t)),
      output_type: toEastTypeValue(fnType.output),
      inputs, returns,
      async: fnType.type === "AsyncFunction",
      ...wrapper,
    };
    writeFileSync(join(suiteDir, `${name}.json`),
      JSON.stringify(record, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    count++;
  }
}
console.log(`[+] Exported ${count} example programs to ${outDir}`);
