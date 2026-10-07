/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Flowchart.library` — the flowchart's library pane (`Flowchart Builder
 * Spec.md` §4.2, decision 5): `library` lists the pane's tabs, in order, each
 * a `Flowchart.library.*` call. Left out, or empty, the flowchart has no
 * library pane.
 *
 * `Flowchart.library.flows()` (#1246) is the Flows tab: every flow the
 * flowchart holds by name, a click opening one on the canvas, and "+ New
 * flow" naming another. Over one flow there is none to list, so one flow's
 * library takes every tab but it. The tabs on the wire, and their refusals,
 * are `payload.ts`'s.
 *
 * @packageDocumentation
 */

/** One tab of the library pane — what each `Flowchart.library.*` call returns, and `library` lists. */
export type FlowchartLibraryTab = { readonly kind: "flows" };

/**
 * The tabs a flowchart over one flow may list: every tab but the Flows tab,
 * which lists flows by name — one flow has none to list (FB16).
 */
export type FlowchartOneFlowLibraryTab = Exclude<FlowchartLibraryTab, { readonly kind: "flows" }>;

/**
 * The Flows tab — `Flowchart.library.flows()` (FB13, FB14): every flow the
 * flowchart holds, by name, each card its name and its description — or, with
 * none, its counts — the open flow placed, and a flow whose drafts are not
 * yet applied marked Pending. A click opens a flow on the canvas, and the
 * tab's search reads names and descriptions. Where the flowchart edits — a
 * record, and not read only — "+ New flow" names another, refusing a name the
 * flowchart holds, and opens it empty, one lane, as a draft the history item
 * commits or discards.
 *
 * @remarks
 * Over a record of flows, or the host's flows by name. Over one flow (`data`
 * of `Flowchart.Types.Flow`) it is refused, when the surface is built and by
 * the tag's types.
 *
 * @returns The tab
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Flowchart, Record } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const depotFlows = e3.record("flowchart_depot_flows", Flowchart.Types.Flows, Flowchart.values({
 *     "Inbound parcels": {
 *         description: "From the trailer to the van",
 *         lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "load", label: "Load" }],
 *         states: [
 *             { key: "ARV", label: "Arrived", lane: "intake" },
 *             { key: "SCN", label: "Scanned", lane: "intake" },
 *             { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n },
 *             { key: "LDD", label: "Loaded", lane: "load" },
 *         ],
 *         links: [
 *             { from: "ARV", to: "SCN" },
 *             { from: "SCN", to: "CH*", trigger: "route" },
 *             { from: "CH*", to: "LDD" },
 *             { from: "SCN", to: "SCN", kind: "observed" },
 *         ],
 *         triggers: [{ key: "route", label: "route", owner: "sort-planner" }],
 *     },
 *     "Returns": {
 *         description: "From the counter back to the sender",
 *         lanes: [{ key: "counter", label: "Counter" }, { key: "check", label: "Check" }, { key: "out", label: "Out" }],
 *         states: [
 *             { key: "RCV", label: "Received", lane: "counter" },
 *             { key: "INS", label: "Inspected", lane: "check" },
 *             { key: "RSD", label: "Resent", lane: "out" },
 *         ],
 *         links: [{ from: "RCV", to: "INS" }, { from: "INS", to: "RSD" }, { from: "INS", to: "BIN", kind: "observed" }],
 *     },
 * }));
 * export const depotFlowsPatch = e3.mutation.patch(depotFlows);
 *
 * const flowchart = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const flows = $.let(Record.bind(depotFlows, [depotFlowsPatch]));
 *         return (
 *             <Box height="500px">
 *                 <Flowchart record={flows} flow="Inbound parcels" library={[Flowchart.library.flows()]} />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function libraryFlows(): FlowchartLibraryTab {
    return { kind: "flows" };
}

/** The library pane's tabs — `Flowchart.library`. */
export interface FlowchartLibrary {
    /** The Flows tab: every flow by name, a click opening one, and "+ New flow" ({@link libraryFlows}). */
    flows: typeof libraryFlows;
}

/** The library pane's tabs, each a factory (`Flowchart.library`). */
export const FlowchartLibraryFactories: FlowchartLibrary = {
    flows: libraryFlows,
};
