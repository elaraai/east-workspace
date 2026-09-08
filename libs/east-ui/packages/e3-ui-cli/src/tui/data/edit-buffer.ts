/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The edit buffer of an input — an ordered list of ops (`edit | insert |
 * remove | tag`) applied through `ValueTree.applyEdit` to a *draft* of the
 * base value; the tree renders the draft (re-materialized after every op)
 * with `┆` on the rows the ops touched. `apply` encodes the draft with
 * `encodeDatasetBlob` (collections stay segmented and pageable) and
 * `datasetSet`s it; `replay` re-applies the ops onto a newer base after a
 * conflict, reporting the ops that no longer apply.
 *
 * @packageDocumentation
 */

import type { EastTypeValue } from '@elaraai/east';
import { ValueTree } from '@elaraai/east-ui';
import { pathKey } from '@elaraai/east-ui/internal';
import type { EditOp, EditState } from '../state/actions.js';

/** The op as `ValueTree.applyEdit` takes it. */
function treeOp(op: EditOp): Parameters<typeof ValueTree.applyEdit>[3] {
    switch (op.kind) {
        case 'edit': return { kind: 'edit', leaf: op.leaf as never };
        case 'insert': return { kind: 'insert' };
        case 'remove': return { kind: 'remove' };
        case 'tag': return { kind: 'tag', tag: op.tag };
    }
}

/**
 * The row id an op marks as changed: the edited / tagged row itself, or
 * the container an insert or remove touched.
 *
 * @param op - The op
 * @returns The row id (`pathKey` of the path)
 */
export function markOf(op: EditOp): string {
    if (op.kind === 'edit' || op.kind === 'tag') return pathKey(op.path);
    return pathKey(op.path.slice(0, -1));
}

/**
 * Starts a buffer over a base value.
 *
 * @param ws - The workspace
 * @param path - The dataset path
 * @param type - The value's type
 * @param base - The decoded base value
 * @param baseHash - Its content hash
 * @returns A clean buffer
 */
export function startEdit(ws: string, path: string, type: EastTypeValue, base: unknown, baseHash: string): EditState {
    return { ws, path, type, base, baseHash, ops: [], draft: base, root: ValueTree.materialize(type, base), changed: [], conflict: null, applying: false };
}

/**
 * Appends an op and re-materializes the draft.
 *
 * @param edit - The buffer
 * @param op - The op
 * @returns The buffer with the op applied
 * @throws {Error} When the op does not apply (an unknown dict key, a bad path)
 */
export function pushOp(edit: EditState, op: EditOp): EditState {
    const draft = ValueTree.applyEdit(edit.type, edit.draft, op.path, treeOp(op));
    const mark = markOf(op);
    return {
        ...edit,
        ops: [...edit.ops, op],
        draft,
        root: ValueTree.materialize(edit.type, draft),
        changed: edit.changed.includes(mark) ? edit.changed : [...edit.changed, mark],
    };
}

/**
 * Re-applies the ops onto a newer base (after a conflict); ops that no
 * longer apply are dropped and reported.
 *
 * @param edit - The buffer
 * @param base - The new base value
 * @param baseHash - Its content hash
 * @returns The rebased buffer and the dropped ops
 */
export function replay(edit: EditState, base: unknown, baseHash: string): { edit: EditState; dropped: EditOp[] } {
    let next = startEdit(edit.ws, edit.path, edit.type, base, baseHash);
    const dropped: EditOp[] = [];
    for (const op of edit.ops) {
        try {
            next = pushOp(next, op);
        } catch {
            dropped.push(op);
        }
    }
    return { edit: next, dropped };
}

/**
 * A one-line description of an op (`edit .smoothing`).
 *
 * @param op - The op
 * @returns The text
 */
export function describeOp(op: EditOp): string {
    const where = pathKey(op.path);
    switch (op.kind) {
        case 'edit': return `edit ${where}`;
        case 'insert': return `add ${where}`;
        case 'remove': return `remove ${where}`;
        case 'tag': return `tag ${where} ${op.tag}`;
    }
}

/**
 * The changed rows' short names for the commit bar (`smoothing ·
 * min_confidence`).
 *
 * @param edit - The buffer
 * @returns The names
 */
export function changedNames(edit: EditState): string[] {
    return edit.changed.map(id => {
        if (id === '$') return 'value';
        // The last field or key segment; indices, `?` and `!` name nothing.
        const parts = id.match(/\.[^.[{?!]+|\[[^\]]*\]|\{[^}]*\}|\?|!/g) ?? [];
        for (let i = parts.length - 1; i >= 0; i--) {
            const part = parts[i]!;
            if (part.startsWith('.')) return part.slice(1);
            if (part.startsWith('{')) return part.slice(1, -1);
        }
        return id;
    });
}
