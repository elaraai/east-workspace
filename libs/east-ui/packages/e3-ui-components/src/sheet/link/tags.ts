/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A set cell as tags (east-workspace#1741): what a phone's tags editor — the shared field form's — holds of a set cell,
 * and the cell its tags make. A tag is a member as its chip prints it (`memberLabel`). A member the cell holds keeps
 * its own by those words — a counted member, a range and the placeholder whole; a tag that is the key of a member the
 * row is offered is that member — the editor suggests its members by key, and shows no candidate before a tag is made —
 * and any other is read as typing it in the cell reads it, through the cell's link editor context: the armed candidate
 * where it completes the words, else the grammar, against the whole register. The editor suggests the register's
 * members the row is offered and the cell does not hold, in the words a chip prints them in: by key.
 *
 * @packageDocumentation
 */

import { variant } from "@elaraai/east";
import { memberLabel } from "../model.js";
import type { LinkEditCtx } from "../sheet-types.js";
import type { SheetCellValue, SheetMemberValue } from "../values.js";

const NO_MEMBERS: readonly SheetMemberValue[] = [];

/**
 * A set cell's members: its link's destination half, the one a set holds.
 *
 * @param cell - The cell
 * @returns Its members, in order; none where it holds no link
 */
export function setMembers(cell: SheetCellValue | undefined): readonly SheetMemberValue[] {
    return cell?.type === "Link" ? cell.value.to : NO_MEMBERS;
}

/**
 * A set cell's tags: each member as its chip prints it.
 *
 * @param members - The cell's members ({@link setMembers})
 * @returns The tags, in order
 */
export function setTags(members: readonly SheetMemberValue[]): string[] {
    return members.map(memberLabel);
}

/**
 * The tags a set's editor suggests: the register's members the row is offered that the cell does not hold, in the
 * register's order — each by its key, the words its chip prints it in.
 *
 * @param ctx - The cell's link editor context
 * @param held - The members the cell holds
 * @returns The suggestions
 */
export function setSuggestions(ctx: Pick<LinkEditCtx, "offered">, held: readonly SheetMemberValue[]): string[] {
    return ctx.offered([[], [...held]]).map((m) => m.key);
}

/**
 * The members a set cell's tags make: a tag the cell held keeps its member, whole; one that is the key of a member the
 * row is offered, in any case, is that member — a suggestion tapped, a key typed whole — whatever longer name its words
 * begin; any other is read as typing it in the cell reads it. None is a member the tags before it name already, which
 * the offered members and the candidates leave out.
 *
 * @param tags - The tags, in order
 * @param held - The members the cell holds
 * @param ctx - The cell's link editor context
 * @returns The members, in the tags' order
 */
export function setMembersOf(tags: readonly string[], held: readonly SheetMemberValue[], ctx: Pick<LinkEditCtx, "resolve" | "candidateAt" | "offered">): SheetMemberValue[] {
    const kept = new Map<string, SheetMemberValue>();
    for (const m of held) {
        const words = memberLabel(m);
        if (!kept.has(words)) kept.set(words, m);
    }
    const out: SheetMemberValue[] = [];
    for (const tag of tags) {
        const own = kept.get(tag);
        if (own !== undefined) {
            out.push(own);
            continue;
        }
        // The typed resolution arms the first member whose name the words begin: `Bay 2` for `Bay`, listed before it.
        const key = tag.trim().toLowerCase();
        const offered = ctx.offered([[], out]).find((m) => m.key.toLowerCase() === key);
        if (offered !== undefined) {
            out.push(variant("identified", { key: offered.key }));
            continue;
        }
        for (const m of ctx.resolve(tag, ctx.candidateAt(tag, -1, [[], out]))) out.push(m);
    }
    return out;
}

/**
 * The cell a set's tags make: its members ({@link setMembersOf}) in the half a set holds, beside what the other half
 * holds — `null` once neither holds any, the blank cell.
 *
 * @param tags - The tags, in order
 * @param cell - The cell as it stands
 * @param ctx - The cell's link editor context
 * @returns The cell, or `null` for the blank one
 */
export function setCellOf(tags: readonly string[], cell: SheetCellValue | undefined, ctx: Pick<LinkEditCtx, "resolve" | "candidateAt" | "offered" | "cell">): SheetCellValue | null {
    const from = cell?.type === "Link" ? [...cell.value.from] : [];
    return ctx.cell([from, setMembersOf(tags, setMembers(cell), ctx)]);
}
