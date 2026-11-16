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

import { StringType, equalFor, variant, type ValueTypeOf } from "@elaraai/east";
import type { PlanLandingType, PlanPayloadType } from "@elaraai/e3-ui/internal";
import type { PlanRowId } from "../model.js";

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
 * among them. Such a row draws none of the kinds' ways, so no event lands on
 * it: its `draw` is none of theirs.
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
    const landing = landings.find((l) => l.series.some((s) => stringEqual(s, series)));
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
export function kindRowId(kind: PlanEventKindValue, target: PlanLandingTarget): PlanRowId | undefined {
    if (target.kind === "unassigned") return variant("entry", { series: `${kind.key}.unassigned`, path: [kind.draw.type] }) as PlanRowId;
    const series = drawSeries(target.landing, kind.draw.type);
    return series === undefined ? undefined : variant("entry", { series, path: [...target.path] }) as PlanRowId;
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
