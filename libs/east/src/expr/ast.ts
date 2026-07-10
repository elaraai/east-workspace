/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import type { AST } from "../ast.js";
import { get_current_source_map, get_location_id, type SourceMap } from "../location.js";
import { SortedMap } from "../containers/sortedmap.js";
import { SortedSet } from "../containers/sortedset.js";
import {
  ArrayType,
  BlobType,
  BooleanType,
  DateTimeType,
  DictType,
  type EastType,
  FloatType,
  IntegerType,
  isSubtype,
  MatrixType,
  NeverType,
  NullType,
  printType,
  RefType,
  SetType,
  StringType,
  StructType,
  TypeUnion,
  VariantType,
  VectorType
} from "../types.js";
import { isVariant, variant } from "../containers/variant.js";
import { typeMismatchError } from "../type_diff.js";
import { Expr, AstSymbol, SourceMapSymbol, TypeSymbol } from "./expr.js";
import { isRef } from "../containers/ref.js";
import { isMatrix } from "../containers/matrix.js";

/**
 * Convert a value or expression directly to AST without creating intermediate expressions
 */
export function valueOrExprToAst(value: any): AST {
  if (value instanceof Expr) {
    return value[AstSymbol];
  } else if (value === null) {
    return { ast_type: "Value", type: NullType, value, loc_id: get_location_id() };
  } else if (typeof value === "boolean") {
    return { ast_type: "Value", type: BooleanType, value, loc_id: get_location_id() };
  } else if (typeof value === "bigint") {
    return { ast_type: "Value", type: IntegerType, value, loc_id: get_location_id() };
  } else if (typeof value === "number") {
    return { ast_type: "Value", type: FloatType, value, loc_id: get_location_id() };
  } else if (typeof value === "string") {
    return { ast_type: "Value", type: StringType, value, loc_id: get_location_id() };
  } else if (value instanceof Date) {
    return { ast_type: "Value", type: DateTimeType, value, loc_id: get_location_id() };
  } else if (value instanceof Float64Array) {
    const values = Array.from(value).map(v => ({ ast_type: "Value" as const, type: FloatType, value: v, loc_id: get_location_id() }));
    return { ast_type: "NewVector", type: VectorType(FloatType), values, loc_id: get_location_id() };
  } else if (value instanceof BigInt64Array) {
    const values: AST[] = [];
    for (let i = 0; i < value.length; i++) values.push({ ast_type: "Value", type: IntegerType, value: value[i]!, loc_id: get_location_id() });
    return { ast_type: "NewVector", type: VectorType(IntegerType), values, loc_id: get_location_id() };
  } else if (value instanceof Uint8ClampedArray) {
    const values: AST[] = [];
    for (let i = 0; i < value.length; i++) values.push({ ast_type: "Value", type: BooleanType, value: value[i]! !== 0, loc_id: get_location_id() });
    return { ast_type: "NewVector", type: VectorType(BooleanType), values, loc_id: get_location_id() };
  } else if (value instanceof Uint8Array) {
    return { ast_type: "Value", type: BlobType, value, loc_id: get_location_id() };
  } else if (isMatrix(value)) {
    const m = value as any;
    let elementType: EastType;
    if (m.data instanceof Float64Array) elementType = FloatType;
    else if (m.data instanceof BigInt64Array) elementType = IntegerType;
    else elementType = BooleanType;
    const values: AST[] = [];
    for (let i = 0; i < m.data.length; i++) {
      if (elementType.type === "Boolean") {
        values.push({ ast_type: "Value", type: BooleanType, value: m.data[i] !== 0, loc_id: get_location_id() });
      } else {
        values.push({ ast_type: "Value", type: elementType, value: m.data[i], loc_id: get_location_id() });
      }
    }
    return { ast_type: "NewMatrix", type: MatrixType(elementType), values, rows: m.rows, cols: m.cols, loc_id: get_location_id() };
  } else if (typeof value === "function") {
    throw new Error(`Unable to convert function to AST without knowing it's type`);
  } else if (isRef(value)) {
    const val_ast = valueOrExprToAst(value.value);
    return {
      ast_type: "NewRef",
      type: RefType(val_ast.type),
      value: val_ast,
      loc_id: get_location_id()
    };
  } else if (Array.isArray(value)) {
    const values = value.map(x => valueOrExprToAst(x));
    let value_type = values.length > 0 ? values[0]!.type : NeverType;
    for (const [i, ast] of values.entries()) {
      if (ast.type.type === "Never") {
        throw new Error(`Unable to convert array to Array expression: value at index ${i} has type .Never`);
      }
      value_type = TypeUnion(value_type, ast.type);
    }
    return { ast_type: "NewArray", type: ArrayType(value_type), values, loc_id: get_location_id() };
  } else if (value instanceof Set || value instanceof SortedSet) {
    const values = [...value].map(x => valueOrExprToAst(x));
    let value_type = values.length > 0 ? values[0]!.type : NeverType;
    for (const [i, ast] of values.entries()) {
      if (ast.type.type === "Never") {
        throw new Error(`Unable to convert set to Set expression: key at index ${i} has type .Never`);
      }
      value_type = TypeUnion(value_type, ast.type);
    }
    return { ast_type: "NewSet", type: SetType(value_type), values, loc_id: get_location_id() };
  } else if (value instanceof Map || value instanceof SortedMap) {
    const values: [AST, AST][] = [...value].map(([k, v]) => [valueOrExprToAst(k), valueOrExprToAst(v)]);
    let key_type = values.length > 0 ? values[0]![0].type : NeverType;
    let value_type = values.length > 0 ? values[0]![1].type : NeverType;
    for (const [i, [k, v]] of values.entries()) {
      if (k.type.type === "Never") {
        throw new Error(`Unable to convert dict to Dict expression: key at index ${i} has type .Never`);
      }
      key_type = TypeUnion(key_type, k.type);
      if (v.type.type === "Never") {
        throw new Error(`Unable to convert dict to Dict expression: value at index ${i} has type .Never`);
      }
      value_type = TypeUnion(value_type, v.type);
    }
    return { ast_type: "NewDict", type: DictType(key_type, value_type), values, loc_id: get_location_id() };
  } else if (isVariant(value)) {
    const name = value.type;
    const val = value.value;
    const val_ast = valueOrExprToAst(val);
    if (val_ast.type.type === "Never") {
      throw new Error(`Unable to convert variant to Variant expression: case ${name} has type .Never`);
    }
    const case_types = { [name]: val_ast.type };
    return { ast_type: "Variant", type: VariantType(case_types), case: name, value: val_ast, loc_id: get_location_id() };
  } else if (typeof value === "object" && Object.getPrototypeOf(value) === Object.getPrototypeOf({})) {
    const fields = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, valueOrExprToAst(v)]));
    const field_types = Object.fromEntries(Object.entries(fields).map(([k, ast]) => {
      if (ast.type.type === "Never") {
        throw new Error(`Unable to convert object to Struct expression: field ${k} has type .Never`);
      }
      return [k, ast.type];
    }));
    return { ast_type: "Struct", type: StructType(field_types), fields, loc_id: get_location_id() };
  } else {
    throw new Error(`Unable to convert value ${value} to AST`);
  }
}

