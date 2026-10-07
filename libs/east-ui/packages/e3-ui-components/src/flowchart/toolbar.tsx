/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's toolbar items (#1245, `Flowchart Builder Spec.md` §7.1,
 * FB8, FB9) — every control the flowchart has, as items of its frame's one
 * toolbar, in this order: find state, LR · TD and the freshness chip at the
 * row's start; the slice's rail over `data` at its end, and last the history
 * item over the open flow's session, where the flowchart edits (#1246). The
 * canvas draws no eyebrow of its own.
 *
 * They fold on one ladder: the rail first, in its own order (#952) — its
 * affordances into their summary chips, then one chip, then its icon — then
 * the freshness chip goes, LR · TD folds into one chip naming the
 * orientation, whose menu holds both, and find state's box folds to its icon,
 * which opens the box in the edit popover. The history item's step
 * (`DEFAULT_RANK`) comes after all of them. Nothing wraps, scrolls or goes
 * to a second row, and on a coarse pointer every control is a 44px target by
 * its box or by its halo, the row's height its own.
 *
 * @packageDocumentation
 */

import { Box, useRecipe, type SystemStyleObject } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { Slice } from "@elaraai/east-ui/internal";
import { HOST_RANK, useSliceToolbarItems } from "@elaraai/east-ui-components/internal";
import { useKeySearchToolbarItem, type Formatters, type KeySearchSource, type ToolbarItem } from "@elaraai/east-ui-components";
import { Seg, SegMenu } from "../shared/seg.js";

type Styles = Record<string, SystemStyleObject>;

/** The bound slice handle, decoded. */
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The canvas's orientation: left to right, or top down. */
export type FlowchartOrientation = "LR" | "TD";

/**
 * The Flowchart's own fold ranks, after every step of the slice rail's
 * (#952): the freshness chip goes, LR · TD folds into its chip, find state
 * into its icon. The history item's step (`DEFAULT_RANK`) comes after them.
 */
export const FLOWCHART_RANK = {
    freshness: HOST_RANK,
    orientation: HOST_RANK + 1,
    seek: HOST_RANK + 2,
} as const;

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
    /** Find state's source — `undefined` over a flow with no state. */
    readonly find: KeySearchSource | undefined;
    /** The canvas's orientation. */
    readonly orientation: FlowchartOrientation;
    /** Turns the canvas. */
    readonly onOrientation: (orientation: FlowchartOrientation) => void;
    /** The freshness chip — `undefined` when the flowchart has none. */
    readonly freshness: FlowchartFreshness | undefined;
    /** The slice over the transitions the host builds its flow from — over `data` alone. */
    readonly slice: SliceBindValue | undefined;
    /** The rail's affordances, in order. */
    readonly affordances: readonly string[];
    /** The formatters the chip's date prints with, in the app's locale. */
    readonly words: Formatters;
    /** The history item over the open flow's session (`historyToolbarItem`) — where the flowchart edits; `undefined` where it does not. */
    readonly history?: ToolbarItem | undefined;
}

/**
 * The Flowchart's toolbar items, in §7.1's order and on its fold ladder (see
 * the module docs) — for its frame's one toolbar.
 *
 * @param props - What the items show and drive
 * @returns The items, a falsy entry for each the flowchart has no use for
 */
export function useFlowchartToolbarItems({ styles, find, orientation, onOrientation, freshness, slice, affordances, words, history }: FlowchartToolbarProps): ReadonlyArray<ToolbarItem | false | undefined> {
    // Find state: its box, or its icon, which opens the box, on a row short of room.
    const seek = useKeySearchToolbarItem(find, { rank: FLOWCHART_RANK.seek, label: "Find state" });
    // The slice's rail, at the row's end.
    const rail = useSliceToolbarItems(slice, [{ key: "rail", kinds: affordances, side: "end" }])[0];
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
        seek,
        {
            key: "orientation",
            rank: FLOWCHART_RANK.orientation,
            forms: [
                <Seg label="Orientation" name="orientation" data="data-flowchart-seg" items={ORIENTATIONS} active={orientation} onPick={onOrientation} />,
                <SegMenu label="Orientation" name="orientation" data="data-flowchart-segmenu" items={ORIENTATIONS} active={orientation} onPick={onOrientation} />,
            ],
        },
        chip !== undefined && { key: "freshness", rank: FLOWCHART_RANK.freshness, forms: [chip, null] },
        rail,
        history,
    ];
}
