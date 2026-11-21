/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Linking two visuals (#1673, LNK-3, LNK-6, LNK-7): which placements a visual
 * may follow, the match between the leader's field and the follower's, and
 * the edits a link makes — the rules the Follows block and the canvas's
 * linking both go by. What a follower reads of its leader once linked is
 * `clicks.ts`'s.
 *
 * It imports neither React nor the renderers, and reaches e3-ui for its types
 * alone.
 *
 * @packageDocumentation
 */

import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { StudioCellType, StudioSourceType } from "@elaraai/e3-ui/internal";
import { followCycles, type Follow } from "./clicks.js";

/** One placement, decoded. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** A visual, decoded. */
type Visual = Extract<Cell["content"], { type: "visual" }>["value"];
/** A listed source, decoded. */
type Source = ValueTypeOf<typeof StudioSourceType>;

/** A placement's visual; `undefined` for a component's or a text block's. */
function visualOf(cell: Cell | undefined): Visual | undefined {
    return cell !== undefined && cell.content.type === "visual" ? cell.content.value : undefined;
}

/**
 * The fields a visual's clicks tell, in the order a click holds them: what a
 * visual that follows it may read of its selection (CHT-8, TBL-6, LST-3).
 *
 * @param view - What the visual draws
 * @returns The fields, each once: a list's item; a summary's groups; a
 *   pivot's rows and columns; a records table's first column; a chart's
 *   category and its split, a scatter's point, a pie's slice; none for a KPI
 */
export function clickFields(view: Visual["view"]): string[] {
    const fields = ((): string[] => {
        switch (view.type) {
            case "kpi": return [];
            case "list": return [view.value.item.field];
            case "table":
                switch (view.value.type) {
                    case "records": return view.value.value.columns.slice(0, 1);
                    case "summary": return view.value.value.rows.map((group) => group.field);
                    case "pivot": return [view.value.value.rows.field, view.value.value.columns.field];
                }
                break;
            case "chart":
                switch (view.value.type) {
                    case "column": case "bar": case "line": case "area":
                        return [view.value.value.x.field, ...(view.value.value.split.type === "some" ? [view.value.value.split.value] : [])];
                    case "combo": return [view.value.value.x.field];
                    case "scatter": return [view.value.value.point];
                    case "pie": return [view.value.value.slice.field];
                }
        }
        return [];
    })();
    return fields.filter((field, i) => field !== "" && fields.indexOf(field) === i);
}

/**
 * A placement a visual may be linked to.
 *
 * @property cell - The placement
 * @property selects - Whether its click selects already; linking one whose click does not switches it (LNK-7)
 * @property cycle - Whether following it would make a cycle, which is refused (LNK-3)
 */
export interface LeaderChoice {
    /** The placement. */
    readonly cell: Cell;
    /** Whether its click selects already; linking one whose click does not switches it. */
    readonly selects: boolean;
    /** Whether following it would make a cycle, which is refused. */
    readonly cycle: boolean;
}

/**
 * The placements a visual may be linked to, in the page's order: every other
 * visual whose clicks tell a field — a KPI's tell none.
 *
 * @param cells - The page's placements
 * @param follower - The key of the placement that would follow
 * @returns Each, with whether its click selects and whether the link would make a cycle
 */
export function leaderChoices(cells: readonly Cell[], follower: string): LeaderChoice[] {
    return cells.flatMap((cell): LeaderChoice[] => {
        const visual = visualOf(cell);
        if (visual === undefined || cell.key === follower || clickFields(visual.view).length === 0) return [];
        return [{ cell, selects: visual.click.type === "select", cycle: followCycles(cells, follower, cell.key) }];
    });
}

/**
 * A match between a leader's field and a follower's.
 *
 * @property from - The leader's field its selection is read from
 * @property to - The follower's field that matches it
 * @property sure - Whether the match fills itself: both read one source, or the follower's has a field of the same id; otherwise it is proposed, for its operator to confirm (LNK-7)
 */
export interface Match {
    /** The leader's field its selection is read from. */
    readonly from: string;
    /** The follower's field that matches it. */
    readonly to: string;
    /** Whether the match fills itself; otherwise it is proposed, for its operator to confirm. */
    readonly sure: boolean;
}

/** A field's name with what tells no two fields apart taken out: its case, its punctuation, and an `id` that ends it. */
function plain(name: string): string {
    const letters = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return letters.length > 2 && letters.endsWith("id") ? letters.slice(0, -2) : letters;
}

/**
 * The match a link between two visuals starts with (LNK-7).
 *
 * @param leader - The leader's visual
 * @param leaderSource - Its source, as the surface lists it; `undefined` when it lists none of its key
 * @param follower - The follower's source's key
 * @param followerSource - The follower's source, as the surface lists it
 * @returns The leader's first click field against the follower's field: the
 *   same field, surely, when both read one source or the follower's source
 *   has a field of that id; else the follower's field of the same kind whose
 *   name is the leader's (`Machine` against `Machine id`), then one whose
 *   name holds it, then the first of that kind — proposed, never sure;
 *   `undefined` when the leader's clicks tell no field, or the follower's
 *   source lists none of its kind
 */
export function proposeMatch(leader: Visual, leaderSource: Source | undefined, follower: string, followerSource: Source | undefined): Match | undefined {
    const from = clickFields(leader.view)[0];
    if (from === undefined) return undefined;
    if (leader.source === follower) return { from, to: from, sure: true };
    const fields = followerSource?.fields ?? [];
    if (fields.some((field) => field.id === from)) return { from, to: from, sure: true };
    const led = leaderSource?.fields.find((field) => field.id === from);
    const ofKind = fields.filter((field) => led === undefined || field.kind.type === led.kind.type);
    const names = [plain(from), ...(led === undefined ? [] : [plain(led.label)])];
    const named = (field: Source["fields"][number]) => [plain(field.id), plain(field.label)];
    const best = ofKind.find((field) => named(field).some((name) => names.includes(name)))
        ?? ofKind.find((field) => named(field).some((name) => names.some((other) => name.includes(other) || other.includes(name))))
        ?? ofKind[0];
    return best === undefined ? undefined : { from, to: best.id, sure: false };
}

/**
 * What a link changes: the follower, following; and its leader, when linking
 * switched its click.
 */
export interface Linked {
    /** The follower's visual, following the leader. */
    readonly follower: Visual;
    /** The leader's visual with its click switched to select; `undefined` when it selected already. */
    readonly leader: Visual | undefined;
}

/**
 * Links a visual to a leader (LNK-3, LNK-6, LNK-7).
 *
 * @param cells - The page's placements
 * @param follower - The key of the placement that follows
 * @param leader - The key of the placement it follows
 * @param match - The leader's field and the follower's
 * @param empty - What the follower shows with nothing selected: its own, when it followed already; else everything
 * @returns The follower's visual following the leader — and the leader's with
 *   its click switched to select, when it was not; or why the link is
 *   refused: `cycle`, the leader follows the follower already; `missing`,
 *   one of the two is no visual on the page
 */
export function link(cells: readonly Cell[], follower: string, leader: string, match: Pick<Match, "from" | "to">, empty?: Follow["empty"]): Linked | { readonly refused: "cycle" | "missing" } {
    const following = visualOf(cells.find((cell) => cell.key === follower));
    const led = visualOf(cells.find((cell) => cell.key === leader));
    if (following === undefined || led === undefined) return { refused: "missing" };
    if (followCycles(cells, follower, leader)) return { refused: "cycle" };
    const kept = empty ?? (following.follow.type === "some" ? following.follow.value.empty : variant("all", null));
    return {
        follower: { ...following, follow: some({ leader, from: match.from, to: match.to, empty: kept }) },
        leader: led.click.type === "select" ? undefined : { ...led, click: variant("select", null) },
    };
}

/**
 * A visual that follows none: its link taken off.
 *
 * @param visual - The visual
 * @returns The visual, following nothing
 */
export function unlinked(visual: Visual): Visual {
    return { ...visual, follow: none };
}
