/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The rows the event kinds land on (#1541, U1): a resources series' or a
 * kinds case's rows — the record's own, each a resource — and beside each a
 * row for each further way the kinds landing there draw. Every part of the
 * canvas that asks what a row stands for, or which row a kind's event draws
 * on, asks here: the drags (`../edit/event-drag.ts`), the inspector
 * (`../frame/inspector.tsx`), the cells' reader (`cells.ts`) and the canvas.
 *
 * A landing row's id is its series' own — `entry { series: <landing>, path }`,
 * its path ending in the resource's key — and it draws the first way its kinds
 * draw; each further way's row is `entry { series: <landing>.<draw>, path }`,
 * beside it. An event kind's events on no resource are its Unassigned row,
 * `entry { series: <kind>.unassigned, path: [<draw>] }`, after every other
 * row over rows read whole (e3-ui's `event-rows.ts`).
 *
 * @packageDocumentation
 */

import { StringType, equalFor, variant, type option, type ValueTypeOf } from "@elaraai/east";
import type { PlanLandingType, PlanPayloadType } from "@elaraai/e3-ui/internal";
import type { PlanRowId, PlanRowValue } from "../model.js";

/** A series the event kinds land on, as the payload carries it. */
export type PlanLandingValue = ValueTypeOf<typeof PlanLandingType>;

/** One event kind, as the payload carries it. */
type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];

/** What a row stands for among the rows the event kinds land on. */
export type PlanLandingTarget =
    /** A resource: the series it is a row of, its key's text, the row's path to it, and the way the row draws. */
    | { readonly kind: "resource"; readonly landing: PlanLandingValue; readonly key: string; readonly path: readonly string[]; readonly draw: string }
    /** An event kind's events on no resource, and the way the row draws. */
    | { readonly kind: "unassigned"; readonly event: PlanEventKindValue; readonly draw: string };

const stringEqual = equalFor(StringType);

/**
 * The series of a landing's row that draws one way: the landing row's own for
 * the first way its kinds draw, `<landing>.<draw>` for each further one.
 *
 * @param landing - The landing series
 * @param draw - The way of drawing
 * @returns The row's series; `undefined` for a way no kind landing there draws
 */
export function drawSeries(landing: PlanLandingValue, draw: string): string | undefined {
    const i = landing.draws.findIndex((d) => stringEqual(d.type, draw));
    return i < 0 ? undefined : i === 0 ? landing.key : `${landing.key}.${draw}`;
}

/**
 * Every series a row of a landing is drawn under: each landing row's, and
 * each row's beside it for a further way its kinds draw.
 *
 * @param landings - The series the event kinds land on
 * @returns The series
 */
export function landingRowSeries(landings: readonly PlanLandingValue[]): ReadonlySet<string> {
    const out = new Set<string>();
    for (const landing of landings) for (const d of landing.draws) out.add(drawSeries(landing, d.type)!);
    return out;
}

/**
 * What a row stands for, by its id: a resource — a landing row, or a row
 * beside one for a further way its kinds draw — or an event kind's events on
 * none (see the module docs).
 *
 * @param id - The row's id
 * @param landings - The series the event kinds land on
 * @param kinds - The event kinds
 * @returns What it stands for; `undefined` for a row no event kind draws on
 */
export function landingTargetOf(id: PlanRowId, landings: readonly PlanLandingValue[], kinds: readonly PlanEventKindValue[]): PlanLandingTarget | undefined {
    if (id.type !== "entry") return undefined;
    const { series, path } = id.value;
    const key = resourceKeyOf(id);
    if (key !== undefined) {
        for (const landing of landings) {
            const d = landing.draws.find((one) => stringEqual(series, drawSeries(landing, one.type)!));
            if (d !== undefined) return { kind: "resource", landing, key, path, draw: d.type };
        }
    }
    const lost = kinds.find((k) => stringEqual(series, `${k.key}.unassigned`));
    return lost !== undefined ? { kind: "unassigned", event: lost, draw: path[0] ?? lost.draw.type } : undefined;
}

/**
 * The resource a row of a landing's own series stands beneath (#1541): its
 * landing row's resource — what the inspector shows the row as, its measures
 * among them — and the resource's own row where none of its kinds draws on it,
 * its kinds landing a step beneath it (U1). Such a row draws none of the
 * kinds' ways, so no event lands on it: its `draw` is none of theirs.
 *
 * @param id - The row's id
 * @param landings - The series the event kinds land on
 * @returns The resource it stands beneath; `undefined` for a row of no landing's series
 */
export function landingSeriesTargetOf(id: PlanRowId, landings: readonly PlanLandingValue[]): PlanLandingTarget | undefined {
    if (id.type !== "entry") return undefined;
    const { series, path } = id.value;
    const key = resourceKeyOf(id);
    if (key === undefined) return undefined;
    const landing = landings.find((l) => l.series.some((s) => stringEqual(s, series)) || (l.draws.length === 0 && stringEqual(l.key, series)));
    return landing === undefined ? undefined : { kind: "resource", landing, key, path, draw: "" };
}

/**
 * The id of the row a kind's events draw on, for what a row stands for: the
 * resource's row of the way the kind draws, or the kind's own Unassigned row.
 *
 * @param kind - The event kind
 * @param target - What the row stands for
 * @returns The row's id; `undefined` for a resource of a landing the kind's way of drawing has no row on
 */
export function kindRowId(kind: Pick<PlanEventKindValue, "key" | "draw">, target: PlanLandingTarget): PlanRowId | undefined {
    if (target.kind === "unassigned") return landingRowId(`${kind.key}.unassigned`, [kind.draw.type]);
    const series = drawSeries(target.landing, kind.draw.type);
    return series === undefined ? undefined : landingRowId(series, target.path);
}

/**
 * The row an event stands on, as a drop's candidate names it (#1541, U7): its
 * resource's own landing row, whichever row beside it its kind draws on — the
 * row the canvas holds, or, where it holds none and the resource is one of
 * the canvas's own entries, the row its key names, in view or not — and, on
 * no resource, its kind's Unassigned row.
 *
 * A resource beneath a row the canvas has not read has no row to name: its
 * place among the rows is not known, so the candidate's `row` is none.
 *
 * @param kind - The event's kind
 * @param resource - The resource the event is on: its landing series and its key's text; none for an event on none
 * @param held - The resource's landing row's id, where the canvas holds the row
 * @param landings - The series the event kinds land on
 * @returns The row's id; `undefined` where it cannot be told
 */
export function eventRowId(
    kind: Pick<PlanEventKindValue, "key" | "draw">, resource: option<{ readonly kind: string; readonly key: string }>, held: PlanRowId | undefined,
    landings: readonly PlanLandingValue[],
): PlanRowId | undefined {
    if (resource.type === "none") return landingRowId(`${kind.key}.unassigned`, [kind.draw.type]);
    if (held !== undefined) return held;
    const landing = landings.find((one) => stringEqual(one.key, resource.value.kind));
    return landing?.top === true ? landingRowId(landing.key, [resource.value.key]) : undefined;
}

/**
 * The id of a resource's landing row: the row that names it.
 *
 * @param landing - The landing series' key
 * @param path - The row's path, its resource's key last
 * @returns The row's id
 */
export function landingRowId(landing: string, path: readonly string[]): PlanRowId {
    return variant("entry", { series: landing, path: [...path] }) as PlanRowId;
}

/**
 * The resource a landing row's events are read by (#1541, U1): its own — the last step of its path, under its
 * landing's key — or, for a row of a landing standing beneath another, which a kind's `child` lands on, the resource
 * it stands beneath: the step before the last, under that landing's key. An event kind's cells are its resource's,
 * whichever of the resource's rows draws them; a page that draws no row of the resource's own (`row: false`) reads
 * them by the rows beneath it.
 *
 * @param landing - The landing series the row is of
 * @param path - The row's path
 * @returns The resource, by its slot and its key's text; `undefined` for a path too short to name one
 */
export function readResourceOf(landing: PlanLandingValue, path: readonly string[]): { readonly slot: string; readonly key: string } | undefined {
    const beneath = landing.under.type === "some";
    const key = path[path.length - (beneath ? 2 : 1)];
    return key === undefined ? undefined : { slot: beneath ? landing.under.value : landing.key, key };
}

/**
 * The resource a resource's row stands for, as an event names it (#1541, U1) — by {@link readResourceOf}: the row's
 * own, or the one it stands a step beneath — and there the child's key its events name.
 *
 * @param target - The row's landing series and its path
 * @returns The resource and the child's key beneath it; `undefined` for a path too short to name one
 */
export function landingResourceOf(target: { readonly landing: PlanLandingValue; readonly path: readonly string[] }):
    { readonly ref: { readonly kind: string; readonly key: string }; readonly beneath: string | undefined } | undefined {
    const at = readResourceOf(target.landing, target.path);
    if (at === undefined) return undefined;
    return { ref: { kind: at.slot, key: at.key }, beneath: target.landing.under.type === "some" ? target.path[target.path.length - 1] : undefined };
}

/** A row as {@link readPathOf} walks it: its id, and its parent's key. */
type PathRow = Pick<PlanRowValue, "id" | "parent">;

/** The path of a row that stands for no resource. */
const NO_PATH: readonly string[] = [];

/**
 * A row's path to the resource its events are read by ({@link readResourceOf}): the path of the nearest landing row at
 * or above it — a row of a landing's own series, or of a further way its kinds draw — which ends in its resource's key,
 * less its last step for a landing standing beneath another (#1541, U1). So a landing row's path is its own, and any
 * row beneath one, a row a step beneath a resource's among them, has the resource's. A row with no landing row at or
 * above it stands for no resource: a group's own row, or a row of a series no kind lands on. Its path is none, as a row
 * of no entry's is, and its events are read by no resource (#1711).
 *
 * @param row - The row: its id and its parent's key
 * @param landings - The series the event kinds land on
 * @param rowOf - A row by its key: what its parents are found by
 * @returns The path, the resource's key last; empty for a row that stands for no resource
 */
export function readPathOf(row: PathRow, landings: readonly PlanLandingValue[], rowOf: (key: string) => PathRow | undefined): readonly string[] {
    for (let at: PathRow | undefined = row; at !== undefined && at.id.type === "entry";) {
        const { series, path } = at.id.value;
        // A landing's own series is its rows', whether or not a kind draws on them: every kind may land a step beneath.
        const landing = landings.find((l) => stringEqual(l.key, series) || l.draws.some((d) => stringEqual(series, drawSeries(l, d.type)!)));
        if (landing !== undefined) return landing.under.type === "some" ? path.slice(0, -1) : path;
        at = at.parent.type === "some" ? rowOf(at.parent.value) : undefined;
    }
    return NO_PATH;
}

/**
 * The resource a landing's row names, by the row's id ({@link landingRowId}'s inverse): the last step of its path, as a
 * landing row's path ends in its resource's key — and a row beside it for a further way its kinds draw, or one of its
 * series beneath it, at the same path.
 *
 * @param id - The row's id
 * @returns Its resource's key's text; `undefined` for a row with no path, or none of an entry's
 */
export function resourceKeyOf(id: PlanRowId): string | undefined {
    return id.type === "entry" ? id.value.path[id.value.path.length - 1] : undefined;
}
