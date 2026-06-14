/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Generic IR tree walker.
 *
 * Recursively visits every node in an East IR tree, calling the visitor with
 * each node and a context object carrying its parent. Used by static-analysis
 * tooling (e.g. e3-ui's manifest derivation walks for `data_bind` calls).
 *
 * @packageDocumentation
 */

import type { IR, ValueIR } from "./ir.js";
import { variant } from "./containers/variant.js";
import { ref } from "./containers/ref.js";

// ============================================================================
// Convenience helper
// ============================================================================

/**
 * Read the raw JS payload from a `Value` IR node.
 *
 * `Value` IR wraps its payload in two envelopes:
 *
 *   - the outer `value` field carries `{type, loc_id, value}`, where the
 *     inner `value` is itself a {@link LiteralValue} variant
 *     (`{type: "String" | "Integer" | …, value: <jsValue>}`),
 *   - and that variant's `value` field is the raw JS value.
 *
 * Static-analysis tools (manifest derivation, compile-time validation,
 * etc.) need to read those payloads back out, and writing
 * `(ir as ValueIR).value.value.value` at every call site is both
 * fragile (brittle to envelope shape changes) and unreadable.
 *
 * @example
 * ```ts
 * import { East, walkIR, literalValueOf } from "@elaraai/east";
 *
 * walkIR(fn.toIR().ir, (node) => {
 *     if (node.type === 'Value') {
 *         console.log(literalValueOf(node));
 *     }
 * });
 * ```
 */
export function literalValueOf(ir: ValueIR): unknown {
    return ir.value.value.value;
}

/**
 * Reconstruct the JS value from a *constant* IR subtree — the inverse of the
 * lowering `East.value(jsValue, type)` performs.
 *
 * `East.value` recursively lowers a JS literal into constant IR: an array
 * becomes a `NewArray` of element nodes, a variant a `Variant` node, a struct
 * a `Struct` node, a primitive a `Value` node, and so on. This walks that
 * subtree back to the JS value, dispatching on the IR node tag — so
 * static-analysis tooling can read a literal argument back out without
 * hand-destructuring each envelope shape (the partial, brittle alternative).
 *
 * Dispatch is on the node tag, not an expected East type: the tag already
 * records which constructor produced the node (`NewArray` vs `NewSet` vs
 * `Struct`), so the reconstruction is unambiguous and needs no type argument.
 *
 * A node that is not a constant constructor — `Variable`, `Call`, `GetField`,
 * `Platform`, an arithmetic `Builtin`, `IfElse`, … — means the value was
 * computed at runtime rather than a literal, and throws. Use this where a
 * value is required to be statically known (e.g. deriving the manifest of
 * dataset paths a UI binds).
 *
 * Sets and dicts come back as plain `Set` / `Map` in the literal's element
 * order; a `SortedSet` / `SortedMap` would need a comparator from the key
 * type, which a tag-directed reader does not carry. Vectors and matrices are
 * not reconstructed — faithfully rebuilding their typed-array storage needs
 * the element type — and throw.
 *
 * @example
 * ```ts
 * import { East, StringType, ArrayType, constValueOf } from "@elaraai/east";
 *
 * const ir = East.value(["a", "b"], ArrayType(StringType)).toIR().ir;
 * constValueOf(ir); // ["a", "b"]
 * ```
 */
export function constValueOf(ir: IR): unknown {
    switch (ir.type) {
        case "Value":
            return literalValueOf(ir as ValueIR);
        case "NewArray":
            return (ir.value.values as IR[]).map(v => constValueOf(v));
        case "NewSet":
            return new Set((ir.value.values as IR[]).map(v => constValueOf(v)));
        case "NewDict":
            return new Map((ir.value.values as { key: IR; value: IR }[])
                .map(e => [constValueOf(e.key), constValueOf(e.value)] as const));
        case "Struct":
            return Object.fromEntries((ir.value.fields as { name: string; value: IR }[])
                .map(f => [f.name, constValueOf(f.value)]));
        case "Variant":
            return variant(ir.value.case, constValueOf(ir.value.value));
        case "NewRef":
            return ref(constValueOf(ir.value.value));
        case "WrapRecursive":
            return constValueOf(ir.value.value);
        default:
            throw new Error(
                `constValueOf: cannot read a constant value from a ${ir.type} node. ` +
                `Only literals produced by East.value are supported ` +
                `(Value / NewArray / NewSet / NewDict / Struct / Variant / NewRef); ` +
                `pass a JS value, not a computed expression.`,
            );
    }
}

/** Context passed to {@link IRVisitor} on each node. */
export interface IRWalkContext {
    /** The parent IR node, or `null` at the root. */
    parent: IR | null;
}

/** Visitor invoked for every node during {@link walkIR}. */
export type IRVisitor = (node: IR, ctx: IRWalkContext) => void;

/**
 * Walk an East IR tree depth-first, invoking `visit` for every node.
 *
 * Recurses into all child IR fields of every node variant. Non-IR fields
 * (literal values, type info, names, etc) are ignored — visit them by
 * inspecting the node directly.
 *
 * @example
 * ```ts
 * const platformCalls: PlatformIR[] = [];
 * walkIR(fn.toIR().ir, (node) => {
 *     if (node.type === 'Platform') platformCalls.push(node);
 * });
 * ```
 */
export function walkIR(ir: IR, visit: IRVisitor): void {
    walkInner(ir, visit, null);
}

function walkInner(ir: IR, visit: IRVisitor, parent: IR | null): void {
    visit(ir, { parent });

    switch (ir.type) {
        case 'Variable':
        case 'Continue':
        case 'Break':
            return; // leaves

        case 'Value':
            return; // literal — value is JS-side, no IR children

        case 'Error':
            walkInner(ir.value.message, visit, ir);
            return;

        case 'TryCatch':
            walkInner(ir.value.try_body, visit, ir);
            walkInner(ir.value.catch_body, visit, ir);
            walkInner(ir.value.finally_body, visit, ir);
            return;

        case 'Let':
        case 'Assign':
            walkInner(ir.value.value, visit, ir);
            return;

        case 'As':
            walkInner(ir.value.value, visit, ir);
            return;

        case 'Function':
        case 'AsyncFunction':
            walkInner(ir.value.body, visit, ir);
            return;

        case 'Call':
        case 'CallAsync': {
            walkInner(ir.value.function, visit, ir);
            for (const arg of ir.value.arguments as IR[]) walkInner(arg, visit, ir);
            return;
        }

        case 'NewRef':
            walkInner(ir.value.value, visit, ir);
            return;

        case 'NewArray':
        case 'NewSet':
        case 'NewVector':
        case 'NewMatrix':
            for (const v of ir.value.values as IR[]) walkInner(v, visit, ir);
            return;

        case 'NewDict':
            for (const entry of ir.value.values as { key: IR; value: IR }[]) {
                walkInner(entry.key, visit, ir);
                walkInner(entry.value, visit, ir);
            }
            return;

        case 'Struct':
            for (const f of ir.value.fields as { name: string; value: IR }[]) {
                walkInner(f.value, visit, ir);
            }
            return;

        case 'GetField':
            walkInner(ir.value.struct, visit, ir);
            return;

        case 'Variant':
            walkInner(ir.value.value, visit, ir);
            return;

        case 'Block':
            for (const stmt of ir.value.statements as IR[]) walkInner(stmt, visit, ir);
            return;

        case 'IfElse': {
            for (const branch of ir.value.ifs) {
                walkInner(branch.predicate, visit, ir);
                walkInner(branch.body, visit, ir);
            }
            walkInner(ir.value.else_body, visit, ir);
            return;
        }

        case 'Match': {
            walkInner(ir.value.variant, visit, ir);
            for (const c of ir.value.cases) walkInner(c.body, visit, ir);
            return;
        }

        case 'UnwrapRecursive':
        case 'WrapRecursive':
            walkInner(ir.value.value, visit, ir);
            return;

        case 'While':
            walkInner(ir.value.predicate, visit, ir);
            walkInner(ir.value.body, visit, ir);
            return;

        case 'ForArray':
            walkInner(ir.value.array, visit, ir);
            walkInner(ir.value.body, visit, ir);
            return;

        case 'ForSet':
            walkInner(ir.value.set, visit, ir);
            walkInner(ir.value.body, visit, ir);
            return;

        case 'ForDict':
            walkInner(ir.value.dict, visit, ir);
            walkInner(ir.value.body, visit, ir);
            return;

        case 'Return':
            walkInner(ir.value.value, visit, ir);
            return;

        case 'Builtin':
        case 'Platform':
            for (const arg of ir.value.arguments as IR[]) walkInner(arg, visit, ir);
            return;
    }
}
