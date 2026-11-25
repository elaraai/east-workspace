/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The link editor's context for one cell (P3 — `Sheet Spec.md` §6.3 "Links"): what the editor of a link or a set cell
 * asks — its halves, the members it holds, the candidates for typed text, the resolution of a buffer, the prediction
 * from the column's pending fill, the cell for the halves and whether they are the cell's own — and what a phone's
 * tags editor resolves its members by (east-workspace#1741). Pure: the Sheet's link wiring (`use-links.ts`) builds it
 * per cell.
 *
 * @packageDocumentation
 */

import { equalFor, variant } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { usedKeys, type LinkVocabulary } from "./grammar.js";
import { linkCandidates, linkCandidateAt, predictedMembers, resolveBuffer } from "./predict.js";
import type { LinkHalves } from "./sides.js";
import type { LinkEditCtx, LinkGroups } from "../sheet-types.js";
import type { SheetCellValue, SheetLinkValue } from "../values.js";
import type { SheetWords } from "../words.js";

const linkEqual = equalFor(Sheet.Types.Link);

/**
 * Whether two pairs of halves hold the same members, each half's in the same order: East's equality over the link they
 * make. The same members in another order are another link, as a cell prints them.
 *
 * @param a - One pair of halves
 * @param b - The other
 * @returns Whether a cell of the one is a cell of the other
 */
export function sameHalves(a: LinkGroups, b: LinkGroups): boolean {
    return linkEqual({ from: a[0], to: a[1] }, { from: b[0], to: b[1] });
}

/** What a cell's link editor context is made of ({@link linkEditCtx}). */
export interface LinkEditCtxInput {
    /** The column's vocabulary: what typed text resolves against — the whole register. */
    vocab: LinkVocabulary;
    /** The vocabulary the row is offered — its `options` rule's members (#844), else the whole register's. */
    offer: LinkVocabulary;
    /** The cell's link, where it holds one. */
    current: SheetLinkValue | undefined;
    /** The halves the row's driver makes live, and their lock tags. */
    halves: LinkHalves;
    /** The column's pending fill as a link, read as the editor predicts from it (`undefined` = none). */
    predicted: () => SheetLinkValue | undefined;
    /** The row's driver member's name — `undefined` when the row names none. */
    driverName: string | undefined;
    /** The sheet's words (#861): the candidates' metas speak them. */
    words: SheetWords;
}

/**
 * The link editor's context for one cell: its halves and the members it holds; the candidates for typed text, and the
 * members the row is offered, over what it is offered, never a member the halves hold; typed text resolved against
 * the whole register; the members predicted from the column's pending fill; the cell for the halves; and whether the
 * halves are the cell's own, which an editor closed on them writes nothing for.
 *
 * @param input - The vocabularies, the cell's link, its halves, its prediction, its driver's name and the words
 * @returns The context
 */
export function linkEditCtx({ vocab, offer, current, halves, predicted, driverName, words }: LinkEditCtxInput): LinkEditCtx {
    const usedOf = (groups: LinkGroups) => usedKeys([...groups[0], ...groups[1]], vocab);
    const initial: LinkGroups = [current !== undefined ? [...current.from] : [], current !== undefined ? [...current.to] : []];
    return {
        halves,
        initial,
        candidates: (text, groups) => linkCandidates(text, offer, usedOf(groups), words),
        candidateAt: (text, hi, groups) => linkCandidateAt(text, hi, offer, usedOf(groups), words),
        offered: (groups) => {
            const used = usedOf(groups);
            return offer.members.filter((m) => !used.has(m.key.toLowerCase()));
        },
        resolve: (text, cand) => resolveBuffer(text, cand, vocab),
        predicted: (side, groups, typed) => predictedMembers(predicted(), side, groups, side === 0 ? halves.from.live : halves.to.live, typed, vocab),
        cell: (groups): SheetCellValue | null => (groups[0].length === 0 && groups[1].length === 0 ? null : variant("Link", { from: groups[0], to: groups[1] })),
        unchanged: (groups) => sameHalves(groups, initial),
        driverName,
    };
}
