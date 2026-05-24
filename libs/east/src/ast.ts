/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { type BuiltinName } from "./builtins.js";
import type { EastType, NeverType, NullType } from "./types.js";

// This is the TypeScript-native, typed AST (abstract syntax tree) for East.
// At this stage variable resolution has not been completed and nodes may need to be compared by object identity to understand the code.
// The AST must be checked and transformed to IR before it can be serialized or compiled.

// TODO: all fields that are `AST` should be `any` to remove circular typing (type-erased to make TypeScript fast)

/** @internal */
export type ErrorAST = {
  ast_type: "Error",
  type: NeverType,
  loc_id: bigint,
  message: AST,
}

/** @internal */
export type TryCatchAST = {
  ast_type: "TryCatch",
  type: EastType,
  loc_id: bigint,
  try_body: AST,
  catch_body: AST,
  message: VariableAST,
  stack: VariableAST,
  finally_body?: AST,
}

/** @internal */
export type ValueAST = {
  ast_type: "Value",
  type: EastType,
  loc_id: bigint,
  value: null | boolean | bigint | number | string | Date | Uint8Array,
};

/** @internal */
export type AsAST = {
  ast_type: "As",
  type: EastType,
  loc_id: bigint,
  value: AST,
};

/** @internal */
export type VariableAST = {
  ast_type: "Variable",
  type: EastType,
  loc_id: bigint,
  mutable: boolean,
};

/** @internal */
export type LetAST = {
  ast_type: "Let",
  type: EastType,
  loc_id: bigint,
  variable: VariableAST,
  value: AST,
};

/** @internal */
export type AssignAST = {
  ast_type: "Assign",
  type: EastType,
  loc_id: bigint,
  variable: VariableAST,
  value: AST,
};

/** @internal */
export type FunctionAST = {
  ast_type: "Function",
  type: EastType,
  loc_id: bigint,
  parameters: VariableAST[],
  body: AST,
};

/** @internal */
export type AsyncFunctionAST = {
  ast_type: "AsyncFunction",
  type: EastType,
  loc_id: bigint,
  parameters: VariableAST[],
  body: AST,
};


/** @internal */
export type CallAST = {
  ast_type: "Call",
  type: EastType,
  loc_id: bigint,
  function: AST,
  arguments: AST[],
};

/** @internal */
export type CallAsyncAST = {
  ast_type: "CallAsync",
  type: EastType,
  loc_id: bigint,
  function: AST,
  arguments: AST[],
};

/** @internal */
export type NewRefAST = {
  ast_type: "NewRef",
  type: EastType,
  loc_id: bigint,
  value: AST,
};

/** @internal */
export type NewArrayAST = {
  ast_type: "NewArray",
  type: EastType,
  loc_id: bigint,
  values: AST[],
};

/** @internal */
export type NewSetAST = {
  ast_type: "NewSet",
  type: EastType,
  loc_id: bigint,
  values: AST[],
};

/** @internal */
export type NewDictAST = {
  ast_type: "NewDict",
  type: EastType,
  loc_id: bigint,
  values: [AST, AST][],
};

/** @internal */
export type StructAST = {
  ast_type: "Struct",
  type: EastType,
  loc_id: bigint,
  fields: Record<string, AST>,
};

/** @internal */
export type GetFieldAST = {
  ast_type: "GetField",
  type: EastType,
  loc_id: bigint,
  field: string,
  struct: AST,
};

/** @internal */
export type VariantAST = {
  ast_type: "Variant",
  type: EastType,
  loc_id: bigint,
  case: string,
  value: AST,
};

/** @internal */
export type BlockAST = {
  ast_type: "Block",
  type: EastType,
  loc_id: bigint,
  statements: AST[],
}

/** @internal */
export type IfElseAST = {
  ast_type: "IfElse",
  type: EastType,
  loc_id: bigint,
  ifs: {
    predicate: AST,
    body: AST,
  }[],
  else_body: AST,
};

/** @internal */
export type MatchAST = {
  ast_type: "Match",
  type: EastType,
  loc_id: bigint,
  variant: AST,
  cases: Record<string, { variable: VariableAST, body: AST }>,
};

export type UnwrapRecursiveAST = {
  ast_type: "UnwrapRecursive",
  type: EastType,
  loc_id: bigint,
  value: AST,
};

/** @internal */
export type WrapRecursiveAST = {
  ast_type: "WrapRecursive",
  type: EastType,
  loc_id: bigint,
  value: AST,
};

/** @internal */
export type Label = {
  loc_id: bigint,
}

/** @internal */
export type WhileAST = {
  ast_type: "While",
  type: NullType,
  loc_id: bigint,
  predicate: AST,
  label: Label,
  body: AST,
};

/** @internal */
export type ForArrayAST = {
  ast_type: "ForArray",
  type: NullType,
  loc_id: bigint,
  array: AST,
  label: Label,
  key: VariableAST,
  value: VariableAST,
  body: AST,
};

/** @internal */
export type ForSetAST = {
  ast_type: "ForSet",
  type: NullType,
  loc_id: bigint,
  set: AST,
  label: Label,
  key: VariableAST,
  body: AST,
};

/** @internal */
export type ForDictAST = {
  ast_type: "ForDict",
  type: NullType,
  loc_id: bigint,
  dict: AST,
  label: Label,
  key: VariableAST,
  value: VariableAST,
  body: AST,
};

/** @internal */
export type ReturnAST = {
  ast_type: "Return",
  type: NeverType,
  loc_id: bigint,
  value: AST,
};

/** @internal */
export type ContinueAST = {
  ast_type: "Continue",
  type: NeverType,
  loc_id: bigint,
  label: Label,
};

/** @internal */
export type BreakAST = {
  ast_type: "Break",
  type: NeverType,
  loc_id: bigint,
  label: Label,
};

/**@internal */
export type BuiltinAST = {
  ast_type: "Builtin",
  type: EastType,
  loc_id: bigint,
  builtin: BuiltinName,
  type_parameters: EastType[],
  arguments: AST[],
};

/** @internal */
export type PlatformAST = {
  ast_type: "Platform",
  type: EastType,
  loc_id: bigint,
  name: string,
  type_parameters: EastType[],
  arguments: AST[],
  async: boolean,
  /** When true, compilation succeeds even if the platform function is not provided.
   * A runtime error will be thrown if the function is called without an implementation. */
  optional: boolean,
};

/** @internal */
export type NewVectorAST = {
  ast_type: "NewVector",
  type: EastType,
  loc_id: bigint,
  values: AST[],
};

/** @internal */
export type NewMatrixAST = {
  ast_type: "NewMatrix",
  type: EastType,
  loc_id: bigint,
  values: AST[],
  rows: number,
  cols: number,
};

/** @internal */
export type AST = ErrorAST | TryCatchAST | ValueAST | AsAST | VariableAST | LetAST | AssignAST | FunctionAST | AsyncFunctionAST | CallAST | CallAsyncAST | NewRefAST | NewArrayAST | NewSetAST | NewDictAST | NewVectorAST | NewMatrixAST | StructAST | GetFieldAST | VariantAST | BlockAST | IfElseAST | MatchAST | UnwrapRecursiveAST | WrapRecursiveAST | WhileAST | ForArrayAST | ForSetAST | ForDictAST | ReturnAST | ContinueAST | BreakAST | BuiltinAST | PlatformAST;
