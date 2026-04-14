/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { BuiltinName } from "./builtins.js";
import type { variant } from "./containers/variant.js";
import type { EastTypeValue, LiteralValue } from "./type_of_type.js";
import type { Location } from "./location.js";
import { ArrayType, BooleanType, IntegerType, RecursiveType, StringType, StructType, VariantType } from "./types.js";
import { EastTypeType, LiteralValueType } from "./type_of_type.js";

// This is the intermediate representation (IR) for East.
// IR has been processed from IR and checked for type safety and variable resolution.
// The code is ready to be serialized and evaluated or compiled.
// It is written in a form such that it is a valid East value, and can be serialized with our standard value serialization.

////////////////////////////////////////////////////////////////////////////////////////////
// Location type

/** @deprecated Use Location from location.ts directly */
export type LocationValue = Location;

/**
 * Formats a single location as a human-readable string.
 */
export function printSingleLocationValue(location: LocationValue): string {
  return `${location.filename} ${location.line}:${location.column}`;
}

/**
 * Formats an array of locations as a stack trace string.
 */
export function printLocationValue(locations: LocationValue[]): string {
  if (locations.length === 0) return '<unknown>';
  const [first, ...rest] = locations;
  const header = printSingleLocationValue(first!);
  if (rest.length === 0) return header;
  return header + '\n' + rest.map(loc => `  at ${printSingleLocationValue(loc)}`).join('\n');
}

////////////////////////////////////////////////////////////////////////////////////////////
// IR node types

// Note: all fields that are "any" are other IR nodes (type-erased to make TypeScript fast)

export type ErrorIR = variant<"Error", {
  type: variant<"Never", null>,
  loc_id: bigint,
  message: any, // IR
}>;

export type TryCatchIR = variant<"TryCatch", {
  type: EastTypeValue,
  loc_id: bigint,
  try_body: any, // IR
  catch_body: any, // IR
  message: VariableIR,
  stack: VariableIR,
  finally_body: any, // IR
}>;

export type ValueIR = variant<"Value", {
  type: EastTypeValue,
  loc_id: bigint,
  value: LiteralValue,
}>;

export type VariableIR = variant<"Variable", {
  type: EastTypeValue,
  name: string,
  loc_id: bigint,
  mutable: boolean,
  captured: boolean,
}>;

export type LetIR = variant<"Let", {
  type: EastTypeValue,
  loc_id: bigint,
  variable: VariableIR,
  value: any, // IR
}>;

export type AssignIR = variant<"Assign", {
  type: EastTypeValue,
  loc_id: bigint,
  variable: VariableIR,
  value: any, // IR
}>;

export type AsIR = variant<"As", {
  type: EastTypeValue,
  value: any, // IR
  loc_id: bigint,
}>

export type FunctionIR = variant<"Function", {
  type: EastTypeValue,
  loc_id: bigint,
  captures: VariableIR[],
  parameters: VariableIR[],
  body: any, // IR
}>;

export type AsyncFunctionIR = variant<"AsyncFunction", {
  type: EastTypeValue,
  loc_id: bigint,
  captures: VariableIR[],
  parameters: VariableIR[],
  body: any, // IR
}>;

export type CallIR = variant<"Call", {
  type: EastTypeValue,
  loc_id: bigint,
  function: any, // IR
  arguments: any[], // IR[]
}>;

export type CallAsyncIR = variant<"CallAsync", {
  type: EastTypeValue,
  loc_id: bigint,
  function: any, // IR
  arguments: any[], // IR[]
}>;


export type NewRefIR = variant<"NewRef", {
  type: EastTypeValue,
  loc_id: bigint,
  value: any, // IR
}>;

export type NewArrayIR = variant<"NewArray", {
  type: EastTypeValue,
  loc_id: bigint,
  values: any[], // IR[]
}>;

export type NewSetIR = variant<"NewSet", {
  type: EastTypeValue,
  loc_id: bigint,
  values: any[], // IR[]
}>;

export type NewDictIR = variant<"NewDict", {
  type: EastTypeValue,
  loc_id: bigint,
  values: { key: any, value: any }[], // { key: IR , value: IR }[]
}>;

export type StructIR = variant<"Struct", {
  type: EastTypeValue,
  loc_id: bigint,
  fields: { name: string, value: any }[], // { name: string, value: IR }[]
}>;

export type GetFieldIR = variant<"GetField", {
  type: EastTypeValue,
  loc_id: bigint,
  field: string,
  struct: any, // IR
}>;

export type VariantIR = variant<"Variant", {
  type: EastTypeValue,
  loc_id: bigint,
  case: string,
  value: any, // IR
}>;

