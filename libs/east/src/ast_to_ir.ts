/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { AST, Label, VariableAST } from "./ast.js";
import type { IR, IRLabel, VariableIR } from "./ir.js";
import { toEastTypeValue, type LiteralValue } from "./type_of_type.js";
import { typeMismatchError } from "./type_diff.js";
import { ArrayType, DictType, type EastType, FunctionType, getTypeId, isSubtype, isTypeEqual, NeverType, NullType, printType, RefType, SetType, StructType, VariantType, VectorType, MatrixType } from "./types.js";
import { variant } from "./containers/variant.js";
import { applyTypeParameters, Builtins } from "./builtins.js";


/** @internal An exception throw for the purpose of early loop continue */
export class OutOfScopeException extends Error {
  constructor(public definedLocation: bigint) {
    super(`Variable defined at loc_id ${definedLocation} is out of scope here`);
  }
}

type Ctx = {
  local_ctx: Map<VariableAST, VariableIR>,
  parent_ctx: Map<VariableAST, VariableIR>,
  captures: Set<VariableIR>,
  loop_ctx: Map<Label, IRLabel>,
  recursiveASTs?: Set<any>,
  n_vars: number,
  n_loops: number,
  inputs: EastType[],
  output: EastType,
  async: boolean,
}


/**
 * Coerce an IR value from `source_type` to `target_type`. When both are
 * `StructType` or both are `VariantType` AND `value_ir` is the matching
 * literal shape (a `Struct` / `Variant` IR node), recursively rewrite each
 * child and rebuild the outer IR with the wider declared type — no outer
 * `As` wrapper. Otherwise (primitives, variable references, invariant
 * containers), emit a single outer `As`, matching legacy behaviour.
 *
 * Narrow→wide compound widening is only possible for Struct (covariant fields)
 * and Variant (subset + covariant cases). All mutable-container parameters
 * (Array/Set/Dict/Vector/Matrix/Ref) are invariant per isSubtypeImpl.
 *
 * @internal
 */
export function coerce_to(
  value_ir: IR,
  source_type: EastType,
  target_type: EastType,
  loc_id: bigint,
  visited?: Set<string>,
): IR {
  if (isTypeEqual(source_type, target_type)) return value_ir;

  if (!isSubtype(source_type, target_type)) {
    throw typeMismatchError(source_type, target_type, { loc_id });
  }

  const sid = getTypeId(source_type);
  const tid = getTypeId(target_type);
  const pair_key = `${sid ?? "?"}:${tid ?? "?"}`;
  if (visited !== undefined && visited.has(pair_key)) {
    return variant("As", {
      type: toEastTypeValue(target_type),
      value: value_ir,
      loc_id,
    });
  }
  const visited2 = visited ?? new Set<string>();
  visited2.add(pair_key);

  let s = source_type;
  let t = target_type;
  if (s.type === "Recursive") s = s.node;
  if (t.type === "Recursive") t = t.node;

  if (value_ir.type === "Struct" && s.type === "Struct" && t.type === "Struct") {
    const s_fields = s.fields;
    const t_fields = t.fields;
    const new_fields = value_ir.value.fields.map(({ name, value: field_ir }) => {
      const s_field = s_fields[name] as EastType | undefined;
      const t_field = t_fields[name] as EastType | undefined;
      if (s_field === undefined || t_field === undefined) {
        return { name, value: field_ir };
      }
      return { name, value: coerce_to(field_ir, s_field, t_field, loc_id, visited2) };
    });
    return variant("Struct", {
      type: toEastTypeValue(target_type),
      loc_id: value_ir.value.loc_id,
      fields: new_fields,
    });
  }

  if (value_ir.type === "Variant" && s.type === "Variant" && t.type === "Variant") {
    const case_name = value_ir.value.case;
    const s_case = s.cases[case_name] as EastType | undefined;
    const t_case = t.cases[case_name] as EastType | undefined;
    const inner = (s_case !== undefined && t_case !== undefined)
      ? coerce_to(value_ir.value.value, s_case, t_case, loc_id, visited2)
      : value_ir.value.value;
    return variant("Variant", {
      type: toEastTypeValue(target_type),
      loc_id: value_ir.value.loc_id,
      case: case_name,
      value: inner,
    });
  }

  return variant("As", {
    type: toEastTypeValue(target_type),
    value: value_ir,
    loc_id,
  });
}


