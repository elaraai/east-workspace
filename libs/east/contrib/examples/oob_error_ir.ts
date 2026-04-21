/**
 * Build a tiny East function that throws an out-of-bounds error,
 * encode to beast2 IR, write to disk. Used to compare error output
 * across east-c, east-node, east-py CLIs.
 */
import { East, ArrayType, IntegerType } from "../../src/index.js";
import { encodeBeast2For } from "../../src/serialization/beast2/index.js";
import { IRType } from "../../src/ir.js";
import { EAST_IR_SYMBOL, EAST_SOURCE_MAP_SYMBOL } from "../../src/compile.js";
import type { SourceMap } from "../../src/location.js";
import * as fs from "fs";

function writeIR(name: string, compiled: any) {
  const ir = compiled[EAST_IR_SYMBOL];
  const sourceMap = compiled[EAST_SOURCE_MAP_SYMBOL] as SourceMap | undefined;
  if (!ir) throw new Error(`No IR symbol on compiled ${name}`);
  const blob = encodeBeast2For(IRType, { sourceMap: sourceMap ?? null })(ir);
  fs.writeFileSync(`/tmp/${name}.beast2`, blob);
  console.log(`wrote /tmp/${name}.beast2 (${blob.length} bytes)`);
}

// Error path: out-of-bounds array access
writeIR("oob", East.compile(East.function([], IntegerType, ($) => {
  const arr = $.const([1n, 2n, 3n], ArrayType(IntegerType));
  return arr.get(10n);
}), []));

// Success path: adds two integers, takes one input
writeIR("ok", East.compile(East.function([IntegerType], IntegerType, ($, x) => {
  return x.add(42n);
}), []));

// Input file for the success IR (integer: 8 → output should be 50)
fs.writeFileSync("/tmp/ok_input.east", "8\n");