/**
 * Rewrite every loc_id in an AST subtree from one source map into another.
 *
 * A function expression built with no ambient source map interns its
 * locations into its own private map (`ensure_source_map`); embedding that
 * subtree under a different (ambient) map would leave loc_ids resolving
 * against the wrong map — misleading or empty locations at error time.
 * Nodes are copied, not mutated, so the original expression stays
 * consistent with its own map. `type` fields (EastTypes) and Value-node
 * payloads (data, which may legitimately contain a `loc_id` struct field)
 * are passed through untouched.
 */
function remapAstLocations(node: any, from: SourceMap, to: SourceMap, seen: Map<object, any> = new Map()): any {
  if (Array.isArray(node)) {
    const cached = seen.get(node);
    if (cached !== undefined) return cached;
    const copy: any[] = [];
    seen.set(node, copy);
    for (const item of node) copy.push(remapAstLocations(item, from, to, seen));
    return copy;
  }
  if (node === null || typeof node !== "object" || isVariant(node)) {
    return node;
  }
  // AST aliasing is identity-based (a Variable node in `parameters` IS the
  // node referenced from the body), so copies must be memoized: the same
  // input node always maps to the same output node.
  const cached = seen.get(node);
  if (cached !== undefined) return cached;
  const isValueNode = node.ast_type === "Value";
  const out: any = {};
  seen.set(node, out);
  for (const [key, item] of Object.entries(node)) {
    // `type`/`type_parameters` hold EastTypes (identity- and
    // symbol-stamped — never copy) and a Value node's `value` is data
    if (key === "type" || key === "type_parameters" || (isValueNode && key === "value")) {
      out[key] = item;
    } else if (key === "loc_id" && typeof item === "bigint") {
      out[key] = to.intern_stack([...from.resolve(item)]);
    } else if (item !== null && typeof item === "object" && !isVariant(item)) {
      out[key] = remapAstLocations(item, from, to, seen);
    } else {
      out[key] = item;
    }
  }
  return out;
}

