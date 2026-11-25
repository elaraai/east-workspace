/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the state machine's tests share (`sheet-state.test.ts`, `sheet-click.test.ts`): the sheet a transition asks
 * about, the grid's key and the editor's key as events, and a run of events through the reducer.
 *
 * @packageDocumentation
 */

import { variant } from "@elaraai/east";
import { sheetReducer, type SheetMachineCtx, type SheetUiState, type SheetEvent, type SheetEffect } from "./sheet-state.js";
import type { SheetCellValue } from "./values.js";

/** A cell of a type, holding a value. */
export const cell = (type: string, value: unknown): SheetCellValue => variant(type, value) as SheetCellValue;

/** A 4 × 3 sheet: text · date · stamped; `bad` never parses; row 3 is blank. */
export function ctxOf(over: Partial<SheetMachineCtx> = {}): SheetMachineCtx {
    return {
        rowCount: 4,
        colCount: 3,
        lensActive: false,
        canAppend: true,
        editableAt: (_r, c) => c !== 2,
        kindAt: (_r, c) => (c === 0 ? "lookup" : c === 1 ? "date" : "stamped"),
        parse: (_r, _c, text) => text.trim() === "" ? { kind: "blank" } : text === "bad" ? { kind: "unrecognised" } : { kind: "cell", cell: cell("String", text) },
        candidates: (_r, _c, text) => (text.startsWith("ro") ? [{ key: "Routing", label: "Routing" }, { key: "Routing - Nesting", label: "Routing - Nesting" }] : []),
        candidateAt: (_r, _c, text, hi) => (text.startsWith("ro") ? (hi > 0 ? { key: "Routing - Nesting", label: "Routing - Nesting" } : { key: "Routing", label: "Routing" }) : undefined),
        editTextAt: (r, c) => `v${r}${c}`,
        ...over,
    };
}

/** A key on the grid. */
export const key = (k: string, mods: Partial<{ shift: boolean; meta: boolean; alt: boolean }> = {}): SheetEvent =>
    ({ t: "key", key: k, shift: false, meta: false, alt: false, ...mods });

/** A key in the open editor. */
export const ekey = (k: string, mods: Partial<{ shift: boolean; meta: boolean; alt: boolean; atEnd: boolean }> = {}): SheetEvent =>
    ({ t: "editor.key", key: k, shift: false, meta: false, alt: false, atEnd: true, ...mods });

/**
 * Events run through the reducer in turn.
 *
 * @param s - The state they start from
 * @param events - The events, in order
 * @param ctx - The sheet they ask about
 * @returns The state they leave, and every effect they returned, in order
 */
export function run(s: SheetUiState, events: SheetEvent[], ctx = ctxOf()): { state: SheetUiState; effects: SheetEffect[] } {
    let state = s;
    const effects: SheetEffect[] = [];
    for (const e of events) {
        const t = sheetReducer(state, e, ctx);
        state = t.state;
        effects.push(...t.effects);
    }
    return { state, effects };
}
