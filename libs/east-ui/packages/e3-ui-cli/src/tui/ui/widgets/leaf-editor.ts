/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The leaf editor — an inline line editor in the selected row's value
 * cell: strings verbatim, integers and floats validated as typed,
 * datetimes as ISO text, booleans toggled with space. `⏎` commits the
 * leaf to the edit buffer, `Esc` cancels.
 *
 * @packageDocumentation
 */

import { variant } from '@elaraai/east';
import type { RowModel } from '@elaraai/east-ui/internal';
import type { LeafEditUi } from '../../state/actions.js';

/** A leaf value as the row model carries it. */
export type LeafValue = NonNullable<RowModel['leaf']>;

/**
 * The editor kind of a leaf, or null for a leaf that cannot be edited (null).
 *
 * @param leaf - The leaf
 * @returns The kind
 */
export function leafKindOf(leaf: LeafValue): LeafEditUi['leaf'] | null {
    switch (leaf.type) {
        case 'string': case 'integer': case 'float': case 'datetime': case 'boolean': return leaf.type;
        default: return null;
    }
}

/**
 * The text an editor starts with.
 *
 * @param leaf - The leaf
 * @returns The text
 */
export function initialText(leaf: LeafValue): string {
    switch (leaf.type) {
        case 'string': return leaf.value;
        case 'integer': return String(leaf.value);
        case 'float': return String(leaf.value);
        case 'boolean': return leaf.value ? 'true' : 'false';
        case 'datetime': return leaf.value.toISOString().replace(/\.000Z$/, 'Z');
        default: return '';
    }
}

/**
 * Parses the editor's text into a leaf.
 *
 * @param kind - The editor kind
 * @param text - The text
 * @returns The leaf, or the error to show
 */
export function parseLeaf(kind: LeafEditUi['leaf'], text: string): { ok: true; leaf: LeafValue } | { ok: false; error: string } {
    switch (kind) {
        case 'string':
            return { ok: true, leaf: variant('string', text) as LeafValue };
        case 'integer': {
            const trimmed = text.trim().replace(/[,_]/g, '');
            if (!/^[+-]?\d+$/.test(trimmed)) return { ok: false, error: 'an integer, like 14' };
            return { ok: true, leaf: variant('integer', BigInt(trimmed)) as LeafValue };
        }
        case 'float': {
            const n = Number(text.trim().replace(/[,_]/g, ''));
            if (text.trim() === '' || !Number.isFinite(n)) return { ok: false, error: 'a number, like 0.35' };
            return { ok: true, leaf: variant('float', n) as LeafValue };
        }
        case 'datetime': {
            const d = new Date(text.trim());
            if (!Number.isFinite(d.getTime())) return { ok: false, error: 'an ISO datetime, like 2025-09-01T00:00:00Z' };
            return { ok: true, leaf: variant('datetime', d) as LeafValue };
        }
        case 'boolean': {
            const t = text.trim().toLowerCase();
            if (t !== 'true' && t !== 'false') return { ok: false, error: 'true or false (space toggles)' };
            return { ok: true, leaf: variant('boolean', t === 'true') as LeafValue };
        }
    }
}

/**
 * The editor's text with the caret.
 *
 * @param editing - The editor state
 * @param cursor - The caret glyph
 * @returns The text
 */
export function editorText(editing: LeafEditUi, cursor: string): string {
    return `${editing.text.slice(0, editing.cursor)}${cursor}${editing.text.slice(editing.cursor)}`;
}

/**
 * The editor after a key.
 *
 * @param editing - The editor state
 * @param key - The key (`char` carries text)
 * @returns The next state
 */
export function editKey(editing: LeafEditUi, key: { kind: 'char'; text: string } | { kind: 'backspace' | 'delete' | 'left' | 'right' | 'home' | 'end' | 'toggle' }): LeafEditUi {
    const { text, cursor } = editing;
    switch (key.kind) {
        case 'char': return { ...editing, text: text.slice(0, cursor) + key.text + text.slice(cursor), cursor: cursor + key.text.length, error: null };
        case 'backspace': return cursor === 0 ? editing : { ...editing, text: text.slice(0, cursor - 1) + text.slice(cursor), cursor: cursor - 1, error: null };
        case 'delete': return { ...editing, text: text.slice(0, cursor) + text.slice(cursor + 1), error: null };
        case 'left': return { ...editing, cursor: Math.max(0, cursor - 1) };
        case 'right': return { ...editing, cursor: Math.min(text.length, cursor + 1) };
        case 'home': return { ...editing, cursor: 0 };
        case 'end': return { ...editing, cursor: text.length };
        case 'toggle': {
            if (editing.leaf === 'boolean') {
                const next = text.trim().toLowerCase() === 'true' ? 'false' : 'true';
                return { ...editing, text: next, cursor: next.length, error: null };
            }
            return { ...editing, text: text.slice(0, cursor) + ' ' + text.slice(cursor), cursor: cursor + 1, error: null };
        }
    }
}
