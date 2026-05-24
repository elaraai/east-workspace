/**
 * Build a tiny East function that throws an out-of-bounds error,
 * encode to beast2 IR, write to disk. Used to compare error output
 * across east-c, east-node, east-py CLIs.
 */
import { East, ArrayType, IntegerType, encodeEastIR } from "../../src/index.js";
import * as fs from "fs";

function writeIR(name: string, fn: any) {
  // encodeEastIR handles both IR and source_map — no manual threading needed.
  const blob = encodeEastIR(fn.toIR());
  fs.writeFileSync(`/tmp/${name}.beast2`, blob);
  console.log(`wrote /tmp/${name}.beast2 (${blob.length} bytes)`);
}

// Error path: out-of-bounds array access
writeIR("oob", East.function([], IntegerType, ($) => {
  const arr = $.const([1n, 2n, 3n], ArrayType(IntegerType));
  return arr.get(10n);
}));

// Success path: adds 42 to one integer input
writeIR("ok", East.function([IntegerType], IntegerType, ($, x) => {
  return x.add(42n);
}));

// Input file for the success IR (integer: 8 → output should be 50)
fs.writeFileSync("/tmp/ok_input.east", "8\n");
