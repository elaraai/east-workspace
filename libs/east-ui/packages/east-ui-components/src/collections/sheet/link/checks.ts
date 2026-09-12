/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Member checks (B§2 `check` — `Sheet Spec.md` §3.4): `exists` is the
 * grammar's own — an identified, counted or range member must name a
 * register key; a placeholder or text passes — and the rest are the
 * author's, bridged wire functions over the check context returning
 * `some(message)` to flag a member. Flags are shown, never enforced; a check
 * that throws flags nothing and logs (fail-open).
 */

import type { LinkVocabulary } from "./grammar.js";
import type { SheetColumnMeta } from "../model.js";
import type { SheetCheckContextValue, SheetCheckValue, SheetLinkValue, SheetMemberValue } from "../values.js";

/** One check of a link column — the decoded wire check: `exists`, or the author's bridged rule. */
export type CheckDecl = SheetCheckValue;

/** Read a link column's checks off the decoded kind. */
export function checksOf(meta: SheetColumnMeta): readonly CheckDecl[] {
    return meta.raw.kind.type === "link" ? meta.raw.kind.value.check : [];
}

/** The flags on the members of a link — per half, per member index. */
export interface LinkFlags {
    from: string[][];
    to: string[][];
}

/** No flags. */
export const NO_FLAGS: LinkFlags = { from: [], to: [] };

/** Whether any member is flagged. */
export function hasFlags(flags: LinkFlags): boolean {
    return flags.from.some((f) => f.length > 0) || flags.to.some((f) => f.length > 0);
}

/** The `exists` check on one member. */
export function existsFlag(m: SheetMemberValue, vocab: LinkVocabulary): string | undefined {
    switch (m.type) {
        case "identified":
        case "counted":
            return vocab.byKey.has(m.value.key.toLowerCase()) ? undefined : `${m.value.key} is not in the register`;
        case "range":
            return vocab.byKey.has(m.value.from.toLowerCase()) ? undefined : `${m.value.from} is not in the register`;
        default:
            return undefined;
    }
}

/**
 * Run a column's checks over a link.
 *
 * @param link - The link value
 * @param checks - The column's checks
 * @param vocab - The column's vocabulary (for `exists`)
 * @param contextFor - The wire check context for a member (`half`, `member` filled by the caller)
 */
export function checkLink(
    link: SheetLinkValue,
    checks: readonly CheckDecl[],
    vocab: LinkVocabulary,
    contextFor: (half: "from" | "to", member: SheetMemberValue) => SheetCheckContextValue,
): LinkFlags {
    if (checks.length === 0) return NO_FLAGS;
    const run = (half: "from" | "to", members: readonly SheetMemberValue[]): string[][] => members.map((m) => {
        const flags: string[] = [];
        for (const c of checks) {
            if (c.type === "exists") {
                const f = existsFlag(m, vocab);
                if (f !== undefined) flags.push(f);
                continue;
            }
            try {
                const out = c.value(contextFor(half, m));
                if (out.type === "some") flags.push(out.value);
            } catch (err) {
                // Fail-open: a broken rule can never block entry.
                console.error("[Sheet] link check failed:", err);
            }
        }
        return flags;
    });
    return { from: run("from", link.from), to: run("to", link.to) };
}
