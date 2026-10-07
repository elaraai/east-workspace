/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart (#1243): the state-transition flowchart, e3-ui's as the Plan
 * (#1177) and the Sheet (#1179) are. `<Flowchart>` takes the props east-ui's
 * took, and returns the flowchart's root through the `Flowchart` carrier,
 * which e3-ui-components' renderer draws.
 *
 * - `types.ts` — the row, closed-set and event types (`Flowchart.Types.*`).
 * - `root.ts` — the root, `<Flowchart>`'s props, the carrier and the
 *   factories.
 * - `flowchart.ts` — the tag.
 *
 * @packageDocumentation
 */

import { FlowchartTag, type FlowchartTagType } from "./flowchart.js";
import { FlowchartComponent, FlowchartTypes, createFlowchartPayload, createFlowchartRoot } from "./root.js";

export { FlowchartTag, type FlowchartTagType } from "./flowchart.js";
export {
    FlowchartComponent,
    FlowchartRootType,
    FlowchartTypes,
    createFlowchartPayload,
    createFlowchartRoot,
    type RowElement,
    type FlowchartConfig,
    type FlowchartStateFields,
    type FlowchartLinkFields,
    type FlowchartLaneFields,
    type FlowchartTriggerFields,
    type FlowchartEvidenceFields,
    type FlowchartFreshnessInput,
    type FlowchartLaneLiteral,
    type FlowchartLinkKindLiteral,
    type FlowchartOrientationLiteral,
    type FlowchartLinkModeLiteral,
} from "./root.js";

/**
 * The type of the {@link Flowchart} namespace: `<Flowchart>`, and the East
 * types a flowchart is written with.
 */
export interface FlowchartNamespace extends FlowchartTagType {
    /** East types for flowchart rows, closed-set fields and events ({@link FlowchartTypes}). */
    Types: typeof FlowchartTypes;
}

/**
 * `<Flowchart>` — a self-contained state-transition flowchart: states as
 * nodes in ordered phase lanes (the layout derived, no coordinates),
 * H/V-routed transition arrows, optional per-link decision triggers
 * (lettered diamonds) and evidence-weighted strokes — all from flat data
 * tables: `states`, `links` and `lanes`, and optionally `triggers`, each
 * with a row mapper (`state`, `link`, `lane`, `trigger`) unless its rows are
 * already `Flowchart.Types.*`. Hover cards, the selection inspector and the
 * pointer-highlight grammar are built in; view lenses are saved slice
 * cohorts, never props.
 *
 * Interaction is opt-in per channel: selection (`onSelectState`,
 * `onSelectLink`, `onSelectTrigger`), path tracing (`onTracePath`), link
 * authoring (`linkMode`, `onCreateLink`, `onDeleteLink`, `canConnect`), lane
 * and state editing (`onAddLane`, `onRenameLane`, `onDeleteLane`,
 * `onAddState`, `onEditState`, `onMoveState`) and the bound slice (`slice`,
 * `affordances`). With no callbacks bound it is a read-only picture.
 *
 * It moved here from east-ui (#1243): a surface that wrote east-ui's
 * `<Flowchart>` imports `Flowchart` from `@elaraai/e3-ui`, its props as they
 * were. The closed-set fields in data (`kind`, `orientation`, `linkMode`)
 * are typed variant values, `Flowchart.Types.*`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East, variant } from "@elaraai/east";
 * import { UIComponentType } from "@elaraai/east-ui";
 * import { Flowchart } from "@elaraai/e3-ui";
 *
 * const flowchart = East.function([], UIComponentType, ($) => {
 *     const states = $.const([
 *         { code: "ARV", name: "Arrived", phase: "intake" },
 *         { code: "SCN", name: "Scanned", phase: "intake" },
 *         { code: "SRT", name: "Sorting", phase: "sort" },
 *         { code: "SRD", name: "Sorted", phase: "sort" },
 *         { code: "LDD", name: "Loaded", phase: "dispatch" },
 *         { code: "DSP", name: "Dispatched", phase: "dispatch" },
 *     ]);
 *     const planned = variant("planned", null);
 *     const observed = variant("observed", null);
 *     const links = $.const([
 *         { src: "ARV", dst: "SCN", kind: planned },
 *         { src: "SCN", dst: "SRT", kind: planned },
 *         { src: "SRT", dst: "SRD", kind: planned },
 *         { src: "SRD", dst: "LDD", kind: planned },
 *         { src: "LDD", dst: "DSP", kind: observed },
 *     ]);
 *     return (
 *         <Flowchart
 *             states={states} state={s => ({ key: s.code, label: s.name, lane: s.phase })}
 *             links={links} link={l => ({ from: l.src, to: l.dst, kind: l.kind })}
 *             lanes={[{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "dispatch", label: "Dispatch" }]}
 *         />
 *     );
 * });
 * ```
 */
export const Flowchart: FlowchartNamespace = Object.assign(FlowchartTag, { Types: FlowchartTypes });

/**
 * The type of the internal Flowchart namespace — the public one, the factory
 * the tag maps to, the root it returns through its carrier, and the carrier
 * the renderer registers against.
 */
export interface FlowchartInternalNamespace extends FlowchartNamespace {
    /** Creates the flowchart — its root, through the `Flowchart` carrier (the `<Flowchart>` tag's factory, {@link createFlowchartRoot}). */
    Root: typeof createFlowchartRoot;
    /** Creates the flowchart's root alone — what `Root` returns through the carrier ({@link createFlowchartPayload}). */
    Payload: typeof createFlowchartPayload;
    /** The `Flowchart` carrier ({@link FlowchartComponent}). */
    Component: typeof FlowchartComponent;
}

/** `<Flowchart>`, for the internal namespace: the tag, on an object of its own, so the public `Flowchart` carries none of the internal members. */
function FlowchartInternalTag(props: Parameters<FlowchartTagType>[0]): ReturnType<FlowchartTagType> {
    return FlowchartTag(props);
}

/**
 * The internal Flowchart namespace — `@elaraai/e3-ui/internal`'s `Flowchart`:
 * the public one, `Flowchart.Root`, `Flowchart.Payload` and the `Flowchart`
 * carrier, for the renderer and the tests.
 *
 * @internal
 */
export const FlowchartInternal: FlowchartInternalNamespace = Object.assign(FlowchartInternalTag as FlowchartTagType, {
    Types: FlowchartTypes,
    Root: createFlowchartRoot,
    Payload: createFlowchartPayload,
    Component: FlowchartComponent,
});
