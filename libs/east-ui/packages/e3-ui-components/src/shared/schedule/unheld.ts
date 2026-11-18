/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Whether a builder holds every row of a kind it reads through its source of
 * the rail (#1580, #1621): what a builder asks before a gesture moves a key
 * that rows of the kind may name — the Flowchart of its states and
 * transitions, the Schematic of its link and net kinds — since a row it does
 * not hold would keep naming the old key. One rule for every builder, with no
 * DOM to load, so the modules that record a refusal load with none.
 *
 * @packageDocumentation
 */

import { recordSliceChosen, recordSliceScoped, type RecordSliceNarrowed } from "@elaraai/east-ui/internal";

/**
 * Why a builder may not hold every row of a kind it reads through its source
 * of the rail, as far as the source says:
 *
 * - `scoped` — its page's scope holds only some of the record's rows (#1621),
 *   whatever the viewer chooses and however the builder draws what their
 *   choices leave out: no choice brings the others in.
 * - `filtered` — the viewer's choices leave some out, and the builder reads
 *   the narrowing's rows alone; a Clear brings them back.
 */
export type SourceUnheld = "scoped" | "filtered";

/**
 * Why a builder may not hold every row of a kind it reads through its source
 * of the rail (see the module docs). The scope is asked first: a scoped page
 * holds only some rows under either reading of the viewer's choices, and its
 * words send the viewer where a Clear would not help. A builder that draws
 * what the viewer's choices leave out as context reads every row its page
 * holds, so their choices leave none out.
 *
 * @param part - The kind's source's part of the slice; `undefined` for a kind read whole
 * @param dim - Whether the builder reads every row its page holds, the viewer's narrowing drawn as context (`narrowed="dim"`)
 * @returns Why it may hold only some; `undefined` where it holds them all
 */
export function sourceUnheld(part: RecordSliceNarrowed | undefined, dim: boolean): SourceUnheld | undefined {
    if (part === undefined) return undefined;
    if (recordSliceScoped(part)) return "scoped";
    return !dim && recordSliceChosen(part) ? "filtered" : undefined;
}
