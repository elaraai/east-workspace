/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * UI-tree builder. Wraps east's {@link walkPatch} visitor so the renderer
 * sees the patch as a hierarchical {@link DiffNode} tree:
 *
 *   roster        (3 changes)
 *     [0]         (1 change)
 *       rate      32.5 → 36.0
 *     [1]         (2 changes)
 *       rate      32.5 → 36.0
 *       shiftLen  8 → 10
 *
 * All the heavy lifting (type-driven recursion, container `replace`
 * re-diffing, array delete+insert pairing, path encoding) lives in east —
 * this module only translates visitor events into nodes.
 *
 * @packageDocumentation
 */

import {
    type EastTypeValue,
    type PatchLeafOp,
    walkPatch,
    pathToString,
    pathDisplay,
} from "@elaraai/east";

// =============================================================================
// Node tree
// =============================================================================

export type LeafOp = PatchLeafOp;

/** A leaf change — one user-visible before/after pair. */
export interface LeafNode {
    kind: "leaf";
    /** Stringified PatchPath — stable id within the binding. */
    path: string;
    /** Last segment, for display. */
    label: string;
    op: LeafOp;
    leafType: EastTypeValue | null;
    before: any;
    after: any;
    /** Set when the patch's expectation at this leaf disagrees with the
     *  actual base value (overlay-mode drift). When present, the row should
     *  render a warning badge with `actual` so the user can see what the
     *  source has now vs what the patch expected. */
    stale?: { expected: unknown; actual: unknown };
}

/** An interior change — wraps multiple leaf or group children. */
export interface GroupNode {
    kind: "group";
    /** Stringified PatchPath. */
    path: string;
    /** Last segment, for display. */
    label: string;
    /** Total leaves under this subtree. */
    leafCount: number;
    /** Flat list of every leaf path under this subtree. Pre-computed during
     *  walk so the renderer's "discard all" handler doesn't re-traverse on
     *  each render. */
    subtreeLeafPaths: string[];
    children: DiffNode[];
}

export type DiffNode = LeafNode | GroupNode;

/** Enumerate all leaves under a node — used for total-count tallies that
 *  need {@link LeafNode} objects (not just paths). */
export function collectLeaves(node: DiffNode, into: LeafNode[] = []): LeafNode[] {
    if (node.kind === "leaf") into.push(node);
    else for (const c of node.children) collectLeaves(c, into);
    return into;
}

/**
 * Display label for the last path segment. For "key" segments produced by
 * Dict / Set traversal, the underlying east walker uses `printFor(elemType)`
 * which JSON-quotes strings (`"foo"`) so the path identity round-trips
 * unambiguously. The label is for *display only* — strip the surrounding
 * quotes so the user sees `foo` instead of `"foo"`. Path identity (used as
 * a resolution-map key) stays quoted via `pathToString`.
 */
function leafDisplayLabel(seg: { kind: string; key?: string } & Record<string, unknown>): string {
    if (seg.kind === "key" && typeof seg.key === "string"
        && seg.key.length >= 2 && seg.key.startsWith('"') && seg.key.endsWith('"')) {
        // JSON-style string key — show the inner without round-trip quotes.
        try { return JSON.parse(seg.key) as string; }
        catch { /* fall through */ }
    }
    return pathDisplay(seg as Parameters<typeof pathDisplay>[0]);
}

// =============================================================================
// Walker
// =============================================================================

/**
 * Walk a patch and build the renderer's `DiffNode` tree. Returns `null` when
 * the patch is unchanged (no events fire).
 *
 * @param typeValue - Runtime EastTypeValue of the value being patched.
 * @param patch     - The patch (`PatchTypeOf<T>`).
 * @param rootLabel - Display label for the root node (the renderer fills in
 *   the binding name here).
 */
export function walkPatchToTree(
    typeValue: EastTypeValue,
    patch: any,
    rootLabel: string,
): DiffNode | null {
    // Stack of in-progress group nodes. Top of stack is the current parent.
    // We push on `enter` and pop on `exit`; leaves go directly onto the
    // current top.
    const stack: GroupNode[] = [];
    let root: DiffNode | null = null;

    walkPatch(typeValue, patch, {
        enter: ({ path, leafCount }) => {
            const node: GroupNode = {
                kind: "group",
                path: pathToString(path),
                label: path.length === 0 ? rootLabel : leafDisplayLabel(path[path.length - 1]!),
                leafCount,
                subtreeLeafPaths: [],
                children: [],
            };
            if (stack.length > 0) stack[stack.length - 1]!.children.push(node);
            else root = node;
            stack.push(node);
        },
        leaf: ({ type, path, op, before, after }) => {
            const pathStr = pathToString(path);
            const leaf: LeafNode = {
                kind: "leaf",
                path: pathStr,
                label: path.length === 0 ? rootLabel : leafDisplayLabel(path[path.length - 1]!),
                op,
                leafType: type,
                before,
                after,
            };
            if (stack.length > 0) {
                const parent = stack[stack.length - 1]!;
                parent.children.push(leaf);
                parent.subtreeLeafPaths.push(pathStr);
            } else {
                root = leaf;
            }
        },
        exit: () => {
            // Roll up the popped group's leaf paths into its parent. The
            // popped node itself already has its own subtreeLeafPaths
            // populated (own leaves + nested-group leaves rolled up earlier).
            const popped = stack.pop()!;
            const parent = stack[stack.length - 1];
            if (parent) parent.subtreeLeafPaths.push(...popped.subtreeLeafPaths);
        },
    });

    if (stack.length !== 0) {
        throw new Error(`walkPatchToTree: visitor exit imbalance (stack depth ${stack.length})`);
    }
    return root;
}
