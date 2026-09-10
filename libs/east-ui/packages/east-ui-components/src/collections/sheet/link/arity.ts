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
            case "counted": n += Number((m.value as { n: bigint }).n); break;
            case "range": {
                const r = m.value as { from: string; to: string };
                n += rangeMembers(r.from, r.to, vocab).length;
                break;
            }
            default: break;
        }
    }
    return n;
}

/** The strip meta for the arity half — `""` when nothing is implied or named. */
export function arityMeta(implied: Counted | undefined, named: number): string {
    if (implied === undefined || implied.n <= 0 || named <= 0) return "";
    const word = named < implied.n ? "named so far" : named > implied.n ? "named — more than the quantity needs" : "named";
    return `${implied.n} × ${implied.key} implied · ${named} ${word}`;
}