export type BlockIR = variant<"Block", {
  type: EastTypeValue,
  loc_id: bigint,
  statements: any[], // IR[]
}>;

export type IfElseIR = variant<"IfElse", {
  type: EastTypeValue,
  loc_id: bigint,
  ifs: {
    predicate: any, // IR
    body: any, // IR
  }[],
  else_body: any, // IR

}>;

export type MatchIR = variant<"Match", {
  type: EastTypeValue,
  loc_id: bigint,
  variant: any, // IR
  cases: { case: string, variable: VariableIR, body: any }[], // { case: string, variable: VariableIR, body: IR }[]
}>;

export type UnwrapRecursiveIR = variant<"UnwrapRecursive", {
  type: EastTypeValue,
  loc_id: bigint,
  value: any, // IR
}>;

export type WrapRecursiveIR = variant<"WrapRecursive", {
  type: EastTypeValue,
  loc_id: bigint,
  value: any, // IR
}>;

export type IRLabel = {
  name: string,
  loc_id: bigint,
};

export type WhileIR = variant<"While", {
  type: variant<"Null", null>,
  loc_id: bigint,
  predicate: any, // IR
  label: IRLabel,
  body: any, // IR
}>;

export type ForArrayIR = variant<"ForArray", {
  type: variant<"Null", null>,
  loc_id: bigint,
  array: any, // IR
  label: IRLabel,
  key: VariableIR,
  value: VariableIR,
  body: any, // IR
}>;

export type ForSetIR = variant<"ForSet", {
  type: variant<"Null", null>,
  loc_id: bigint,
  set: any, // IR
  label: IRLabel,
  key: VariableIR,
  body: any, // IR
}>;

export type ForDictIR = variant<"ForDict", {
  type: variant<"Null", null>,
  loc_id: bigint,
  dict: any, // IR
  label: IRLabel,
  key: VariableIR,
  value: VariableIR,
  body: any, // IR
}>;

export type ReturnIR = variant<"Return", {
  type: variant<"Never", null>,
  loc_id: bigint,
  value: any, // IR
}>;

export type ContinueIR = variant<"Continue", {
  type: variant<"Never", null>,
  loc_id: bigint,
  label: IRLabel,
}>;

export type BreakIR = variant<"Break", {
  type: variant<"Never", null>,
  loc_id: bigint,
  label: IRLabel,
}>;

/**@internal */
export type BuiltinIR = variant<"Builtin", {
  type: EastTypeValue,
  loc_id: bigint,
  builtin: BuiltinName,
  type_parameters: EastTypeValue[],
  arguments: any[], // IR[]
}>;

export type PlatformIR = variant<"Platform", {
  type: EastTypeValue,
  loc_id: bigint,
  name: string,
  type_parameters: EastTypeValue[],
  arguments: any[], // IR[]
  async: boolean,
  /** When true, compilation succeeds even if the platform function is not provided.
   * A runtime error will be thrown if the function is called without an implementation. */
  optional: boolean,
}>;

/** The common intermediate representation (IR) for East code.
 *
 * East IR is an expression-based tree of nodes.
 * It has been processed from AST and checked for type safety and variable resolution.
 * The code is ready to be serialized, evaluated or compiled.
 */
export type NewVectorIR = variant<"NewVector", {
  type: EastTypeValue,
  loc_id: bigint,
  values: any[], // IR[]
}>;

export type NewMatrixIR = variant<"NewMatrix", {
  type: EastTypeValue,
  loc_id: bigint,
  values: any[], // IR[]
  rows: bigint,
  cols: bigint,
}>;

export type IR = ErrorIR | TryCatchIR |ValueIR | VariableIR | LetIR | AssignIR | AsIR | FunctionIR | AsyncFunctionIR | CallIR | CallAsyncIR | NewRefIR | NewArrayIR | NewSetIR | NewDictIR | NewVectorIR | NewMatrixIR | StructIR | GetFieldIR | VariantIR | BlockIR | IfElseIR | MatchIR | UnwrapRecursiveIR | WrapRecursiveIR | WhileIR | ForArrayIR | ForSetIR | ForDictIR | ReturnIR | ContinueIR | BreakIR | BuiltinIR | PlatformIR;

////////////////////////////////////////////////////////////////////////////////////////////
// Homoiconic IR EastTypes

export const LocationType = StructType({
  filename: StringType,
  line: IntegerType,
  column: IntegerType,
});

export const IRLabelType = StructType({
  name: StringType,
  loc_id: IntegerType,
});