/**
 * Extract an expression's AST for embedding under the current source map.
 *
 * When the expression was built under its own private source map (it was
 * constructed with no ambient map active — e.g. a bare lambda coerced by a
 * top-level `East.value`) and a different map is active now, its locations
 * are re-interned into the active map so they survive serialization. The
 * private map is read from the expression or from the AST node itself (the
 * coercion branches annotate the node, since wrappers like `East.value`
 * rebuild the expression and would drop an expression-level annotation).
 * With no map active yet, the annotation is preserved for a later embed.
 */
export function astUnderCurrentSourceMap(expr: any): AST {
  const ast = expr[AstSymbol] as AST;
  const own = (expr[SourceMapSymbol] ?? (ast as any)[SourceMapSymbol]) as SourceMap | undefined;
  const ambient = get_current_source_map();
  if (own && ambient && own !== ambient) {
    return remapAstLocations(ast, own, ambient);
  }
  return ast;
}

/**
 * Annotate an AST node with the private source map its loc_ids belong to,
 * so a later embedding under a real map can re-intern them.
 */
function carrySourceMap(ast: AST, own: SourceMap | undefined | null): AST {
  const ambient = get_current_source_map();
  if (own && !ambient) {
    Object.defineProperty(ast, SourceMapSymbol, { enumerable: false, value: own });
  }
  return ast;
}

/**
 * Convert a value to AST with explicit type checking
 */
