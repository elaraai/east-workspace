/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Completion — `complete(text, catalogue)` turns what is typed in the
 * command box into at most eight fuzzy-ranked candidates, each carrying its
 * status, type and size so the list doubles as a status line. A leading `/`
 * completes command names, then that command's arguments; anything else is
 * a fuzzy jump across every workspace, task, input and dataset of the open
 * repository.
 *
 * @packageDocumentation
 */

import type { Candidate } from '../state/actions.js';
import { COMMANDS, RUN_FLAGS, splitWords } from './commands.js';

/** Candidates shown at most. */
export const MAX_CANDIDATES = 8;

/** One thing that can be jumped to or named in a command. */
export interface CatalogueItem {
    kind: 'task' | 'input' | 'dataset' | 'workspace' | 'repo';
    name: string;
    /** The workspace the item belongs to (tasks, inputs, datasets). */
    workspace: string | null;
    /** The status column (`● up-to-date`). */
    status: string;
    /** The type column (`Dict<String, Struct>`). */
    type: string;
    /** The detail column (`84.2 MB · 38.4s`). */
    detail: string;
}

/** What completion draws from. */
export interface Catalogue {
    items: CatalogueItem[];
    /** Variant tags offered by `/tag` on the selected row, if any. */
    tags?: string[] | undefined;
}

/**
 * Fuzzy match score — higher is better, `null` when `pattern` is not a
 * subsequence of `text`. Prefix and word-start matches rank first, then
 * contiguous runs; shorter texts win ties.
 *
 * @param pattern - What was typed (case-insensitive)
 * @param text - The candidate
 * @returns The score, or null
 */
export function fuzzyScore(pattern: string, text: string): number | null {
    const p = pattern.toLowerCase();
    const t = text.toLowerCase();
    if (p === '') return 1000 - t.length;
    // Prefix matches tie so the catalogue's own order decides (stable sort).
    if (t.startsWith(p)) return 5000;
    let score = 0;
    let ti = 0;
    let last = -2;
    for (let pi = 0; pi < p.length; pi++) {
        const idx = t.indexOf(p[pi]!, ti);
        if (idx === -1) return null;
        if (idx === 0 || /[^a-z0-9]/.test(t[idx - 1]!)) score += 30;
        else if (idx === last + 1) score += 20;
        else score += 5;
        last = idx;
        ti = idx + 1;
    }
    return 2000 + score - t.length;
}

function rank<T>(pattern: string, items: T[], text: (item: T) => string): T[] {
    return items
        .map(item => ({ item, score: fuzzyScore(pattern, text(item)) }))
        .filter((s): s is { item: T; score: number } => s.score !== null)
        .sort((a, b) => b.score - a.score)
        .map(s => s.item);
}

function itemCandidate(command: string, item: CatalogueItem): Candidate {
    return {
        kind: item.kind,
        insert: `/${command} ${item.name}`,
        cells: [`/${command}`, item.name, item.status, item.type, item.detail],
    };
}

/**
 * Completes the command box.
 *
 * @param text - The text in the box
 * @param catalogue - The workspace catalogue
 * @returns At most {@link MAX_CANDIDATES} candidates, best first (empty when nothing applies)
 */
export function complete(text: string, catalogue: Catalogue): Candidate[] {
    if (text === '') return [];
    if (!text.startsWith('/')) return jump(text, catalogue);
    const body = text.slice(1);
    const words = splitWords(body);
    const typingName = !/\s/.test(body);
    if (typingName) {
        const name = words[0] ?? '';
        return rank(name, [...COMMANDS], c => c.name)
            .slice(0, MAX_CANDIDATES)
            .map(c => ({ kind: 'command' as const, insert: `/${c.name}${c.usage.includes(' ') ? ' ' : ''}`, cells: [`/${c.name}`, c.usage.replace(`/${c.name}`, '').trim(), c.effect] }));
    }
    const name = words[0] ?? '';
    const partial = body.endsWith(' ') ? '' : (words[words.length - 1] ?? '');
    const byKind = (kinds: CatalogueItem['kind'][], command = name): Candidate[] =>
        rank(partial, catalogue.items.filter(i => kinds.includes(i.kind)), i => i.name)
            .slice(0, MAX_CANDIDATES)
            .map(i => itemCandidate(command, i));
    switch (name) {
        case 'task':
        case 'logs':
        case 'runs':
            return byKind(['task']);
        case 'input':
            return byKind(['input']);
        case 'dataset':
            return byKind(['dataset']);
        case 'workspace':
            return byKind(['workspace']);
        case 'repo':
            return byKind(['repo']);
        case 'run': {
            const used = new Set(words.slice(1));
            return rank(partial, RUN_FLAGS.filter(f => !used.has(f.flag.split(' ')[0]!)), f => f.flag)
                .filter(() => partial === '' || partial.startsWith('-'))
                .map(f => ({ kind: 'flag' as const, insert: `/run ${[...words.slice(1, body.endsWith(' ') ? undefined : -1), f.flag.split(' ')[0]!].join(' ')} `, cells: ['/run', f.flag, f.hint] }));
        }
        case 'tag':
            return rank(partial, catalogue.tags ?? [], t => t)
                .slice(0, MAX_CANDIDATES)
                .map(t => ({ kind: 'tag' as const, insert: `/tag ${t}`, cells: ['/tag', t] }));
        case 'logs2':
            return [];
        default:
            return [];
    }
}

/**
 * The fuzzy jump across everything in the catalogue.
 *
 * @param text - What was typed (no leading `/`)
 * @param catalogue - The workspace catalogue
 * @returns At most {@link MAX_CANDIDATES} candidates
 */
export function jump(text: string, catalogue: Catalogue): Candidate[] {
    return rank(text, catalogue.items, i => i.name)
        .slice(0, MAX_CANDIDATES)
        .map(i => ({
            kind: i.kind,
            insert: `/${i.kind} ${i.name}`,
            cells: [i.kind, i.name, i.workspace ?? '', [i.status, i.type, i.detail].filter(s => s !== '').join(' · ')],
        }));
}
