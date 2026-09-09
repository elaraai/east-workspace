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
import type { SheetLinkValue, SheetMemberValue } from "../values.js";

/** The decoded check list of a link column. */
export type CheckDecl =
    | { type: "exists" }
    | { type: "custom"; fn: (ctx: unknown) => { type: string; value: unknown } };

/** Read a link column's checks off the decoded kind. */
export function checksOf(meta: SheetColumnMeta): CheckDecl[] {
    if (meta.kind !== "link") return [];
    const kv = meta.raw.kind.value as { check?: readonly { type: string; value: unknown }[] } | null;
    return (kv?.check ?? []).map((c) => (c.type === "exists"
        ? { type: "exists" } as CheckDecl
        : { type: "custom", fn: c.value as CheckDecl extends { fn: infer F } ? F : never } as CheckDecl));
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
        case "identified": {
            const key = (m.value as { key: string }).key;
            return vocab.byKey.has(key.toLowerCase()) ? undefined : `${key} is not in the register`;
        }
        case "counted": {
            const key = (m.value as { key: string }).key;
            return vocab.byKey.has(key.toLowerCase()) ? undefined : `${key} is not in the register`;
        }
        case "range": {
            const from = (m.value as { from: string }).from;
            return vocab.byKey.has(from.toLowerCase()) ? undefined : `${from} is not in the register`;
        }
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
    contextFor: (half: "from" | "to", member: SheetMemberValue) => unknown,
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
                const out = c.fn(contextFor(half, m));
                if (out.type === "some") flags.push(String(out.value));
            } catch (err) {
                // Fail-open: a broken rule can never block entry.
                console.error("[Sheet] link check failed:", err);
            }
        }
        return flags;
    });
    return { from: run("from", link.from), to: run("to", link.to) };
}
