/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's toolbar items (#1245, `Flowchart Builder Spec.md` §7.1,
 * FB8, FB9; `Flowchart Records Spec.md` R17, R42) — every control the
 * flowchart has, as items of its frame's one toolbar, in this order: find
 * state, LR · TD, the zoom — Zoom out, Zoom in and Fit, the strip the
 * Schematic draws (`shared/schedule/zoom.tsx`) — and the freshness chip at the
 * row's start; the rail over the flowchart's `Slice.bindRecords` (#1346) at
 * its end — each source's fields in source order, the presets, and one summary
 * counting each source — and last the history item over the records' one
 * history, where the flowchart edits (#1503). The canvas draws no eyebrow of
 * its own. Every word the items say is the Flowchart's message table's.
 *
 * They fold on one ladder: the rail first, in its own order (#952) — its
 * fields into their summary chips, then one chip, then its icon, and its
 * summary after every step of the rail (`SUMMARY_RANK`) — then the freshness
 * chip goes, LR · TD folds into one chip naming the orientation, whose menu
 * holds both, and find state's box folds to its icon, which opens the box in
 * the edit popover; then, one move, the zoom's strip folds into find state's
 * popover, the View — and with a rail LR · TD with it, so a phone's row keeps
 * the rail and Save. A flowchart with no state to find keeps its strip. The
 * history item's step (`DEFAULT_RANK`) comes after all of them. Nothing wraps,
 * scrolls or goes to a second row, and on a coarse pointer every control is a
 * 44px target by its box or by its halo, the row's height its own. On a
 * phone, where find state is Search Records, the View is a button of its own
 * beside it, holding the strip — and LR · TD with a rail — which leave the
 * row, as the Schematic's tools and zoom do.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box, useRecipe, type SystemStyleObject } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import { HOST_RANK, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { useKeySearchToolbarItem, type KeySearchSource, type ToolbarItem } from "@elaraai/east-ui-components";
import { Seg, SegMenu } from "../shared/schedule/segments.js";
import { ZoomStrip, type ZoomRange } from "../shared/schedule/zoom.js";
import type { FlowchartWords } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** The canvas's orientation: left to right, or top down. */
export type FlowchartOrientation = "LR" | "TD";

/**
 * The Flowchart's own fold ranks, after every step of the slice rail's
 * (#952): the freshness chip goes, LR · TD folds into its chip, find state
 * into its icon, and last the zoom's strip — with a rail, LR · TD with it —
 * into find state's View. The history item's step (`DEFAULT_RANK`) comes
 * after them.
 */
export const FLOWCHART_RANK = {
    freshness: HOST_RANK,
    orientation: HOST_RANK + 1,
    seek: HOST_RANK + 2,
    controls: HOST_RANK + 3,
} as const;

/** The bundle the zoom's strip folds into find state's View in — with a rail, LR · TD with it: one move. */
export const FLOWCHART_CONTROLS = "flowchart.controls";

/** LR · TD's segments, in order. */
const ORIENTATIONS: ReadonlyArray<{ key: FlowchartOrientation; label: string }> = [
    { key: "LR", label: "LR" },
    { key: "TD", label: "TD" },
];

/** What the freshness chip says: the evidence the flow was drawn from, and when. */
export interface FlowchartFreshness {
    /** Its label (`scans-2026.09`). */
    readonly label: string;
    /** Its stamp, when it has one. */
    readonly date: Date | undefined;
}

/** What the Flowchart's toolbar items show and drive. */
export interface FlowchartToolbarProps {
    /** The `flowchart` recipe's styles: the freshness chip's dot. */
    readonly styles: Styles;
    /** Find state's source (`find.ts`) — `undefined` with no state to seek. */
    readonly find: KeySearchSource | undefined;
    /** The canvas's orientation. */
    readonly orientation: FlowchartOrientation;
    /** Turns the canvas. */
    readonly onOrientation: (orientation: FlowchartOrientation) => void;
    /** The freshness chip — `undefined` when the flowchart has none. */
    readonly freshness: FlowchartFreshness | undefined;
    /** The Flowchart's words: the items' labels, and the formatters the chip's date prints with, in the app's locale. */
    readonly words: FlowchartWords;
    /** The history item over the records' one history (`historyToolbarItem`) — where the flowchart edits; `undefined` where it does not. */
    readonly history?: ToolbarItem | undefined;
    /** The rail (#1346): one over the flowchart's `Slice.bindRecords`, its affordances and its persistence; `undefined` with no slice. */
    readonly chrome?: ValueTypeOf<RecordSlicesChromeType> | undefined;
    /** What the rail's summary counts each source in, by its name — `states`, `state cards`, `owners`. */
    readonly nouns?: Readonly<Record<string, string>> | undefined;
    /** Where the canvas's zoom stands (R42): at Fit Zoom out is off, at the cards' own size Zoom in. */
    readonly zoom: ZoomRange;
    /** Zooms the canvas about its middle by a factor. */
    readonly onZoom: (factor: number) => void;
    /** Puts the whole flowchart in view. */
    readonly onFit: () => void;
}

/**
 * The Flowchart's toolbar items, in §7.1's order and on its fold ladder (see
 * the module docs) — for its frame's one toolbar.
 *
 * @param props - What the items show and drive
 * @returns The items, a falsy entry for each the flowchart has no use for
 */
export function useFlowchartToolbarItems({
    styles, find, orientation, onOrientation, freshness, words, history, chrome, nouns, zoom, onZoom, onFit,
}: FlowchartToolbarProps): ReadonlyArray<ToolbarItem | false | undefined> {
    // Find state: its box, or its icon, which opens the box, on a row short of room — and last its popover, the View,
    // holding the zoom's strip over its box — and, beside a rail, LR · TD — the strip and the orientation's chip gone in
    // the same move. On a phone the View is a button of its own beside Search Records.
    const folds = find !== undefined;
    const combine = chrome !== undefined && folds;
    const m = words.m;
    const turn = m.orientationLabel();
    // The View, made again only as what it shows moves: the item it gives the row is then the same (#1398, CL9).
    const compact = useMemo(() => (find === undefined ? undefined : {
        label: m.viewLabel(),
        controls: (
            <Box css={styles.toolbarControls} data-flowchart-view="">
                {combine && <Seg label={turn} name="orientation" scope="flowchart" items={ORIENTATIONS} active={orientation} onPick={onOrientation} fullWidth />}
                <ZoomStrip scope="flowchart" words={m} range={zoom} onZoom={onZoom} onFit={onFit} fullWidth />
            </Box>
        ),
        phoneView: true,
    }), [find, m, styles.toolbarControls, combine, turn, orientation, onOrientation, zoom, onZoom, onFit]);
    const seek = useKeySearchToolbarItem(find, { rank: FLOWCHART_RANK.seek, label: m.findLabel(), compact });
    // The zoom's strip in the row: Zoom out, Zoom in and Fit (R42).
    const strip = <ZoomStrip scope="flowchart" words={m} range={zoom} onZoom={onZoom} onFit={onFit} />;
    // The rail (#1346): one over every source of the flowchart's slice, each counted in its own noun.
    const rail = useRecordSlicesToolbarItems(chrome?.slice, {
        ...(nouns === undefined ? {} : { nouns }),
        ...(chrome === undefined ? {} : { affordances: chrome.affordances.map((a) => a.type) }),
        ...(chrome?.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
    // The freshness chip: the shared chip, its dot first and its date muted after its label.
    const chipRecipe = useRecipe({ key: "chip" });
    const chip = freshness === undefined ? undefined : (
        <Box as="span" css={chipRecipe({ tone: "neutral", numeric: true })} data-flowchart-freshness="">
            <Box as="span" css={styles.freshnessDot} />
            <Box as="span">{freshness.label}</Box>
            {freshness.date !== undefined && <Box as="span" data-chip-meta="">{words.monthDay(freshness.date)}</Box>}
        </Box>
    );
    return [
        seek !== undefined ? { ...seek, rank: [FLOWCHART_RANK.seek, FLOWCHART_RANK.controls], bundle: [undefined, FLOWCHART_CONTROLS] } : seek,
        {
            key: "orientation",
            rank: combine ? [FLOWCHART_RANK.orientation, FLOWCHART_RANK.controls] : FLOWCHART_RANK.orientation,
            bundle: combine ? [undefined, FLOWCHART_CONTROLS] : undefined,
            forms: [
                <Seg label={turn} name="orientation" scope="flowchart" items={ORIENTATIONS} active={orientation} onPick={onOrientation} />,
                <SegMenu label={turn} name="orientation" scope="flowchart" items={ORIENTATIONS} active={orientation} onPick={onOrientation} />,
                ...(combine ? [null] : []),
            ],
            // On a phone, in the View beside Search Records.
            ...(combine ? { phone: { form: null } } : {}),
        },
        {
            key: "zoom",
            rank: FLOWCHART_RANK.controls,
            bundle: FLOWCHART_CONTROLS,
            forms: folds ? [strip, null] : [strip],
            // On a phone, in the View beside Search Records.
            ...(folds ? { phone: { form: null } } : {}),
        },
        chip !== undefined && { key: "freshness", rank: FLOWCHART_RANK.freshness, forms: [chip, null] },
        ...rail,
        history,
    ];
}