export function valueOrExprToAstTyped<T extends EastType>(value: any, type: T, visited?: Set<any>, loc_id = get_location_id()): AST & { type: T } {
  if (value instanceof Expr) {
    const valueType = value[TypeSymbol];
    if (!isSubtype(valueType, type)) {
      throw typeMismatchError(valueType, type, { loc_id });
    }
    return astUnderCurrentSourceMap(value) as AST & { type: T };
  }

  // For primitive values, validate type matches and create AST
  if (type.type === "Null") {
    if (value !== null) {
      throw new Error(`Expected null but got ${value}`);
    }
    return { ast_type: "Value", type, value, loc_id };
  } else if (type.type === "Boolean") {
    if (typeof value !== "boolean") {
      console.log(value)
      throw new Error(`Expected boolean but got ${value === null ? "null" : typeof value}`);
    }
    return { ast_type: "Value", type, value, loc_id };
  } else if (type.type === "Integer") {
    if (typeof value !== "bigint") {
      throw new Error(`Expected bigint but got ${value === null ? "null" : typeof value}`);
    }
    return { ast_type: "Value", type, value, loc_id };
  } else if (type.type === "Float") {
    if (typeof value !== "number") {
      throw new Error(`Expected number but got ${value === null ? "null" : typeof value}`);
    }
    return { ast_type: "Value", type, value, loc_id };
  } else if (type.type === "String") {
    if (typeof value !== "string") {
      throw new Error(`Expected string but got ${value === null ? "null" : typeof value}`);
    }
    return { ast_type: "Value", type, value, loc_id };
  } else if (type.type === "DateTime") {
    if (!(value instanceof Date)) {
      throw new Error(`Expected Date but got ${value === null ? "null" : typeof value}`);
    }
    return { ast_type: "Value", type, value, loc_id };
  } else if (type.type === "Blob") {
    if (!(value instanceof Uint8Array)) {
      throw new Error(`Expected Uint8Array but got ${value === null ? "null" : typeof value}`);
    }
    return { ast_type: "Value", type, value, loc_id };
  } else if (type.type === "Ref") {
    if (!isRef(value)) {
      throw new Error(`Expected ref but got ${value === null ? "null" : typeof value}`);
    }

    const val_ast = valueOrExprToAstTyped(value.value, type.value, visited, loc_id);
    if (!isSubtype(val_ast.type, type.value)) {
      throw typeMismatchError(val_ast.type, type.value, { loc_id });
    }
    if (val_ast.type.type === "Never") {
      throw new Error(`Unable to convert value to Ref expression: value has type .Never`);
    }
    return {
      ast_type: "NewRef",
      type,
      value: val_ast,
      loc_id
    };
  } else if (type.type === "Array") {
    if (!Array.isArray(value)) {
      throw new Error(`Expected array but got ${value === null ? "null" : typeof value}`);
    }
    const values = value.map((x, i) => {
      const ast = valueOrExprToAstTyped(x, type.value, visited, loc_id);
      if (ast.type.type === "Never") {
        throw new Error(`Unable to convert array to Array expression: element at index ${i} has type .Never`);
      }
      return ast;
    });
    return { ast_type: "NewArray", type, values, loc_id };
  } else if (type.type === "Set") {
    if (!(value instanceof Set || value instanceof SortedSet)) {
      throw new Error(`Expected set but got ${value === null ? "null" : typeof value}`);
    }
    const values = [...value].map((x, i) => {
      const ast = valueOrExprToAstTyped(x, type.key, visited, loc_id);
      if (ast.type.type === "Never") {
        throw new Error(`Unable to convert set to Set expression: element at index ${i} has type .Never`);
      }
      return ast;
    });
    return { ast_type: "NewSet", type, values, loc_id };
  } else if (type.type === "Dict") {
    if (!(value instanceof Map || value instanceof SortedMap)) {
      throw new Error(`Expected dict but got ${value === null ? "null" : typeof value}`);
    }
    const values: [AST, AST][] = [...value].map(([k, v], i) => {
      const key_ast = valueOrExprToAstTyped(k, type.key, visited, loc_id);
      if (key_ast.type.type === "Never") {
        throw new Error(`Unable to convert dict to Dict expression: key at index ${i} has type .Never`);
      }

      const value_ast = valueOrExprToAstTyped(v, type.value, visited, loc_id);
      if (value_ast.type.type === "Never") {
        throw new Error(`Unable to convert dict to Dict expression: value at index ${i} has type .Never`);
      }

      return [key_ast, value_ast];
    });
    return { ast_type: "NewDict", type, values, loc_id };
  } else if (type.type === "Struct") {
    if (typeof value !== "object" || value === null) {
      throw new Error(`Expected object but got ${value === null ? "null" : typeof value}`);
    }
    const fields = Object.fromEntries(
      Object.entries(type.fields).map(([k, fieldType]) => {
        const ast = valueOrExprToAstTyped(value[k], fieldType, visited, loc_id);
        if (ast.type.type === "Never") {
          throw new Error(`Unable to convert object to Struct expression: field ${k} has type .Never`);
        }
        return [k, ast];
      })
    );
    return { ast_type: "Struct", type, fields, loc_id };
  } else if (type.type === "Variant") {
    if (!isVariant(value)) {
      throw new Error(`Expected variant but got ${value === null ? "null" : typeof value}`);
    }
    const name = (value as variant).type;
    const caseType = type.cases[name];
    if (!caseType) {
      throw new Error(`Variant case ${name} not found in type`);
    }

    const valueAst = valueOrExprToAstTyped((value as variant).value, caseType, visited, loc_id);
    if (!isSubtype(valueAst.type, caseType)) {
      throw typeMismatchError(valueAst.type, caseType, { loc_id });
    }
    if (valueAst.type.type === "Never") {
      throw new Error(`Unable to convert variant to Variant expression: case ${name} has type .Never`);
    }

    return { ast_type: "Variant", type, case: name, value: valueAst, loc_id };
  } else if (type.type === "Recursive") {
    // Check if we're already processing this value -> circular reference (error)
    if (visited) {
      const existing = visited.has(value);
      if (existing) {
        throw new Error(`Circular reference detected when converting value to AST`);
      }
    } else {
      visited = new Set();
    }

    // Register before recursing (enables cycle detection)
    visited.add(value);

    // Process the value with the node type
    const node = valueOrExprToAstTyped(value, type.node, visited, loc_id);

    visited.delete(value);

    // Wrap in WrapRecursive so fromAst returns a RecursiveExpr
    return { ast_type: "WrapRecursive", type, value: node, loc_id };
  } else if (type.type === "Function") {
    if (typeof value !== "function") {
      throw new Error(`Expected function but got ${value === null ? "null" : typeof value}`);
    }

    // Coerce the bare lambda into a real East function, re-homing its
    // locations under the active source map and stamping the coercion
    // site's loc_id like every sibling branch (issue #204). With no map
    // active (e.g. a top-level East.value), the function's private map is
    // carried on the node so a later embed can re-intern it.
    const fnExpr = Expr.function(type.inputs, type.output, value) as any;
    return carrySourceMap({ ...astUnderCurrentSourceMap(fnExpr), loc_id }, fnExpr[SourceMapSymbol]) as any;
  } else if (type.type === "AsyncFunction") {
    if (typeof value !== "function") {
      throw new Error(`Expected function but got ${value === null ? "null" : typeof value}`);
    }

    const fnExpr = Expr.asyncFunction(type.inputs, type.output, value) as any;
    return carrySourceMap({ ...astUnderCurrentSourceMap(fnExpr), loc_id }, fnExpr[SourceMapSymbol]) as any;
  } else if (type.type === "Vector") {
    const elemType = type.element;
    if (value instanceof Float64Array || value instanceof BigInt64Array || value instanceof Uint8ClampedArray || value instanceof Uint8Array) {
      const values: AST[] = [];
      for (let i = 0; i < value.length; i++) {
        if (elemType.type === "Boolean") {
          values.push({ ast_type: "Value", type: elemType, value: (value as Uint8Array)[i]! !== 0, loc_id });
        } else {
          values.push({ ast_type: "Value", type: elemType, value: value[i]!, loc_id });
        }
      }
      return { ast_type: "NewVector", type, values, loc_id } as any;
    }
    throw new Error(`Expected TypedArray for Vector type but got ${typeof value}`);
  } else if (type.type === "Matrix") {
    if (isMatrix(value)) {
      const m = value as any;
      const elemType = type.element;
      const values: AST[] = [];
      for (let i = 0; i < m.data.length; i++) {
        if (elemType.type === "Boolean") {
          values.push({ ast_type: "Value", type: elemType, value: m.data[i] !== 0, loc_id });
        } else {
          values.push({ ast_type: "Value", type: elemType, value: m.data[i], loc_id });
        }
      }
      return { ast_type: "NewMatrix", type, values, rows: m.rows, cols: m.cols, loc_id } as any;
    }
    throw new Error(`Expected matrix for Matrix type but got ${typeof value}`);
  } else {
    throw new Error(`Type conversion not implemented for ${printType(type)}`);
  }
}
