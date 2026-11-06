/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the canvas draws of the details beside its cards (#1510, `Flowchart
 * Records Spec.md` R30, R31, §4) — pure: a tag's look, the legend's rows and
 * its groups of tags, the legend's height, and the words the canvas measures
 * as a card draws them.
 *
 * - **A tag's look** (R30): its definition's, the first naming it. Subtle, the
 *   default, in a palette is a wash of it; in gray or neutral, or for a tag no
 *   definition names, the neutral look; any other variant is the Tag
 *   recipe's, in its definition's palette.
 * - **The legend** (R31, §4): under today's four rows, a row for each
 *   figure, histogram and list the cards and labels draw, in the details'
 *   order — the states', then the transitions' — each its mark and its words;
 *   and beside them, one over another, a group for each tag list on the cards
 *   it lists, its label, then the defined tags the cards show, in the order
 *   defined. A tag no definition names is left out; a group whose tags no card
 *   shows yet — before a row lands, say — is its label alone.
 * - **Its height** (§4): its rows' column — its title, then 22 a row — or its
 *   groups' column — each its title, then its tags wrapped across 236, 15 a
 *   line and 4 between, one over another 12 apart — whichever is taller, in
 *   its padding and its rule: what the layout keeps under the drawing for it.
 *
 * @packageDocumentation
 */

import { SortedSet, StringType, compareFor, equalFor } from "@elaraai/east";
import { listTopOf, valueAt, type FlowchartDetailsModel, type FlowchartKindDetails, type FlowchartTagColors, type FlowchartTextMeasure } from "./details.js";
import { durationText } from "./details-words.js";
import type { FlowchartWords } from "./messages.js";

const compareKey = compareFor(StringType);
const sameString = equalFor(StringType);

/** A tag's look (R30), as the canvas, the legend and the inspector draw it. */
export type FlowchartTagLook =
    /** Subtle in a palette: a 6% wash of it on a 1px rule of it, in its text step. */
    | { readonly look: "wash"; readonly palette: string }
    /** Gray, neutral, or no definition: `--paper-3` on a 1px `--rule`. */
    | { readonly look: "neutral" }
    /** Any other variant: the Tag recipe's, in its definition's palette. */
    | { readonly look: "recipe"; readonly palette: string; readonly variant: string };

/** The neutral look. */
const NEUTRAL: FlowchartTagLook = { look: "neutral" };

/**
 * A tag's look (R30): its definition's — the first naming it — else neutral.
 *
 * @param colors - The read's looks
 * @param tag - The tag
 * @returns Its look
 */
export function tagLookOf(colors: FlowchartTagColors, tag: string): FlowchartTagLook {
    const color = colors.find((defined) => sameString(defined.tag, tag));
    if (color === undefined) return NEUTRAL;
    const palette = color.colorPalette.type;
    const variant = color.variant.type;
    if (variant === "subtle") return palette === "gray" || palette === "neutral" ? NEUTRAL : { look: "wash", palette };
    return { look: "recipe", palette, variant };
}

/** What a legend row's mark draws: a figure's `123`, bars, a list's lines and shares, or a label's badge and its lines. */
export type FlowchartLegendMark = "figure" | "bars" | "lines" | "label";

/** One row the legend adds for a read the cards and labels draw (R31). */
export interface FlowchartLegendRead {
    /** Its kind and its place in the details: what keys it. */
    readonly key: string;
    /** Its mark. */
    readonly mark: FlowchartLegendMark;
    /** Its words: the read's label, and what it shows. */
    readonly text: string;
}

/** One tag a legend's group lists: the tag, and its look. */
export interface FlowchartLegendTag {
    readonly tag: string;
    readonly look: FlowchartTagLook;
}

/** One group of tags beside the legend's rows (R31): a tag list's label, then its defined tags the cards show. */
export interface FlowchartLegendGroup {
    /** Its read's place in the states' details: what keys it. */
    readonly key: string;
    /** The read's label. */
    readonly label: string;
    /** Its tags, in the order defined: none while no card shows one. */
    readonly tags: readonly FlowchartLegendTag[];
}

/** What the legend adds of the details: its rows, and its groups of tags. */
export interface FlowchartLegend {
    readonly reads: readonly FlowchartLegendRead[];
    readonly groups: readonly FlowchartLegendGroup[];
}

/** No details on the canvas: the legend draws today's rows alone. */
export const NO_LEGEND: FlowchartLegend = { reads: [], groups: [] };

/** One kind's reads on the canvas, as the legend's rows name them. */
function readRows(kind: FlowchartKindDetails | undefined, sort: "states" | "transitions", words: FlowchartWords): FlowchartLegendRead[] {
    if (kind === undefined || !kind.onCanvas) return [];
    const on = sort === "states" ? "card" as const : "label" as const;
    const rows: FlowchartLegendRead[] = [];
    kind.reads.forEach((entry, index) => {
        if (entry.show.type === "inspector") return;
        const key = `${sort}:${index}`;
        const read = entry.read;
        switch (read.type) {
            case "figure":
                rows.push({ key, mark: on === "card" ? "figure" : "label", text: words.m.legendRead({ read: "figure", label: read.value.label, on }) });
                return;
            case "histogram": {
                const edges = kind.bins[index]?.edges ?? [];
                const unit = read.value.unit.type;
                rows.push({
                    key, mark: "bars",
                    text: words.m.legendRead({
                        read: "histogram", label: read.value.label, scale: read.value.scale.type,
                        first: edges.length === 0 ? undefined : durationText(edges[0]!, unit, words),
                        last: edges.length < 2 ? undefined : durationText(edges[edges.length - 1]!, unit, words),
                    }),
                });
                return;
            }
            case "list":
                rows.push({
                    key, mark: on === "card" ? "lines" : "label",
                    text: words.m.legendRead({ read: "list", label: read.value.label, top: words.number(listTopOf(read.value)), on }),
                });
                return;
            case "tags":
                return;
        }
    });
    return rows;
}

/**
 * What the legend adds of the details (R31; see the module docs): its rows for
 * the reads the cards and labels draw, and its groups of tags.
 *
 * @param details - The details model
 * @param words - The flowchart's words
 * @returns The legend's reads and groups
 */
export function legendOf(details: FlowchartDetailsModel, words: FlowchartWords): FlowchartLegend {
    const reads = [...readRows(details.states, "states", words), ...readRows(details.transitions, "transitions", words)];
    const groups: FlowchartLegendGroup[] = [];
    const states = details.states;
    if (states !== undefined && states.onCanvas) {
        states.reads.forEach((entry, index) => {
            if (entry.read.type !== "tags" || !entry.read.value.legend || entry.show.type === "inspector") return;
            const colors = entry.read.value.colors;
            // The tags the cards show: every landed row's.
            const shown = new SortedSet<string>([], compareKey);
            for (const row of states.rows.values()) {
                const at = row === null ? undefined : valueAt(row, index);
                if (at?.type === "tags") for (const tag of at.value) shown.add(tag);
            }
            const listed = new SortedSet<string>([], compareKey);
            const tags: FlowchartLegendTag[] = [];
            for (const color of colors) {
                if (!shown.has(color.tag) || listed.has(color.tag)) continue;
                listed.add(color.tag);
                tags.push({ tag: color.tag, look: tagLookOf(colors, color.tag) });
            }
            groups.push({ key: `tags:${index}`, label: entry.read.value.label, tags });
        });
    }
    return reads.length === 0 && groups.length === 0 ? NO_LEGEND : { reads, groups };
}

/** Today's rows: planned, observed, the decision trigger and the in-place transition. */
const TODAY_ROWS = 4;
/** The legend's title: mono 9, its line 11.25. */
const LEGEND_TITLE = 11.25;
/** A row, and the gap before it. */
const LEGEND_ROW = 16 + 6;
/** Between a group's title and its tags. */
const GROUP_GAP = 4;
/** A tag in a group: the card's size. */
const GROUP_TAG_H = 15;
/** Between two lines of a group's tags, and between two tags. */
const GROUP_TAG_GAP = 4;
/** Between two groups, one over another. */
const GROUPS_GAP = 12;
/** What a group's tags wrap across: the visual spec's. */
export const LEGEND_GROUP_W = 236;
/** The legend's padding, 10 above and below, and its 1px rule. */
const LEGEND_CHROME = 2 * 10 + 2 * 1;

/** How many lines a group's tags take across its width. */
function groupLines(tags: readonly FlowchartLegendTag[], measure: FlowchartTextMeasure): number {
    let lines = 0;
    let x = 0;
    for (const { tag } of tags) {
        const w = measure.tag(tag);
        if (lines === 0 || x + GROUP_TAG_GAP + w > LEGEND_GROUP_W) {
            lines += 1;
            x = w;
        } else x += GROUP_TAG_GAP + w;
    }
    return lines;
}

/**
 * The legend's height (§4; see the module docs): what the layout keeps under
 * the drawing for it.
 *
 * @param legend - What it adds of the details
 * @param measure - How wide a tag draws
 * @returns Its height, in px, a whole number
 */
export function legendHeight(legend: FlowchartLegend, measure: FlowchartTextMeasure): number {
    const rows = LEGEND_TITLE + (TODAY_ROWS + legend.reads.length) * LEGEND_ROW;
    // The groups one over another, 12 apart.
    const groups = legend.groups.reduce((column, group, i) => {
        const lines = groupLines(group.tags, measure);
        // A group no card shows a tag of yet is its title alone.
        const height = lines === 0 ? LEGEND_TITLE : LEGEND_TITLE + GROUP_GAP + lines * GROUP_TAG_H + (lines - 1) * GROUP_TAG_GAP;
        return column + (i === 0 ? 0 : GROUPS_GAP) + height;
    }, 0);
    return Math.ceil(Math.max(rows, groups) + LEGEND_CHROME);
}

/** The words a card draws that the canvas measures: its tag lists' labels, and their tags with every +n they may end in. */
export interface FlowchartProbeTexts {
    readonly labels: readonly string[];
    readonly tags: readonly string[];
}

/** Nothing to measure. */
export const NO_PROBE: FlowchartProbeTexts = { labels: [], tags: [] };

/**
 * The words the canvas measures as a card draws them (#1510): each tag list's
 * label on the cards, each tag a landed row holds there, and each +n a list of
 * them may end in — so a card is measured before the layout places it.
 *
 * @param kind - The states' details
 * @param words - The flowchart's words: a +n's
 * @returns The labels and the tags, each once
 */
export function probeTextsOf(kind: FlowchartKindDetails | undefined, words: FlowchartWords): FlowchartProbeTexts {
    if (kind === undefined || !kind.onCanvas) return NO_PROBE;
    const labels = new SortedSet<string>([], compareKey);
    const tags = new SortedSet<string>([], compareKey);
    let most = 0;
    kind.reads.forEach((entry, index) => {
        if (entry.read.type !== "tags" || entry.show.type === "inspector") return;
        labels.add(entry.read.value.label);
        for (const row of kind.rows.values()) {
            const at = row === null ? undefined : valueAt(row, index);
            if (at?.type !== "tags") continue;
            for (const tag of at.value) tags.add(tag);
            most = Math.max(most, at.value.length);
        }
    });
    for (let n = 1; n <= most; n++) tags.add(words.m.detailsMore({ count: words.number(n) }));
    return labels.size === 0 ? NO_PROBE : { labels: [...labels], tags: [...tags] };
}
