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
    type PatchPathSegment,
    type PatchVisitor,
    StringType,
    parseFor,
    walkPatch,
    pathToString,
    pathDisplay,
} from "@elaraai/east";

// =============================================================================
// Node tree
// =============================================================================

export type LeafOp = PatchLeafOp;

/** One leaf as East's walker reports it. */
type LeafEvent = Parameters<PatchVisitor["leaf"]>[0];

/** A leaf change — one user-visible before/after pair. */
export interface LeafNode {
    kind: "leaf";
    /** Stringified PatchPath — stable id within the binding. */
    path: string;
    /** Last segment, for display. */
    label: string;
    op: LeafOp;
    /** The leaf's East type — the walker always knows it. */
    leafType: LeafEvent["type"];
    /** The value before the change, a value of `leafType` — `undefined` for
     *  an insert. */
    before: LeafEvent["before"];
    /** The value after the change, a value of `leafType` — `undefined` for a
     *  delete. */
    after: LeafEvent["after"];
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

const readString = parseFor(StringType);

/**
 * Display label for the last path segment. A "key" segment (Dict / Set
 * traversal) is the key as East prints it — a String key quoted (`"foo"`),
 * so the path identity round-trips unambiguously. The label is for *display
 * only*: a String key shows as East reads it back (`foo`); any other key, and
 * a string East cannot read back, shows as printed. Path identity (used as a
 * resolution-map key) stays the printed form via `pathToString`.
 */
function leafDisplayLabel(seg: PatchPathSegment): string {
    if (seg.kind === "key") {
        const read = readString(seg.key);
        if (read.success) return read.value;
    }
    return pathDisplay(seg);
}

// =============================================================================
// Walker
// =============================================================================

/**
 * Walk a patch and build the renderer's `DiffNode` tree. Returns `null` when
 * the patch is unchanged (no events fire).
 *
 * @param typeValue - Runtime EastTypeValue of the value being patched.
 * @param patch     - The patch (`PatchTypeOf<T>`), as East's walker takes it.
 * @param rootLabel - Display label for the root node (the renderer fills in
 *   the binding name here).
 */
export function walkPatchToTree(
    typeValue: EastTypeValue,
    patch: Parameters<typeof walkPatch>[1],
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
