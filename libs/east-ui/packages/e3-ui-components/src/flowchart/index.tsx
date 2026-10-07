/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraFlowchart` — the Flowchart (#1243, #1244, #1245,
 * `Flowchart Builder Spec.md` §7, §7.1, §8, FB7–FB11): the one flowchart,
 * laid out in `BuilderFrame` wherever it is used. There is no other
 * flowchart: no canvas without the frame, and no toolbar but its one.
 *
 * It registers itself against the `Flowchart` extension (`Flowchart.Component`)
 * as the module loads. Its payload carries where the flows come from — a
 * record of flows by name, or the host's flows or flow — and the canvas's
 * options: the flowchart reads the flows (a record's where it renders, and
 * again when it moves), opens one, and the frame places its parts in its
 * regions, over one shared state — the open flow's model, the orientation and
 * the state find state picked:
 *
 * - **the toolbar** — the flowchart's items (`useFlowchartToolbarItems`,
 *   `toolbar.tsx`) on the frame's one folding row, in §7.1's order: find
 *   state, LR · TD and the freshness chip, and at the row's end the slice's
 *   rail over `data`. The canvas draws no eyebrow;
 * - **main** — the canvas (`canvas.tsx`), filling main and scrolling both
 *   ways inside it;
 * - **the footer** — today's counts (`footer.tsx`): over many flows the open
 *   flow's name first, and over a record its last save;
 * - **the panes** — the library in the start pane when the payload's
 *   `library` lists a tab, and the inspector in the end pane when it is given
 *   `inspector`: optional props, no prop, no pane. The frame places them; what
 *   each holds is its own (the Flows tab #1246, the templates and the
 *   author's tabs #1248, the inspector #1250). Their open tab and collapsed
 *   state persist under the flowchart's `name` (`flowchartKeys(name).frame`).
 *
 * The flowchart fills the box it is given and draws no border: a host gives it
 * a box of its own height. The editing session's banners, history item and
 * pending changes join the frame with #1247.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { StringType, compareFor, equalFor, equivalentFor, none, type ValueTypeOf, type option } from "@elaraai/east";
import type { Slice as SliceInternal } from "@elaraai/east-ui/internal";
import { Flowchart, flowchartKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView,
    BuilderFrame,
    getSomeorUndefined,
    implementUIComponent,
    useDataStable,
    useFormatters,
    useSliceReactivity,
    useTrackedEvaluation,
    type BuilderFrameDock,
} from "@elaraai/east-ui-components";
import { buildModel, type FlowchartCanvasValue, type FlowchartFlowValue, type FlowchartValue } from "./model.js";
import { FlowchartCanvasView, type FlowchartReveal } from "./canvas.js";
import { useFindState } from "./find.js";
import { FlowchartFooter, useLastSave } from "./footer.js";
import { useFlowchartToolbarItems, type FlowchartOrientation } from "./toolbar.js";

/** The memo's comparison: a changed callback re-renders. */
const payloadEqual = equivalentFor(Flowchart.Types.Payload);
/** The model's gate: only a change of the flow's data rebuilds it. */
const flowEqual = equalFor(Flowchart.Types.Flow);
/** Flows by name, in East's order. */
const nameOrder = compareFor(StringType);

export type { FlowchartValue, FlowchartCanvasValue, FlowchartFlowValue };

/** Props of {@link EastChakraFlowchart}. */
export interface EastChakraFlowchartProps {
    /** The payload, decoded. */
    value: FlowchartValue;
    /** The structural storage key. */
    storageKey: string;
}

/** The library pane's width open: the design system's 272px (§8). */
const LIBRARY_SIZE = "272px";

/** The inspector pane's width open: the design system's 320px (§8). */
const INSPECTOR_SIZE = "320px";

/** The flows a payload's source holds: many by name, or one. */
type FlowsHeld =
    | { readonly many: true; readonly flows: ValueTypeOf<typeof Flowchart.Types.Flows> }
    | { readonly many: false; readonly flow: FlowchartFlowValue };

/** A flow with nothing in it: the canvas over a record of flows that holds none. */
const NO_FLOW: FlowchartFlowValue = { description: none, lanes: [], states: [], links: [], triggers: [] };

/**
 * The flows a source holds: a record's flows by name, read — a reactive read,
 * which the flowchart's tracked evaluation follows — or the host's flows or
 * flow, as they came.
 *
 * @param source - The payload's source
 * @returns The flows by name, or the one flow
 */
function flowsHeld(source: FlowchartValue["source"]): FlowsHeld {
    switch (source.type) {
        case "record": return { many: true, flows: source.value.read() };
        case "data": return source.value.type === "flows"
            ? { many: true, flows: source.value.value.value }
            : { many: false, flow: source.value.value.value };
    }
}

/**
 * Over many flows, the open one and its name: the one `open` names, while the
 * flows hold it; else the first by name; else none (an empty record).
 *
 * @param flows - The flows by name
 * @param open - The flow the payload opens first
 * @returns The open flow and its name, or `undefined` when the flows hold none
 */
export function openFlow(flows: ValueTypeOf<typeof Flowchart.Types.Flows>, open: option<string>): { name: string; flow: FlowchartFlowValue } | undefined {
    if (open.type === "some") {
        const named = flows.get(open.value);
        if (named !== undefined) return { name: open.value, flow: named };
    }
    let first: string | undefined;
    for (const name of flows.keys()) {
        if (first === undefined || nameOrder(name, first) < 0) first = name;
    }
    if (first === undefined) return undefined;
    const flow = flows.get(first);
    return flow === undefined ? undefined : { name: first, flow };
}

/**
 * The library pane, when the payload's `library` lists a tab: the frame's
 * start pane, its tabs in the order listed. What each tab holds is its own
 * child's — the Flows tab #1246's, the templates and the author's tabs
 * #1248's.
 *
 * @param library - The tabs the payload lists
 * @returns The pane, or `undefined` when the library lists none
 */
function libraryPane(library: FlowchartValue["library"]): BuilderFrameDock | undefined {
    if (library.length === 0) return undefined;
    return {
        label: "Library",
        icon: "layer-group",
        size: LIBRARY_SIZE,
        persist: "local",
        tabs: library.map((tab) => {
            switch (tab.type) {
                case "flows": return { key: "flows", label: "Flows", body: null };
                case "states": return { key: "states", label: tab.value.name, body: null };
                case "transitions": return { key: "transitions", label: tab.value.name, body: null };
                case "tab": return { key: `tab.${tab.value.name}`, label: tab.value.name, body: null };
            }
        }),
    };
}

/** The inspector pane: the frame's end pane. What it holds is #1250's. */
const INSPECTOR_PANE: BuilderFrameDock = { label: "Inspector", icon: "sliders", size: INSPECTOR_SIZE, persist: "local", body: null };

/**
 * Renders the flowchart: reads its flows from the payload's source, opens one
 * over many, and lays it out in its frame — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The flowchart, in its frame
 */
export const EastChakraFlowchart = memo(function EastChakraFlowchart({ value, storageKey }: EastChakraFlowchartProps) {
    const styles = useSlotRecipe({ key: "flowchart" })();
    const source = value.source;
    // The flows, read where the flowchart renders, and again when they move.
    const read = useCallback(() => flowsHeld(source), [source]);
    const { result } = useTrackedEvaluation(read);
    if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        // The frame stays: its main says why, in the canvas's place.
        return (
            <Box css={styles.root} data-flowchart-root="">
                <BuilderFrame storageKey={flowchartKeys(getSomeorUndefined(value.name)).frame}>
                    <BannerView status="error" title={`The flows could not be read: ${message}`} />
                </BuilderFrame>
            </Box>
        );
    }
    const held = result.value;
    const open = held.many ? openFlow(held.flows, value.open) : { name: undefined, flow: held.flow };
    return <FlowchartFrame value={value} name={open?.name} flow={open?.flow ?? NO_FLOW} storageKey={storageKey} />;
}, (prev, next) => payloadEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link FlowchartFrame}. */
interface FlowchartFrameProps {
    /** The payload, decoded. */
    readonly value: FlowchartValue;
    /** The open flow's name, over many flows; `undefined` over one. */
    readonly name: string | undefined;
    /** The open flow. */
    readonly flow: FlowchartFlowValue;
    /** The structural storage key. */
    readonly storageKey: string;
}

/** The frame, its regions holding the flowchart's parts over one shared state. */
function FlowchartFrame({ value, name, flow, storageKey }: FlowchartFrameProps) {
    const styles = useSlotRecipe({ key: "flowchart" })();
    // The counts, the dates and the badges, in the app's locale (#850).
    const words = useFormatters();
    const canvas = value.canvas;
    const keys = useMemo(() => flowchartKeys(getSomeorUndefined(value.name)), [value.name]);
    // The open flow's model, the canvas's and the footer's — keyed on the
    // flow's DATA (#809): a closure-only change keeps it.
    const data = useDataStable(flow, flowEqual);
    const model = useMemo(() => buildModel(data, words), [data, words]);
    // LR · TD: the viewer's, seeded by the canvas's `orientation`, and again when the host's moves.
    const orientationDefault: FlowchartOrientation = getSomeorUndefined(canvas.orientation)?.type ?? "LR";
    const [orientation, setOrientation] = useState<FlowchartOrientation>(orientationDefault);
    useEffect(() => { setOrientation(orientationDefault); }, [orientationDefault]);
    // Find state over the open flow's states: a pick reveals the state on the canvas.
    const [reveal, setReveal] = useState<FlowchartReveal | null>(null);
    const onPick = useCallback((key: string) => { setReveal((was) => ({ key, seq: (was?.seq ?? 0) + 1 })); }, []);
    const findable = useMemo(() => data.states.map((s) => ({ key: s.key, label: getSomeorUndefined(s.label) })), [data]);
    const find = useFindState(findable, name ?? "", onPick);
    // The host's slice over the transitions it builds its flow from (over `data`).
    const sliceChrome = getSomeorUndefined(canvas.slice) as
        | { slice: ValueTypeOf<typeof SliceInternal.Types.Bind>; affordances: ReadonlyArray<{ type: string }> }
        | undefined;
    const slice = sliceChrome?.slice;
    const affordances = useMemo(() => sliceChrome?.affordances.map((a) => a.type) ?? [], [sliceChrome]);
    // The footer's counts read the slice's store: they follow it.
    useSliceReactivity(slice?.key);
    const total = slice !== undefined ? Number(slice.totalCount()) : undefined;
    const narrowed = slice !== undefined ? Number(slice.resultCount() ?? slice.totalCount()) : undefined;
    const freshnessValue = getSomeorUndefined(canvas.freshness);
    const freshness = useMemo(
        () => (freshnessValue === undefined ? undefined : { label: freshnessValue.label, date: getSomeorUndefined(freshnessValue.date) }),
        [freshnessValue]);
    const items = useFlowchartToolbarItems({ styles, find, orientation, onOrientation: setOrientation, freshness, slice, affordances, words });
    const saved = useLastSave(value.source, words);
    const start = useMemo(() => libraryPane(value.library), [value.library]);
    return (
        <Box css={styles.root} data-flowchart-root="" data-density={getSomeorUndefined(canvas.density)?.type}>
            <BuilderFrame
                storageKey={keys.frame}
                toolbar={items}
                start={start}
                end={value.inspector ? INSPECTOR_PANE : undefined}
                footer={
                    <FlowchartFooter styles={styles} name={name} links={flow.links.length}
                        narrowedFrom={total !== undefined && narrowed !== undefined && narrowed < total ? total : undefined}
                        counts={model.counts} saved={saved} words={words} />
                }
            >
                <FlowchartCanvasView canvas={canvas} model={model} orientation={orientation} reveal={reveal}
                    readOnly={value.readOnly} storageKey={storageKey} />
            </BuilderFrame>
        </Box>
    );
}

// =============================================================================
// Side-effect — register the renderer for the Flowchart extension on module load.
// =============================================================================

implementUIComponent(Flowchart.Component, EastChakraFlowchart);