/** Perform scope resolution and type checking on `AST`, produce `IR` ready for serialization, compilation or evaluation.
*
* @internal */
export function ast_to_ir(ast: AST, ctx: Ctx = { local_ctx: new Map(), parent_ctx: new Map(), captures: new Set(), loop_ctx: new Map(), n_vars: 0, n_loops: 0, inputs: [], output: NeverType, async: false }): IR {
  try {
    if (ast.ast_type === "Variable") {
      if (ctx.local_ctx.has(ast)) {
        return ctx.local_ctx.get(ast)!;
      } else {
        if (ctx.parent_ctx.has(ast)) {
          const ir = ctx.parent_ctx.get(ast)!;
          ir.value.captured = true;
          ctx.captures.add(ir);
          return ir;
        } else {
          throw new OutOfScopeException(ast.loc_id);
        }
      }
    } else if (ast.ast_type === "Let") {
      let value = ast_to_ir(ast.value, ctx);

      // Create a new variable
      const variable: VariableIR = variant("Variable", {
        type: toEastTypeValue(ast.variable.type),
        name: `_${ctx.n_vars}`,
        loc_id: ast.variable.loc_id,
        mutable: ast.variable.mutable,
        captured: false,
      });

      if (!isTypeEqual(ast.value.type, ast.variable.type)) {
        value = coerce_to(value, ast.value.type, ast.variable.type, ast.loc_id);
      }

      ctx.n_vars += 1;
      ctx.local_ctx.set(ast.variable, variable);

      return variant("Let", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        variable,
        value,
      });
    } else if (ast.ast_type === "Assign") {
      // Fetch the variable from context
      const variable = ast_to_ir(ast.variable, ctx) as VariableIR;

      if (!variable.value.mutable) {
        throw new Error(`Variable defined const at loc_id ${variable.value.loc_id} is being reassigned at loc_id ${ast.loc_id}`)
      }

      let value = ast_to_ir(ast.value, ctx);

      if (!isTypeEqual(ast.value.type, ast.variable.type)) {
        value = coerce_to(value, ast.value.type, ast.variable.type, ast.loc_id);
      }

      return variant("Assign", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        variable,
        value,
      });
    } else if (ast.ast_type === "Block") {
      const local_ctx = new Map([...ctx.local_ctx]);
      const ctx2: Ctx = { ...ctx, local_ctx };

      const statements = ast.statements.map(s => ast_to_ir(s, ctx2));
      ctx.n_vars = ctx2.n_vars;
      ctx.n_loops = ctx2.n_loops;

      return variant("Block", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        statements,
      });
    } else if (ast.ast_type === "Builtin") {
      // We need to apply the type parameters to the builtin, and cast the arguments as needed
      const builtin_name = ast.builtin;
      const builtin_def = Builtins[builtin_name];
      if (!builtin_def) {
        throw new Error(`Unknown builtin function '${builtin_name}' at loc_id ${ast.loc_id}`);
      }
      if (builtin_def.type_parameters.length !== ast.type_parameters.length) {
        throw new Error(`Builtin function '${builtin_name}' expected ${builtin_def.type_parameters.length} type parameters, got ${ast.type_parameters.length} at loc_id ${ast.loc_id}`);
      }
      const type_map = new Map(builtin_def.type_parameters.map((name, i) => [name, ast.type_parameters[i]!] as const));

      if (ast.arguments.length !== builtin_def.inputs.length) {
        throw new Error(`Builtin function '${builtin_name}' expected ${builtin_def.inputs.length} arguments, got ${ast.arguments.length} at loc_id ${ast.loc_id}`);
      }

      return variant("Builtin", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        builtin: ast.builtin,
        type_parameters: ast.type_parameters.map(tp => toEastTypeValue(tp)),
        arguments: ast.arguments.map((arg, i) => {
          let arg_ir = ast_to_ir(arg, ctx);
          const expectedType = applyTypeParameters(builtin_def.inputs[i]!, type_map, [], []);

          if (arg.type.type !== "Never" && !isTypeEqual(arg.type, expectedType)) {
            arg_ir = coerce_to(arg_ir, arg.type, expectedType, ast.loc_id);
          }

          return arg_ir;
        }),
      });
    } else if (ast.ast_type === "Platform") {
      if (ctx.async === false && ast.async === true) {
        throw new Error(`Async platform call not allowed outside async function at loc_id ${ast.loc_id}`);
      }

      return variant("Platform", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        name: ast.name,
        type_parameters: ast.type_parameters.map(tp => toEastTypeValue(tp)),
        arguments: ast.arguments.map(ast => ast_to_ir(ast, ctx)), // type equality handled at Expr/AST level
        async: ast.async,
        optional: ast.optional,
      });
    } else if (ast.ast_type === "Struct") {
      return variant("Struct", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        fields: Object.entries(ast.fields).map(([name, fieldAst]) => {
          let value = ast_to_ir(fieldAst, ctx);
          const expectedType = (ast.type as StructType).fields[name];
          if (!expectedType) {
            throw new Error(`Struct type does not have field '${name}' at loc_id ${ast.loc_id}`);
          }
          if (!isTypeEqual(fieldAst.type, expectedType)) {
            value = coerce_to(value, fieldAst.type, expectedType, ast.loc_id);
          }
          return { name, value };
        }),
      });
    } else if (ast.ast_type === "GetField") {
      return variant("GetField", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        struct: ast_to_ir(ast.struct, ctx),
        field: ast.field,
      });
    } else if (ast.ast_type === "Variant") {
      const expectedType = (ast.type as VariantType).cases[ast.case];
      let value = ast_to_ir(ast.value, ctx);
      if (!expectedType) {
        throw new Error(`Variant type does not have case '${ast.case}' at loc_id ${ast.loc_id}`);
      }
      if (!isTypeEqual(ast.value.type, expectedType)) {
        value = coerce_to(value, ast.value.type, expectedType, ast.loc_id);
      }
      return variant("Variant", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        case: ast.case,
        value,
      });
    } else if (ast.ast_type === "Function") {
      const parameters: VariableIR[] = ast.parameters.map(parameter => {
        const param: VariableIR = variant("Variable", {
          type: toEastTypeValue(parameter.type),
          name: `_${ctx.n_vars}`,
          loc_id: parameter.loc_id,
          mutable: parameter.mutable, // false...
          captured: false,
        });
        ctx.n_vars += 1;
        return param;
      });

      const local_ctx = new Map(parameters.map((parameter, i) => ([ast.parameters[i]!, parameter] as const)));
      const parent_ctx = new Map([...ctx.local_ctx, ...ctx.parent_ctx]);
      const captures = new Set<VariableIR>();
      const ctx2: Ctx = { local_ctx, parent_ctx, captures, loop_ctx: new Map(), n_vars: ctx.n_vars, n_loops: ctx.n_loops, inputs: (ast.type as FunctionType).inputs, output: (ast.type as FunctionType).output, async: false }

      const body = ast_to_ir(ast.body, ctx2);

      ctx.n_vars = ctx2.n_vars;
      ctx.n_loops = ctx2.n_loops;

      // Propagate captures: if this function captured something from ctx.parent_ctx,
      // then the enclosing function also needs to capture it
      for (const capturedVar of captures) {
        // Check if this variable came from our parent context (not defined locally in enclosing function)
        for (const [_astVar, ir] of ctx.parent_ctx) {
          if (ir === capturedVar) {
            // This capture came from an outer scope, so enclosing function must also capture it
            ctx.captures.add(capturedVar);
            break;
          }
        }
      }

      return variant("Function", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        parameters,
        captures: [...captures],
        body,
      });
    } else if (ast.ast_type === "AsyncFunction") {
      const parameters: VariableIR[] = ast.parameters.map(parameter => {
        const param: VariableIR = variant("Variable", {
          type: toEastTypeValue(parameter.type),
          name: `_${ctx.n_vars}`,
          loc_id: parameter.loc_id,
          mutable: parameter.mutable, // false...
          captured: false,
        });
        ctx.n_vars += 1;
        return param;
      });

      const local_ctx = new Map(parameters.map((parameter, i) => ([ast.parameters[i]!, parameter] as const)));
      const parent_ctx = new Map([...ctx.local_ctx, ...ctx.parent_ctx]);
      const captures = new Set<VariableIR>();
      const ctx2: Ctx = { local_ctx, parent_ctx, captures, loop_ctx: new Map(), n_vars: ctx.n_vars, n_loops: ctx.n_loops, inputs: (ast.type as FunctionType).inputs, output: (ast.type as FunctionType).output, async: true }

      const body = ast_to_ir(ast.body, ctx2);

      ctx.n_vars = ctx2.n_vars;
      ctx.n_loops = ctx2.n_loops;

      // Propagate captures: if this function captured something from ctx.parent_ctx,
      // then the enclosing function also needs to capture it
      for (const capturedVar of captures) {
        // Check if this variable came from our parent context (not defined locally in enclosing function)
        for (const [_astVar, ir] of ctx.parent_ctx) {
          if (ir === capturedVar) {
            // This capture came from an outer scope, so enclosing function must also capture it
            ctx.captures.add(capturedVar);
            break;
          }
        }
      }

      return variant("AsyncFunction", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        parameters,
        captures: [...captures],
        body,
      });
    } else if (ast.ast_type === "Call") {
      // TODO - type equality could have been handled at Expr/AST level instead
      // TODO - what about widening the result with As?
      return variant("Call", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        function: ast_to_ir(ast.function, ctx),
        arguments: ast.arguments.map((argument, i) => {
          let arg = ast_to_ir(argument, ctx);
          const expectedType = (ast.function.type as FunctionType).inputs[i];

          if (!isTypeEqual(argument.type, expectedType)) {
            arg = coerce_to(arg, argument.type, expectedType, ast.loc_id);
          }

          return arg;
        }),
      });
    } else if (ast.ast_type === "CallAsync") {
      if (ctx.async === false) {
        throw new Error(`Async function call not allowed outside async function at loc_id ${ast.loc_id}`);
      }

      // TODO - type equality could have been handled at Expr/AST level instead
      // TODO - what about widening the result with As?
      return variant("CallAsync", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        function: ast_to_ir(ast.function, ctx),
        arguments: ast.arguments.map((argument, i) => {
          let arg = ast_to_ir(argument, ctx);
          const expectedType = (ast.function.type as FunctionType).inputs[i];

          if (!isTypeEqual(argument.type, expectedType)) {
            arg = coerce_to(arg, argument.type, expectedType, ast.loc_id);
          }

          return arg;
        }),
      });
    } else if (ast.ast_type === "NewRef") {
      const valueType = (ast.type as RefType).value;
      let value = ast_to_ir(ast.value, ctx);
      if (!isTypeEqual(ast.value.type, valueType)) {
        value = coerce_to(value, ast.value.type, valueType, ast.loc_id);
      }

      return variant("NewRef", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        value,
      });
    } else if (ast.ast_type === "NewArray") {
      const valueType = (ast.type as ArrayType).value;
      return variant("NewArray", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        values: ast.values.map((v) => {
          let value = ast_to_ir(v, ctx);
          if (!isTypeEqual(v.type, valueType)) {
            value = coerce_to(value, v.type, valueType, ast.loc_id);
          }

          return value;
        }),
      });
    } else if (ast.ast_type === "NewSet") {
      const keyType = (ast.type as SetType).key;
      return variant("NewSet", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        values: ast.values.map((k) => {
          let key = ast_to_ir(k, ctx);
          if (!isTypeEqual(k.type, keyType)) {
            key = coerce_to(key, k.type, keyType, ast.loc_id);
          }

          return key;
        }),
      });
    } else if (ast.ast_type === "NewDict") {
      const keyType = (ast.type as DictType).key;
      const valueType = (ast.type as DictType).value;
      return variant("NewDict", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        values: ast.values.map(([k, v]) => {
          let key = ast_to_ir(k, ctx);
          if (!isTypeEqual(k.type, keyType)) {
            key = coerce_to(key, k.type, keyType, ast.loc_id);
          }

          let value = ast_to_ir(v, ctx);
          if (!isTypeEqual(v.type, valueType)) {
            value = coerce_to(value, v.type, valueType, ast.loc_id);
          };

          return { key, value };
        }),
      });
    } else if (ast.ast_type === "IfElse") {
      const ifs = ast.ifs.map(branch => {
        const predicate = ast_to_ir(branch.predicate, ctx);

        const ctx_branch: Ctx = {
          local_ctx: new Map([...ctx.local_ctx]),
          parent_ctx: ctx.parent_ctx,
          captures: ctx.captures,
          loop_ctx: ctx.loop_ctx,
          n_vars: ctx.n_vars,
          n_loops: ctx.n_loops,
          inputs: ctx.inputs,
          output: ctx.output,
          async: ctx.async,
        };
        let branch_body = ast_to_ir(branch.body, ctx_branch);
        ctx.n_vars = ctx_branch.n_vars;
        ctx.n_loops = ctx_branch.n_loops;

        if (branch.body.type.type !== "Never" && !isTypeEqual(branch.body.type, ast.type)) {
          branch_body = coerce_to(branch_body, branch.body.type, ast.type, ast.loc_id);
        }

        return { predicate, body: branch_body };
      });

      const ctx_else: Ctx = {
        local_ctx: new Map([...ctx.local_ctx]),
        parent_ctx: ctx.parent_ctx,
        captures: ctx.captures,
        loop_ctx: ctx.loop_ctx,
        n_vars: ctx.n_vars,
        n_loops: ctx.n_loops,
        inputs: ctx.inputs,
        output: ctx.output,
        async: ctx.async,
      };
      let else_body = ast_to_ir(ast.else_body, ctx_else);
      ctx.n_vars = ctx_else.n_vars;
      ctx.n_loops = ctx_else.n_loops;

      if (ast.else_body.type.type !== "Never" && !isTypeEqual(ast.else_body.type, ast.type)) {
        else_body = coerce_to(else_body, ast.else_body.type, ast.type, ast.loc_id);
      }

      return variant("IfElse", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        ifs,
        else_body,
      });
    } else if (ast.ast_type === "Error") {
      return variant("Error", {
        type: variant("Never", null),
        loc_id: ast.loc_id,
        message: ast_to_ir(ast.message, ctx),
      });
    } else if (ast.ast_type === "TryCatch") {
      const ctx_try: Ctx = {
        local_ctx: new Map([...ctx.local_ctx]),
        parent_ctx: ctx.parent_ctx,
        captures: ctx.captures,
        loop_ctx: ctx.loop_ctx,
        n_vars: ctx.n_vars,
        n_loops: ctx.n_loops,
        inputs: ctx.inputs,
        output: ctx.output,
        async: ctx.async,
      };
      const try_body = ast_to_ir(ast.try_body, ctx_try);
      ctx.n_vars = ctx_try.n_vars;
      ctx.n_loops = ctx_try.n_loops;

      // Create new variables for the catch message and stack
      const message: VariableIR = variant("Variable", {
        type: toEastTypeValue(ast.message.type),
        name: `_${ctx.n_vars}`,
        loc_id: ast.message.loc_id,
        mutable: ast.message.mutable, // false...
        captured: false,
      });
      ctx.n_vars += 1;

      const stack: VariableIR = variant("Variable", {
        type: toEastTypeValue(ast.stack.type),
        name: `_${ctx.n_vars}`,
        loc_id: ast.stack.loc_id,
        mutable: ast.stack.mutable, // false...
        captured: false,
      });
      ctx.n_vars += 1;
      const ctx_catch: Ctx = {
        local_ctx: new Map([...ctx.local_ctx, [ast.message, message], [ast.stack, stack]]),
        parent_ctx: ctx.parent_ctx,
        captures: ctx.captures,
        loop_ctx: ctx.loop_ctx,
        n_vars: ctx.n_vars,
        n_loops: ctx.n_loops,
        inputs: ctx.inputs,
        output: ctx.output,
        async: ctx.async,
      };
      const catch_body = ast_to_ir(ast.catch_body, ctx_catch);
      ctx.n_vars = ctx_catch.n_vars;
      ctx.n_loops = ctx_catch.n_loops;

      // Process finally block if present
      let finally_body: IR;
      if (ast.finally_body) {
        const ctx_finally: Ctx = {
          local_ctx: new Map([...ctx.local_ctx]),
          parent_ctx: ctx.parent_ctx,
          captures: ctx.captures,
          loop_ctx: ctx.loop_ctx,
          n_vars: ctx.n_vars,
          n_loops: ctx.n_loops,
          inputs: ctx.inputs,
          output: ctx.output,
          async: ctx.async,
        };
        finally_body = ast_to_ir(ast.finally_body, ctx_finally);
        ctx.n_vars = ctx_finally.n_vars;
        ctx.n_loops = ctx_finally.n_loops;
      } else {
        finally_body = variant("Value", {
          type: toEastTypeValue(NullType),
          loc_id: ast.loc_id,
          value: variant("Null", null),
        });
      }

      return variant("TryCatch", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        try_body,
        catch_body,
        message,
        stack,
        finally_body,
      });
    } else if (ast.ast_type === "Value") {
      const type = toEastTypeValue(ast.type);
      let value: LiteralValue;
      if (ast.value === null) {
        value = variant("Null", null);
      } else if (typeof ast.value === "boolean") {
        value = variant("Boolean", ast.value);
      } else if (typeof ast.value === "bigint") {
        value = variant("Integer", ast.value);
      } else if (typeof ast.value === "number") {
        value = variant("Float", ast.value);
      } else if (typeof ast.value === "string") {
        value = variant("String", ast.value);
      } else if (ast.value instanceof Date) {
        value = variant("DateTime", new Date(ast.value));
      } else if (ast.value instanceof Uint8Array) {
        value = variant("Blob", new Uint8Array(ast.value));
      } else {
        throw new Error(`Unsupported literal value type: ${typeof ast.value} (expected ${printType(ast.type)})`);
      }

      if (type.type !== value.type) {
        throw new Error(`Literal value type mismatch at loc_id ${ast.loc_id}: expected .${type.type} but got .${value.type}`);
      }

      return variant("Value", {
        type,
        loc_id: ast.loc_id,
        value,
      });
    } else if (ast.ast_type === "As") {
      // Explicit $.as: use coerce_to so nested narrow variants in a literal
      // struct/variant get deep-rewritten just like implicit widening.
      return coerce_to(ast_to_ir(ast.value, ctx), ast.value.type, ast.type, ast.loc_id);
    } else if (ast.ast_type === "While") {
      const predicate = ast_to_ir(ast.predicate, ctx);
      const label: IRLabel = {
        name: `_${ctx.n_loops}`,
        loc_id: ast.label.loc_id,
      }
      ctx.n_loops += 1;

      const ctx2: Ctx = {
        local_ctx: new Map([...ctx.local_ctx]),
        parent_ctx: ctx.parent_ctx,
        captures: ctx.captures,
        loop_ctx: new Map([...ctx.loop_ctx, [ast.label, label]]),
        n_vars: ctx.n_vars,
        n_loops: ctx.n_loops,
        inputs: ctx.inputs,
        output: ctx.output,
        async: ctx.async,
      };
      const body = ast_to_ir(ast.body, ctx2);
      ctx.n_vars = ctx2.n_vars;
      ctx.n_loops = ctx2.n_loops;

      return variant("While", {
        type: variant("Null", null),
        loc_id: ast.loc_id,
        label,
        predicate,
        body,
      });
    } else if (ast.ast_type === "ForArray") {
      const array = ast_to_ir(ast.array, ctx);
      const label: IRLabel = {
        name: `_${ctx.n_loops}`,
        loc_id: ast.label.loc_id,
      }
      ctx.n_loops += 1;

      const value: VariableIR = variant("Variable", {
        type: toEastTypeValue(ast.value.type),
        name: `_${ctx.n_vars}`,
        loc_id: ast.value.loc_id,
        mutable: ast.value.mutable, // false...
        captured: false,
      });
      ctx.n_vars += 1;

      const key: VariableIR = variant("Variable", {
        type: toEastTypeValue(ast.key.type),
        name: `_${ctx.n_vars}`,
        loc_id: ast.key.loc_id,
        mutable: ast.key.mutable, // false...
        captured: false,
      });
      ctx.n_vars += 1;

      const ctx2: Ctx = {
        local_ctx: new Map([...ctx.local_ctx, [ast.value, value], [ast.key, key]]),
        parent_ctx: ctx.parent_ctx,
        captures: ctx.captures,
        loop_ctx: new Map([...ctx.loop_ctx, [ast.label, label]]),
        n_vars: ctx.n_vars,
        n_loops: ctx.n_loops,
        inputs: ctx.inputs,
        output: ctx.output,
        async: ctx.async,
      };
      const body = ast_to_ir(ast.body, ctx2);
      ctx.n_vars = ctx2.n_vars;
      ctx.n_loops = ctx2.n_loops;

      return variant("ForArray", {
        type: variant("Null", null),
        loc_id: ast.loc_id,
        label,
        key,
        value,
        array,
        body,
      });
    } else if (ast.ast_type === "ForSet") {
      const set = ast_to_ir(ast.set, ctx);
      const label: IRLabel = {
        name: `_${ctx.n_loops}`,
        loc_id: ast.label.loc_id,
      }
      ctx.n_loops += 1;

      const key: VariableIR = variant("Variable", {
        type: toEastTypeValue(ast.key.type),
        name: `_${ctx.n_vars}`,
        loc_id: ast.key.loc_id,
        mutable: ast.key.mutable, // false...
        captured: false,
      });
      ctx.n_vars += 1;

      const ctx2: Ctx = {
        local_ctx: new Map([...ctx.local_ctx, [ast.key, key]]),
        parent_ctx: ctx.parent_ctx,
        captures: ctx.captures,
        loop_ctx: new Map([...ctx.loop_ctx, [ast.label, label]]),
        n_vars: ctx.n_vars,
        n_loops: ctx.n_loops,
        inputs: ctx.inputs,
        output: ctx.output,
        async: ctx.async,
      };
      const body = ast_to_ir(ast.body, ctx2);
      ctx.n_vars = ctx2.n_vars;
      ctx.n_loops = ctx2.n_loops;

      return variant("ForSet", {
        type: variant("Null", null),
        loc_id: ast.loc_id,
        label,
        key,
        set,
        body,
      });
    } else if (ast.ast_type === "ForDict") {
      const dict = ast_to_ir(ast.dict, ctx);
      const label: IRLabel = {
        name: `_${ctx.n_loops}`,
        loc_id: ast.label.loc_id,
      }
      ctx.n_loops += 1;

      const value: VariableIR = variant("Variable", {
        type: toEastTypeValue(ast.value.type),
        name: `_${ctx.n_vars}`,
        loc_id: ast.value.loc_id,
        mutable: ast.value.mutable, // false...
        captured: false,
      });
      ctx.n_vars += 1;

      const key: VariableIR = variant("Variable", {
        type: toEastTypeValue(ast.key.type),
        name: `_${ctx.n_vars}`,
        loc_id: ast.key.loc_id,
        mutable: ast.key.mutable, // false...
        captured: false,
      });
      ctx.n_vars += 1;

      const ctx2: Ctx = {
        local_ctx: new Map([...ctx.local_ctx, [ast.value, value], [ast.key, key]]),
        parent_ctx: ctx.parent_ctx,
        captures: ctx.captures,
        loop_ctx: new Map([...ctx.loop_ctx, [ast.label, label]]),
        n_vars: ctx.n_vars,
        n_loops: ctx.n_loops,
        inputs: ctx.inputs,
        output: ctx.output,
        async: ctx.async,
      };
      const body = ast_to_ir(ast.body, ctx2);
      ctx.n_vars = ctx2.n_vars;
      ctx.n_loops = ctx2.n_loops;

      return variant("ForDict", {
        type: variant("Null", null),
        loc_id: ast.loc_id,
        label,
        key,
        value,
        dict,
        body,
      });
    } else if (ast.ast_type === "Match") {
      const variant_expr = ast_to_ir(ast.variant, ctx);

      const cases: { case: string, variable: VariableIR, body: IR }[] = [];
      for (const [k, v] of Object.entries(ast.cases)) {
        const variable: VariableIR = variant("Variable", {
          type: toEastTypeValue(v.variable.type),
          name: `_${ctx.n_vars}`,
          loc_id: v.variable.loc_id,
          mutable: v.variable.mutable, // false...
          captured: false,
        });
        ctx.n_vars += 1;

        const ctx2: Ctx = {
          local_ctx: new Map([...ctx.local_ctx, [v.variable, variable]]),
          parent_ctx: ctx.parent_ctx,
          captures: ctx.captures,
          loop_ctx: ctx.loop_ctx,
          n_vars: ctx.n_vars,
          n_loops: ctx.n_loops,
          inputs: ctx.inputs,
          output: ctx.output,
          async: ctx.async,
        };
        let body = ast_to_ir(v.body, ctx2);
        ctx.n_vars = ctx2.n_vars;
        ctx.n_loops = ctx2.n_loops;

        if (v.body.type.type !== "Never" && !isTypeEqual(v.body.type, ast.type)) {
          body = coerce_to(body, v.body.type, ast.type, ast.loc_id);
        }

        cases.push({ case: k, variable, body });
      }

      return variant("Match", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        variant: variant_expr,
        cases,
      });
    } else if (ast.ast_type === "UnwrapRecursive") {
      return variant("UnwrapRecursive", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        value: ast_to_ir(ast.value, ctx),
      });
    } else if (ast.ast_type === "WrapRecursive") {
      // Check if we're already converting this AST node -> circular reference
      if (!ctx.recursiveASTs) {
        ctx.recursiveASTs = new Set();
      }
      const existing = ctx.recursiveASTs.has(ast);
      if (existing) {
        throw new Error(`Circular reference detected when converting AST to IR at loc_id ${ast.loc_id}`);
      }

      // Register before recursing (enables cycle detection)
      ctx.recursiveASTs.add(ast);

      // Create WrapRecursive IR node with placeholder
      const wrapIR: any = variant("WrapRecursive", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        value: ast_to_ir(ast.value, ctx),
      });

      // The user may alias this AST value elsewhere in the tree, just not with a circular reference
      ctx.recursiveASTs.delete(ast);

      return wrapIR;
    } else if (ast.ast_type === "Break") {
      const label = ctx.loop_ctx.get(ast.label);
      if (label === undefined) {
        throw new Error(`Label defined at loc_id ${ast.label.loc_id} is not in scope at break at loc_id ${ast.loc_id}`)
      }

      return variant("Break", {
        type: variant("Never", null),
        loc_id: ast.loc_id,
        label,
      });
    } else if (ast.ast_type === "Continue") {
      const label = ctx.loop_ctx.get(ast.label);
      if (label === undefined) {
        throw new Error(`Label defined at loc_id ${ast.label.loc_id} is not in scope at continue at loc_id ${ast.loc_id}`)
      }

      return variant("Continue", {
        type: variant("Never", null),
        loc_id: ast.loc_id,
        label,
      });
    } else if (ast.ast_type === "Return") {
      if (!isSubtype(ast.value.type, ctx.output)) {
        throw typeMismatchError(ast.value.type, ctx.output, { loc_id: ast.loc_id });
      }

      return variant("Return", {
        type: variant("Never", null),
        loc_id: ast.loc_id,
        value: ast_to_ir(ast.value, ctx),
      });
    } else if (ast.ast_type === "NewVector") {
      const elementType = (ast.type as VectorType).element;
      return variant("NewVector", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        values: ast.values.map((v) => {
          let value = ast_to_ir(v, ctx);
          if (!isTypeEqual(v.type, elementType)) {
            value = coerce_to(value, v.type, elementType, ast.loc_id);
          }
          return value;
        }),
      });
    } else if (ast.ast_type === "NewMatrix") {
      const elementType = (ast.type as MatrixType).element;
      return variant("NewMatrix", {
        type: toEastTypeValue(ast.type),
        loc_id: ast.loc_id,
        rows: BigInt(ast.rows),
        cols: BigInt(ast.cols),
        values: ast.values.map((v) => {
          let value = ast_to_ir(v, ctx);
          if (!isTypeEqual(v.type, elementType)) {
            value = coerce_to(value, v.type, elementType, ast.loc_id);
          }
          return value;
        }),
      });
    } else {
      throw new Error(`Cannot check ${((ast satisfies never) as AST).type}`)
    }
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (ast.ast_type === "Builtin") {
        e.message += `\n    at ${ast.ast_type} ${ast.builtin} node located at loc_id ${ast.loc_id}`;
      } else if (ast.ast_type === "Platform") {
        e.message += `\n    at ${ast.ast_type} ${ast.name} node located at loc_id ${ast.loc_id}`;
      } else{
        e.message += `\n    at ${ast.ast_type} node located at loc_id ${ast.loc_id}`;
      }
    }
    throw e;
  }
}
