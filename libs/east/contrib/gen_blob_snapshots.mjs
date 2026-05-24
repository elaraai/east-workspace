// Script to regenerate blob.beast2.spec.ts snapshot bytes.
// Run from libs/east/: node contrib/gen_blob_snapshots.mjs

import { East, IntegerType, FloatType, StringType, BooleanType, ArrayType, SetType, DictType, StructType, VariantType, FunctionType, NullType, BlobType, DateTimeType, RecursiveType, RefType, VectorType, MatrixType, variant, some, none, ref } from "../dist/src/index.js";
import { encodeBeast2For } from "../dist/src/serialization/beast2/index.js";
import { setLocationBasePath } from "../dist/src/location.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

setLocationBasePath(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));

function fmt(bytes) {
  const a = Array.from(bytes);
  const rows = [];
  for (let i = 0; i < a.length; i += 20)
    rows.push("      " + a.slice(i, i+20).join(",") + ",");
  return rows.join("\n").replace(/,$/, "");
}

function encode(type, value) {
  return encodeBeast2For(type)(value);
}

// ── Test: Simple function (no captures) ──────────────────────────────────────
{
  const FnType = FunctionType([IntegerType], IntegerType);
  const fn = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
  const bytes = encode(FnType, fn.toIR());
  console.log("=== Beast v2 - Simple function (no captures) ===");
  console.log(fmt(bytes));
}

// ── Test: Function with capture ───────────────────────────────────────────────
{
  const FnType = FunctionType([], IntegerType);
  const captured = East.value(42n, IntegerType);
  const fn = East.function([], IntegerType, ($) => captured);
  const bytes = encode(FnType, fn.toIR());
  console.log("=== Beast v2 - Function with capture ===");
  console.log(fmt(bytes));
}

// ── Test: Function capturing array ────────────────────────────────────────────
{
  const FnType = FunctionType([], ArrayType(IntegerType));
  const arr = East.value([1n,2n,3n], ArrayType(IntegerType));
  const fn = East.function([], ArrayType(IntegerType), ($) => arr);
  const bytes = encode(FnType, fn.toIR());
  console.log("=== Beast v2 - Function capturing array ===");
  console.log(fmt(bytes));
}
