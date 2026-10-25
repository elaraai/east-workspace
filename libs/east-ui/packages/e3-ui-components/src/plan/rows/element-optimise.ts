/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a run of the app's optimiser left on the canvas's elements (#1409,
 * #1419; `Optimise Spec.md` §8, §9.5, R15–R17): the canvas hands its elements
 * the operation on each event the runs changed, by the element's key — a bar
 * added, a bar changed — and each row the ghosts of what stood on it before a
 * run: an event the run removed, struck through where it stood, or moved,
 * dashed where it was. An element asks for its own, as it asks whether its
 * event is drafted (`element-draft.ts`); a row asks for its ghosts, drawn
 * while the highlight is on. The `optimise` recipe draws both from the
 * attributes they set (`data-op`, `data-fill`).
 *
 * @packageDocumentation
 */

import { createContext, useContext } from "react";
import type { PlanInstantValue } from "../instant.js";

/** One operation a run left on an event, as its element draws and says it. */
export interface PlanElementOp {
    /** The event was added to the canvas, or changed on it. */
    readonly op: "add" | "chg";
    /** The run's number, formatted. */
    readonly run: string;
    /** What the element says on hover: `Added by Elara · run #7`, `Was Mon 09:00–17:00 · Press A1 · Elara run #7`. */
    readonly provenance: string;
}

/** A ghost a run left on a row (R15): where an event it removed or moved stood before it. */
export interface PlanGhost {
    /** The element's key: its event's ref, as East prints it. */
    readonly key: string;
    /** Removed, struck through; or moved, dashed where it was. */
    readonly op: "del" | "from";
    /** The run's number, formatted. */
    readonly run: string;
    /** Where it stood: its extent on the axis — one instant twice for a tile or a mark. */
    readonly start: PlanInstantValue;
    readonly end: PlanInstantValue;
    /** What it said. */
    readonly label: string;
    /** How the row drew it: a bar or a chip spans; a tile or a mark is an instant. */
    readonly shape: "span" | "instant";
}

/** What the runs left, as the canvas hands it to its rows and elements. */
export interface PlanOptimisedMarks {
    /** Each operation, by the element's key. */
    readonly ops: ReadonlyMap<string, PlanElementOp>;
    /** Each row's ghosts, by the row's key. */
    readonly ghosts: ReadonlyMap<string, readonly PlanGhost[]>;
    /** Whether the highlight is on (R16): the ghosts show for it alone. */
    readonly lit: boolean;
}

/** No run has left anything. */
const NONE: PlanOptimisedMarks = { ops: new Map(), ghosts: new Map(), lit: false };
const NO_GHOSTS: readonly PlanGhost[] = [];

/** What the runs left on the canvas — nothing outside a Plan whose optimiser has run. */
export const PlanOptimisedContext = createContext<PlanOptimisedMarks>(NONE);

/**
 * The operation a run left on an element's event, if any: what its element
 * draws (`data-op`) and says on hover.
 *
 * @param key - The element's key
 * @returns The operation; `undefined` for an event no run changed
 */
export function usePlanElementOp(key: string): PlanElementOp | undefined {
    return useContext(PlanOptimisedContext).ops.get(key);
}

/**
 * The ghosts a row draws while a run's highlight is on (R15): where the events
 * a run removed or moved stood on it.
 *
 * @param rowKey - The row's key
 * @returns Its ghosts; none outside the highlight
 */
export function usePlanRowGhosts(rowKey: string): readonly PlanGhost[] {
    const marks = useContext(PlanOptimisedContext);
    return marks.lit ? marks.ghosts.get(rowKey) ?? NO_GHOSTS : NO_GHOSTS;
}
