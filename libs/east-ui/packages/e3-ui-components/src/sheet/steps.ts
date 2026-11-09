/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a cell edits by its kind, where a host draws the grid (`Record - DX
 * Proposal.md` P2–P4, K2–K4). The cells that step in place: a cycle walks
 * its register's members in their order, a toggle and a boolean flip. A
 * click, Space or ⏎ takes the next state and ⇧ the one before; ⌫ sets a
 * cycle's first member and a toggle or a boolean off — or empties one a clear
 * empties, a column from data's (#1585); a key that is a member's label, key
 * or alias sets that member at once. They never open an editor. A title edits out of place:
 * a click, ⏎ or F2 opens it where the host edits it, never in the cell —
 * unless the host opens it nowhere, and then it edits in its cell as a text
 * does. The machine asks by the cell's kind, so the gesture is the shared
 * grid's, whatever draws it.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, variant } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { NULL_CELL, resolveTyped, type SheetColumnMeta, type SheetRegisterIndex } from "./model.js";
import type { SheetGridHost } from "./parts.js";
import type { SheetCellValue } from "./values.js";

const stringEqual = equalFor(StringType);

/** A step: the next state, the one before, or the first — a cycle's first member, a toggle's or a boolean's off. */
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
 * Whether a column's cells edit out of place: the host opens them where it
 * edits them, and no editor, typing, paste or clear reaches them in the grid.
 * A host that opens nothing — a Record with no inspector — edits a title in
 * its cell, as a text.
 *
 * @param meta - The column
 * @param host - The host's grid; `undefined` for the Sheet's own
 * @returns Whether its cell is a title the host opens
 */
export function editsOutOfPlace(meta: SheetColumnMeta | undefined, host: Pick<SheetGridHost, "onOpen"> | undefined): boolean {
    return meta?.kind === "title" && host?.onOpen !== undefined;
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
    if (meta.states !== undefined) {
        if (stringEqual(typed, meta.states.on.toLowerCase())) return true;
        if (stringEqual(typed, meta.states.off.toLowerCase())) return false;
    }
    if (["true", "yes", "y", "1", "x", "on"].some((word) => stringEqual(word, typed))) return true;
    if (["false", "no", "n", "0", "off"].some((word) => stringEqual(word, typed))) return false;
    return undefined;
}

/**
 * A stepping cell's next state: a cycle's next member in the register's
 * order, round to the first — from no member, the first (the last going
 * back) — or its first; a toggle's or a boolean's other state, or its first:
 * off, or empty where a clear empties it.
 *
 * @param meta - The column
 * @param cell - The cell as it stands
 * @param registers - The registers
 * @param step - Which way, or the first
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
            // ⌫ (#1585): off, as a cycle goes back to its first — empty where a clear empties it, a column from data's
            // whose clear removes its entry; a Boolean field is never empty.
            if (step === "first") return getSomeorUndefined(meta.raw.from)?.clears === true ? NULL_CELL : variant("Boolean", false);
            return variant("Boolean", !(cell?.type === "Boolean" && cell.value));
        default:
            return undefined;
    }
}

/**
 * The cell a key sets on a stepping cell (K4): on a cycle, the member the
 * key names — by its key or an alias, else by its label, as every register
 * column is typed; nothing on a toggle or a boolean.
 *
 * @param meta - The column
 * @param key - The key pressed
 * @param registers - The registers
 * @returns The cell, or `undefined` where the key names no member
 */
export function keyedCell(meta: SheetColumnMeta | undefined, key: string, registers: SheetRegisterIndex): SheetCellValue | undefined {
    if (meta?.kind !== "cycle" || key.trim() === "") return undefined;
    const member = resolveTyped(registers, meta.register, key);
    return member === undefined ? undefined : variant("String", member.key);
}