export const VariableType = StructType({
  type: EastTypeType,
  loc_id: IntegerType,
  name: StringType,
  mutable: BooleanType,
  captured: BooleanType,
});

export const IRType = RecursiveType(ir => VariantType({
  Error: StructType({ type: EastTypeType, loc_id: IntegerType, message: ir }),
  TryCatch: StructType({ type: EastTypeType, loc_id: IntegerType, try_body: ir, catch_body: ir, message: ir, stack: ir, finally_body: ir }),
  Value: StructType({ type: EastTypeType, loc_id: IntegerType, value: LiteralValueType }),
  Variable: VariableType,
  Let: StructType({ type: EastTypeType, loc_id: IntegerType, variable: ir, value: ir }),
  Assign: StructType({ type: EastTypeType, loc_id: IntegerType, variable: ir, value: ir }),
  As: StructType({ type: EastTypeType, loc_id: IntegerType, value: ir }),
  Function: StructType({ type: EastTypeType, loc_id: IntegerType, captures: ArrayType(ir), parameters: ArrayType(ir), body: ir }),
  AsyncFunction: StructType({ type: EastTypeType, loc_id: IntegerType, captures: ArrayType(ir), parameters: ArrayType(ir), body: ir }),
  Call: StructType({ type: EastTypeType, loc_id: IntegerType, function: ir, arguments: ArrayType(ir) }),
  CallAsync: StructType({ type: EastTypeType, loc_id: IntegerType, function: ir, arguments: ArrayType(ir) }),
  NewRef: StructType({ type: EastTypeType, loc_id: IntegerType, value: ir }),
  NewArray: StructType({ type: EastTypeType, loc_id: IntegerType, values: ArrayType(ir) }),
  NewSet: StructType({ type: EastTypeType, loc_id: IntegerType, values: ArrayType(ir) }),
  NewDict: StructType({ type: EastTypeType, loc_id: IntegerType, values: ArrayType(StructType({ key: ir, value: ir })) }),
  NewVector: StructType({ type: EastTypeType, loc_id: IntegerType, values: ArrayType(ir) }),
  NewMatrix: StructType({ type: EastTypeType, loc_id: IntegerType, values: ArrayType(ir), rows: IntegerType, cols: IntegerType }),
  Struct: StructType({ type: EastTypeType, loc_id: IntegerType, fields: ArrayType(StructType({ name: StringType, value: ir })) }),
  GetField: StructType({ type: EastTypeType, loc_id: IntegerType, field: StringType, struct: ir }),
  Variant: StructType({ type: EastTypeType, loc_id: IntegerType, case: StringType, value: ir }),
  Block: StructType({ type: EastTypeType, loc_id: IntegerType, statements: ArrayType(ir) }),
  IfElse: StructType({ type: EastTypeType, loc_id: IntegerType, ifs: ArrayType(StructType({ predicate: ir, body: ir })), else_body: ir }),
  Match: StructType({ type: EastTypeType, loc_id: IntegerType, variant: ir, cases: ArrayType(StructType({ case: StringType, variable: ir, body: ir })) }),
  UnwrapRecursive: StructType({ type: EastTypeType, loc_id: IntegerType, value: ir }),
  WrapRecursive: StructType({ type: EastTypeType, loc_id: IntegerType, value: ir }),
  While: StructType({ type: EastTypeType, loc_id: IntegerType, predicate: ir, label: IRLabelType, body: ir }),
  ForArray: StructType({ type: EastTypeType, loc_id: IntegerType, array: ir, label: IRLabelType, key: ir, value: ir, body: ir }),
  ForSet: StructType({ type: EastTypeType, loc_id: IntegerType, set: ir, label: IRLabelType, key: ir, body: ir }),
  ForDict: StructType({ type: EastTypeType, loc_id: IntegerType, dict: ir, label: IRLabelType, key: ir, value: ir, body: ir }),
  Return: StructType({ type: EastTypeType, loc_id: IntegerType, value: ir }),
  Continue: StructType({ type: EastTypeType, loc_id: IntegerType, label: IRLabelType }),
  Break: StructType({ type: EastTypeType, loc_id: IntegerType, label: IRLabelType }),
  Builtin: StructType({ type: EastTypeType, loc_id: IntegerType, builtin: StringType, type_parameters: ArrayType(EastTypeType), arguments: ArrayType(ir) }),
  Platform: StructType({ type: EastTypeType, loc_id: IntegerType, name: StringType, type_parameters: ArrayType(EastTypeType), arguments: ArrayType(ir), async: BooleanType, optional: BooleanType }),
}));