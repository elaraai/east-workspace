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

import type { IR } from "./ir.js";

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
