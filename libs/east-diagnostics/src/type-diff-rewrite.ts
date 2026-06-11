/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { TsModule } from "./types.js";
import type { EastModule } from "./east-module.js";
import { reifyEastType } from "./type-reify.js";

/** TS assignability error codes worth attempting an East type-diff rewrite on. */
export const ASSIGNABILITY_CODES: ReadonlySet<number> = new Set([
  2322, // Type 'X' is not assignable to type 'Y'.
  2345, // Argument of type 'X' is not assignable to parameter of type 'Y'.
  2375, // Type 'X' is not assignable to type 'Y' with exactOptionalPropertyTypes.
  2379, // Getter/setter assignability variant of 2322.
  2412, // Property assignability with exactOptionalPropertyTypes.
  2719, // Type 'X' is not assignable to type 'Y'. Two different types with this name exist.
  2739, // Type 'X' is missing the following properties from type 'Y'.
  2740, // Type 'X' is missing the following properties from type 'Y' (array forms).
  2741, // Property 'p' is missing in type 'X' but required in type 'Y'.
]);

function innermostNodeAt(t: TsModule, sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (position < node.getStart(sourceFile) || position >= node.getEnd()) return undefined;
    return t.forEachChild(node, find) ?? node;
  }
  return find(sourceFile);
}

interface TypePair {
  actual: ts.Type;
  expected: ts.Type;
}

// Walk outward from the diagnostic's node to the construct that pins down the
// (actual, expected) pair: an annotated declaration, a property assignment, or
// any expression with a contextual type.
function resolveTypePair(t: TsModule, checker: ts.TypeChecker, node: ts.Node): TypePair | undefined {
  let current: ts.Node | undefined = node;
  for (let hops = 0; current !== undefined && hops < 6; current = current.parent, hops++) {
    if (t.isVariableDeclaration(current) && current.type !== undefined && current.initializer !== undefined) {
      return {
        actual: checker.getTypeAtLocation(current.initializer),
        expected: checker.getTypeFromTypeNode(current.type),
      };
    }
    if (t.isPropertyAssignment(current)) {
      const expected = checker.getContextualType(current.initializer);
      if (expected !== undefined) {
        return { actual: checker.getTypeAtLocation(current.initializer), expected };
      }
    }
    if (t.isExpression(current)) {
      const expected = checker.getContextualType(current);
      if (expected !== undefined) {
        return { actual: checker.getTypeAtLocation(current), expected };
      }
    }
  }
  return undefined;
}

/**
 * Attempt to replace a native TS assignability diagnostic with a localized
 * East type diff. East types are recursive and deeply generic, so the native
 * message restates whole types and is unreadably long; `diffTypes` prunes
 * everything compatible and reports only the offending subtrees.
 *
 * @returns The replacement message, or `undefined` when the diagnostic is not
 * an East type mismatch this can improve (callers keep the native message).
 */
export function rewriteEastAssignability(
  t: TsModule,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
  east: EastModule,
): string | undefined {
  if (diagnostic.start === undefined || !ASSIGNABILITY_CODES.has(diagnostic.code)) return undefined;

  const checker = program.getTypeChecker();
  const node = innermostNodeAt(t, sourceFile, diagnostic.start);
  if (node === undefined) return undefined;
  const pair = resolveTypePair(t, checker, node);
  if (pair === undefined) return undefined;

  const actual = reifyEastType(t, checker, pair.actual, east);
  const expected = reifyEastType(t, checker, pair.expected, east);
  if (actual === undefined || expected === undefined) return undefined;
  // A mismatch between plain JS values is TypeScript's business, not East's.
  if (!actual.eastShaped && !expected.eastShaped) return undefined;
  // An expected side of `.Never` means the parameter's East type is an
  // unresolved generic (inference already failed upstream) — a diff against
  // Never is noise, so keep the native message, which names the real cause.
  if (expected.type === east.NeverType && actual.type !== east.NeverType) return undefined;

  let rendered: string;
  try {
    const diffs = east.diffTypes(actual.type, expected.type);
    if (!Array.isArray(diffs) || diffs.length === 0) return undefined;
    rendered = east.renderTypeDiff(diffs);
  } catch {
    return undefined;
  }
  if (rendered.length === 0) return undefined;
  return `East type mismatch: ${rendered.split("\n").join("; ")}`;
}
