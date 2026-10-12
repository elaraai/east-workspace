/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which nodes of an IR await, worked out as the analysis works it out, without
 * the analysis's checks.
 *
 * The compiler reads each node's `isAsync`, which `analyzeIR` sets and
 * the IR's wire does not carry, so a function decoded from beast2 must have it
 * set again before its IR compiles (#1207). The analysis would set it, but it
 * also checks every node against its children's types, and over a UI
 * payload's types, `UIComponentType` among them, that made a decode ten to
 * forty times slower. The IR a decode reads was checked when its function was
 * built, so a decode needs only this. `test/analyze_async.spec.ts` holds the
 * two to the same answer at every node.
 *
 * @packageDocumentation
 */

import type { IR } from "./ir.js";

/**
 * Marks which nodes of an IR await: each node's `isAsync`, set in place, as
 * `analyzeIR` sets it on the nodes it returns.
 *
 * @remarks
 * A node awaits when a child it evaluates awaits, and a `CallAsync` always
 * does. A platform call awaits when the platform defines it as async; one the
 * platform does not define awaits only what its arguments do, as the
 * compiler's stub for it throws at once. Creating a function never awaits,
 * whatever its body does, and a `Call` awaits what its arguments do, as the
 * analysis has it. A node met twice, as an IR may share one, is marked once.
 *
 * @param ir - the IR, whose nodes are changed in place
 * @param asyncPlatformFns - the names of the platform's async functions
 * @returns whether `ir` itself awaits
 */
export function markAsync(ir: IR, asyncPlatformFns: ReadonlySet<string>): boolean {
  const mark = (node: IR): boolean => {
    const value = node.value as { isAsync?: boolean };
    if (value.isAsync !== undefined) return value.isAsync;
    const isAsync = awaits(node);
    value.isAsync = isAsync;
    return isAsync;
  };
  // Every node is marked: no `some`, which would stop at the first that awaits.
  const any = (nodes: readonly IR[]): boolean => {
    let isAsync = false;
    for (const node of nodes) {
      if (mark(node)) isAsync = true;
    }
    return isAsync;
  };
  const awaits = (node: IR): boolean => {
    switch (node.type) {
      case "Value":
      case "Variable":
      case "Continue":
      case "Break":
        return false;
      case "Let":
      case "Assign":
      case "As":
      case "NewRef":
      case "Variant":
      case "UnwrapRecursive":
      case "WrapRecursive":
      case "Return":
        return mark(node.value.value);
      case "Error":
        return mark(node.value.message);
      case "GetField":
        return mark(node.value.struct);
      case "Function":
      case "AsyncFunction":
        mark(node.value.body);
        return false;
      case "Call": {
        mark(node.value.function);
        return any(node.value.arguments);
      }
      case "CallAsync":
        mark(node.value.function);
        any(node.value.arguments);
        return true;
      case "Builtin":
        return any(node.value.arguments);
      case "Platform":
        return any(node.value.arguments) || asyncPlatformFns.has(node.value.name);
      case "Block":
        return any(node.value.statements);
      case "NewArray":
      case "NewSet":
      case "NewVector":
      case "NewMatrix":
        return any(node.value.values);
      case "NewDict":
        return any(node.value.values.flatMap((pair) => [pair.key, pair.value]));
      case "Struct":
        return any(node.value.fields.map((field) => field.value));
      case "IfElse":
        return any([...node.value.ifs.flatMap((branch) => [branch.predicate, branch.body]), node.value.else_body]);
      case "Match":
        return any([node.value.variant, ...node.value.cases.map((c) => c.body)]);
      case "While":
        return any([node.value.predicate, node.value.body]);
      case "ForArray":
        return any([node.value.array, node.value.body]);
      case "ForSet":
        return any([node.value.set, node.value.body]);
      case "ForDict":
        return any([node.value.dict, node.value.body]);
      case "TryCatch":
        return any([node.value.try_body, node.value.catch_body, node.value.finally_body]);
      default:
        throw new Error(`Unhandled IR type: ${(node satisfies never as IR).type}`);
    }
  };
  return mark(ir);
}
