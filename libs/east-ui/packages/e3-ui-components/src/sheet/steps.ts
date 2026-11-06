/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The cells that step in place (`Record - DX Proposal.md` §4, P2, K2–K4): a
 * cycle walks its register's members in their order, a toggle and a boolean
 * flip. A click, Space or ⏎ takes the next state and ⇧ the one before; ⌫
 * sets a cycle's first member; a key that is a member's label, key or alias
 * sets that member at once. They never open an editor. The machine asks for
 * a cell's next state by its kind, so the gesture is the shared grid's,
 * whatever draws it.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, variant } from "@elaraai/east";
import { resolveMember, type SheetColumnMeta, type SheetRegisterIndex } from "./model.js";
import type { SheetCellValue, SheetRegisterMemberValue } from "./values.js";

const stringEqual = equalFor(StringType);

/** A step: the next state, the one before, or a cycle's first. */
export type SheetStep = 1 | -1 | "first";

/**
 * Whether a column's cells step in place rather than open an editor.
 *
 * @param meta - The column
 * @returns Whether its cell is a cycle, a toggle or a boolean
 */
export function stepsInPlace(meta: SheetColumnMeta | undefined): boolean {
    return meta?.kind === "cycle" || meta?.kind === "toggle" || meta?.kind === "boolean";
}

/**
 * The member a cycle's typed text names: one whose label is the text, else
 * one whose key or alias is — either case.
 *
 * @param meta - The cycle column
 * @param text - What was typed
 * @param registers - The registers
 * @returns The member, or `undefined` where none is named
 */
export function cycleMember(meta: SheetColumnMeta, text: string, registers: SheetRegisterIndex): SheetRegisterMemberValue | undefined {
    const typed = text.trim().toLowerCase();
    if (typed === "") return undefined;
    const members = registers.byName.get(meta.register ?? "") ?? [];
    return members.find((m) => stringEqual(m.label.toLowerCase(), typed)) ?? resolveMember(registers, meta.register, typed);
}

/**
 * A boolean's or a toggle's typed text as its state: a toggle's own words
 * first, then the words every checkbox reads.
 *
 * @param meta - The boolean or toggle column
 * @param text - What was typed
 * @returns The state, or `undefined` for text that names none
 */
export function booleanOf(meta: SheetColumnMeta, text: string): boolean | undefined {
    const typed = text.trim().toLowerCase();
    if (meta.raw.kind.type === "toggle") {
        if (stringEqual(typed, meta.raw.kind.value.on.toLowerCase())) return true;
        if (stringEqual(typed, meta.raw.kind.value.off.toLowerCase())) return false;
    }
    if (["true", "yes", "y", "1", "x", "on"].some((word) => stringEqual(word, typed))) return true;
    if (["false", "no", "n", "0", "off"].some((word) => stringEqual(word, typed))) return false;
    return undefined;
}

/**
 * A stepping cell's next state: a cycle's next member in the register's
 * order, round to the first — from no member, the first (the last going
 * back) — or its first; a toggle's or a boolean's other state.
 *
 * @param meta - The column
 * @param cell - The cell as it stands
 * @param registers - The registers
 * @param step - Which way, or a cycle's first
 * @returns The cell after the step; `undefined` for a column that does not step, or a step it does not take
 */
export function stepCell(meta: SheetColumnMeta | undefined, cell: SheetCellValue | undefined, registers: SheetRegisterIndex, step: SheetStep): SheetCellValue | undefined {
    if (meta === undefined) return undefined;
    switch (meta.kind) {
        case "cycle": {
            const members = registers.byName.get(meta.register ?? "") ?? [];
            const n = members.length;
            if (n === 0) return undefined;
            if (step === "first") return variant("String", members[0]!.key);
            const at = cell?.type === "String" ? members.findIndex((m) => stringEqual(m.key, cell.value)) : -1;
            const next = at < 0 ? (step > 0 ? 0 : n - 1) : (at + step + n) % n;
            return variant("String", members[next]!.key);
        }
        case "toggle":
        case "boolean":
            if (step === "first") return undefined;
            return variant("Boolean", !(cell?.type === "Boolean" && cell.value));
        default:
            return undefined;
    }
}

/**
 * The cell a key sets on a stepping cell (K4): on a cycle, the member whose
 * label, key or alias is the key; nothing on a toggle or a boolean.
 *
 * @param meta - The column
 * @param key - The key pressed
 * @param registers - The registers
 * @returns The cell, or `undefined` where the key names no member
 */
export function keyedCell(meta: SheetColumnMeta | undefined, key: string, registers: SheetRegisterIndex): SheetCellValue | undefined {
    if (meta?.kind !== "cycle") return undefined;
    const member = cycleMember(meta, key, registers);
    return member === undefined ? undefined : variant("String", member.key);
}
