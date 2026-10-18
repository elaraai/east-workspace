/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The narrowing's chrome and the one shared scale (§3/§8, #1344).
 *
 * A Plan's narrowing is one `Slice.bindRecords` (`root/sources.ts`): its
 * `rows` source gives the canvas its rows, and each event kind narrowed
 * through a source of its own reads its events through it. The window is the
 * sources' shared `range`: every source whose range field speaks the axis's
 * arm holds it, the first leading. The leading source's window is the
 * canvas's; with none — a choice that replaced it, a preset, Clear all — the
 * window last shown stands, and before any, the axis's stated window. A source
 * that does not hold the window takes it, unless writing it would replace a
 * choice of the source's own, which the reader made knowingly: the range
 * editor said so. The rows never set the window (#822).
 *
 * The resolution is the leading source's, written to each source holding the
 * window (`controller/effects.ts`); a record's resolution only re-buckets the
 * canvas, so zooming fetches nothing.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useState } from "react";
import { getSomeorUndefined, useSlicesReactivity } from "@elaraai/east-ui-components";
import { recordSliceWindow, recordSliceWindowFits, setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { resolveScale, type PlanAxisValue } from "../axis.js";
import type { PlanScale } from "../scale.js";
import type { PlanAxisKind } from "../instant.js";
import type { PlanRootValue } from "../model.js";
import type { PlanWords } from "../words.js";
import { planSlices, planWindowParts, type PlanSlicesChrome, type PlanSourcePart } from "./sources.js";

/** A source holding the window: its name, and its part of the slice. */
export interface PlanWindowPart {
    readonly source: string;
    readonly part: PlanSourcePart;
}

/**
 * The window a canvas last read from its leading source, held while no
 * source holds one — one per canvas, shared by its render and its
 * controller's effects, so a pan moves the window the reader sees.
 */
export interface PlanWindowHold {
    /** The leading source's last window, `[from, to)` on the axis's domain; `undefined` before any. */
    last: readonly [number, number] | undefined;
}

/**
 * A window hold for a canvas.
 *
 * @returns An empty hold
 */
export function createPlanWindowHold(): PlanWindowHold {
    return { last: undefined };
}

/** The canvas's narrowing chrome and scale. */
export interface PlanWindow {
    /** The rail's chrome; `undefined` with no slice. */
    chrome: PlanSlicesChrome | undefined;
    /** The sources holding the window, in the slice's order. */
    windowParts: readonly PlanWindowPart[];
    /** The leading one: its range editor is the time navigator's Range panel. */
    lead: PlanWindowPart | undefined;
    /** The rail's affordance kinds. */
    affordances: readonly string[];
    /** The shared scale, or `undefined` when no window resolves. */
    scale: PlanScale | undefined;
    /** Why the window could not be written to a source: its indexes answer none beside its choices. */
    error: string | undefined;
}

/** Whether a source's window speaks the axis's arm. */
function fits(kind: "datetime" | "integer" | "float", axis: PlanAxisKind): boolean {
    return axis === "time" ? kind === "datetime" : axis === "number" && kind !== "datetime";
}

/**
 * The leading window among the sources holding one: the first that holds a
 * window of the axis's arm, `[from, to)` on the axis's domain.
 *
 * @param parts - The sources holding the window
 * @param axis - The axis kind
 * @returns Its window; `undefined` while none holds one
 */
export function leadingWindow(parts: readonly PlanWindowPart[], axis: PlanAxisKind): readonly [number, number] | undefined {
    for (const { part } of parts) {
        const window = recordSliceWindow(part);
        if (window !== undefined && fits(window.kind, axis) && window.max > window.min) return [window.min, window.max];
    }
    return undefined;
}

/**
 * The axis's stated window on its own domain: what a canvas shows before any
 * source holds one.
 *
 * @param axis - The decoded root axis
 * @returns `[from, to)`; `undefined` for an ordinal axis, or one that states none
 */
export function statedWindow(axis: PlanAxisValue): readonly [number, number] | undefined {
    switch (axis.type) {
        case "time": {
            const w = getSomeorUndefined(axis.value.window);
            return w !== undefined ? [w.min.getTime(), w.max.getTime()] : undefined;
        }
        case "number": {
            const w = getSomeorUndefined(axis.value.window);
            return w !== undefined ? [w.min, w.max] : undefined;
        }
        case "ordinal":
            return undefined;
    }
}

/**
 * The resolution the slice holds: the leading source's, else the first
 * source's — a slice with no window holds it there.
 *
 * @param chrome - The rail's chrome
 * @param parts - The sources holding the window
 * @returns Its tag; `undefined` while it holds none
 */
export function slicedResolution(chrome: PlanSlicesChrome | undefined, parts: readonly PlanWindowPart[]): string | undefined {
    const part = parts[0]?.part ?? chrome?.slice.parts[0]?.slice;
    return part === undefined ? undefined : getSomeorUndefined(part.read().resolution)?.type;
}

/**
 * The narrowing's chrome and the scale every row positions against.
 *
 * @param value - The latest root (its slice's chrome)
 * @param data - The root's data-stable twin (its axis)
 * @param words - The canvas's words — the locale the ruler labels format in (#820)
 * @param hold - The canvas's window hold (see {@link PlanWindowHold})
 * @returns The chrome, the sources holding the window, and the scale
 */
export function usePlanWindow(value: PlanRootValue, data: PlanRootValue, words: PlanWords, hold: PlanWindowHold): PlanWindow {
    const chrome = useMemo(() => planSlices(value), [value]);
    const axis = data.axis.type;
    const windowParts = useMemo(() => planWindowParts(chrome, axis), [chrome, axis]);
    // Re-render on every write to a source: the window and the resolution are their state, whoever wrote them.
    const version = useSlicesReactivity(chrome?.slice.parts.map((p) => p.slice.key) ?? []);
    const affordances = useMemo(() => chrome?.affordances.map((a) => a.type) ?? [], [chrome]);
    // Read as numbers, never as the decoded state's objects, which are new every read: a memo keyed on them would
    // rebuild the scale — and hand every mounted row a new one — on every render (#812).
    const lead = leadingWindow(windowParts, axis);
    if (lead !== undefined) hold.last = lead;
    const from = (lead ?? hold.last)?.[0];
    const to = (lead ?? hold.last)?.[1];
    const resolution = slicedResolution(chrome, windowParts);
    // `resolveScale` owns the ladder: the sources' window ▸ the stated window, per axis kind. The rows are no input
    // (#822), so windows landing keep one scale rather than handing every mounted row a new one (#812).
    const scale = useMemo(() => resolveScale({
        axis: data.axis,
        sliceWindow: from === undefined || to === undefined ? undefined : [from, to],
        sliceResolution: resolution,
        words,
    }), [data.axis, from, to, resolution, words]);
    // Every source that does not hold the window yet takes it — a first mount, a range a choice replaced, or another
    // source's range written by the range editor — unless it would replace a choice of the source's own.
    const [error, setError] = useState<string>();
    const stated = statedWindow(data.axis);
    const targetFrom = from ?? stated?.[0];
    const targetTo = to ?? stated?.[1];
    useLayoutEffect(() => {
        if (targetFrom === undefined || targetTo === undefined || windowParts.length === 0) return;
        try {
            for (const { part } of windowParts) {
                const held = recordSliceWindow(part);
                if (held !== undefined && held.min === targetFrom && held.max === targetTo) continue;
                if (!recordSliceWindowFits(part)) continue;
                setRecordSliceWindow(part, targetFrom, targetTo);
            }
            setError(undefined);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The window could not be applied");
        }
        // `version` moves with every source's state: a range cleared or written there is followed here.
    }, [windowParts, targetFrom, targetTo, version]);
    const leadPart = windowParts[0];
    return useMemo(() => ({ chrome, windowParts, lead: leadPart, affordances, scale, error }),
        [chrome, windowParts, leadPart, affordances, scale, error]);
}
