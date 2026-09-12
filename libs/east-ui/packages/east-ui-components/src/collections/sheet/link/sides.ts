/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sides and locks (B§4.2 — `Sheet Spec.md` §5 row 5): the driver member's
 * `sides` value — `both` · `from` (To locked) · `to` (From locked) · `in`
 * (From locked, the divider drawn as a minus) — selects the live halves; the
 * column's lock rules name the tag a locked half shows. No driver, or a
 * driver without `sides`: both live.
 *
 * A locked half is never predicted into and Tab skips it, but typing into it
 * is allowed: the content is kept and the tag turns warn — a flag, not a
 * block.
 */

import { getSomeorUndefined } from "../../../utils.js";
import type { SheetColumnMeta } from "../model.js";
import type { SheetMemberValue } from "../values.js";

/** The driver's sides value. */
export type SidesValue = "both" | "from" | "to" | "in";

/** One half's state. */
export interface HalfState {
    /** The half takes members: predicted into, Tab reaches it. */
    live: boolean;
    /** The lock tag's text when the half is locked (`""` = locked without a tag, or live). */
    lock: string;
}

/** Both halves of a link cell. */
export interface LinkHalves {
    from: HalfState;
    to: HalfState;
    /** `in` — the divider draws as a minus. */
    isIn: boolean;
    sides: SidesValue;
}

/** The decoded sides declaration of a link column, flattened. */
export interface SidesDecl {
    byDriver: ReadonlyMap<string, SidesValue>;
    locks: readonly { half: "from" | "to"; when: SidesValue; label: string }[];
}

/** Read a link column's sides declaration off the decoded kind (`undefined` when it declares none). */
export function sidesDeclOf(meta: SheetColumnMeta): SidesDecl | undefined {
    if (meta.raw.kind.type !== "link") return undefined;
    const decl = getSomeorUndefined(meta.raw.kind.value.sides);
    if (decl === undefined) return undefined;
    return {
        byDriver: new Map([...decl.byDriver].map(([k, v]) => [k, v.type])),
        locks: decl.locks.map((l) => ({ half: l.half.type, when: l.when.type, label: l.label })),
    };
}

const BOTH: LinkHalves = { from: { live: true, lock: "" }, to: { live: true, lock: "" }, isIn: false, sides: "both" };

/** The halves a row's driver value makes live, and the tags its locks show. */
export function halvesFor(decl: SidesDecl | undefined, driverKey: string | undefined): LinkHalves {
    if (decl === undefined || driverKey === undefined) return BOTH;
    const sides = decl.byDriver.get(driverKey) ?? "both";
    const lockOf = (half: "from" | "to"): string => decl.locks.find((l) => l.half === half && l.when === sides)?.label ?? "";
    return {
        from: { live: sides === "both" || sides === "from", lock: sides === "both" || sides === "from" ? "" : lockOf("from") },
        to: { live: sides !== "from", lock: sides !== "from" ? "" : lockOf("to") },
        isIn: sides === "in",
        sides,
    };
}

/** The half the caret opens in: the first live half still empty, else the destination. */
export function startSide(halves: LinkHalves, groups: readonly [readonly SheetMemberValue[], readonly SheetMemberValue[]]): 0 | 1 {
    if (halves.from.live && groups[0].length === 0) return 0;
    if (halves.to.live && groups[1].length === 0) return 1;
    return halves.to.live ? 1 : 0;
}

/** Whether a half with content sits under a lock — the warn treatment. */
export function halfWarns(half: HalfState, members: readonly SheetMemberValue[]): boolean {
    return !half.live && members.length > 0;
}
