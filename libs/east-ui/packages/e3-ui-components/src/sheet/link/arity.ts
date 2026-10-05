/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Arity (B§4.6 — `Sheet Spec.md` §5 row 9): while the arity half is being
 * edited the strip meta reads *4 × CNC lathe implied · 3 named so far* — never
 * inside the cell. Named = each identified member once, a counted member by
 * its count, a range by its span; text and placeholders do not count.
 */

import { rangeMembers, type LinkVocabulary } from "./grammar.js";
import type { SheetMemberValue } from "../values.js";
import type { SheetWords } from "../words.js";

/** A counted member the arity rule proposes. */
export interface Counted {
    n: number;
    key: string;
}

/** How many members a half names. */
export function namedCount(members: readonly SheetMemberValue[], vocab: LinkVocabulary): number {
    let n = 0;
    for (const m of members) {
        switch (m.type) {
            case "identified": n += 1; break;
            case "counted": n += Number(m.value.n); break;
            case "range": n += rangeMembers(m.value.from, m.value.to, vocab).length; break;
            default: break;
        }
    }
    return n;
}

/**
 * The strip meta for the arity half, in the sheet's words (#861) — `""` when
 * nothing is implied or named.
 *
 * @param implied - The count the arity rule implies
 * @param named - How many members the half names
 * @param w - The sheet's words
 * @returns The line
 */
export function arityMeta(implied: Counted | undefined, named: number, w: SheetWords): string {
    if (implied === undefined || implied.n <= 0 || named <= 0) return "";
    const state = named < implied.n ? "short" : named > implied.n ? "over" : "exact";
    return w.m.arity({ count: w.number(implied.n), key: implied.key, named: w.number(named), state });
}
