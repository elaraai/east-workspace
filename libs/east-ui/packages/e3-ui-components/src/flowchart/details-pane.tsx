/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The inspector's reads (#1510, `Flowchart Records Spec.md` R33–R36, R41):
 * after a state's or a transition's head, the reads its kind shows there —
 * `show` `"all"` or `"inspector"` — in the details' order and in full, in the
 * `flowchartInspector` recipe's slots, which own every colour, size and type:
 * these set data attributes and geometry alone.
 *
 * - **Figures** side by side share the stats grid, each its value in the
 *   app's locale and its unit, as on a card, over its label — the figures
 *   next to one another in the details one grid.
 * - **Every other read** stands under its title, its total beside it: a tag
 *   list's count, a histogram's sum in its `counts`, a list's in its `unit`.
 * - **Tags**: every one, in the order their looks are defined, then the rest
 *   in the row's order, each 20 high in its look, wrapping.
 * - **A histogram** across the pane on the app's axis: a slot a bin, its bar
 *   as tall as its count over the row's tallest, 2 short of the next — or on
 *   a linear axis, too thin for that, flush with it and a pixel at least; the
 *   axis's ticks at the pane's width; and the caption — where half and nine in
 *   ten of its counts fall, or, for the bin under the pointer or focus, which
 *   darkens, its span, its count and its share. The bins are a list, one stop
 *   on the keyboard: the arrows, Home and End move between them.
 * - **A list**: its items by value, each its name and note, its value and its
 *   share over a track filled to it; the first 8, then Show n more, and Show
 *   fewer once open.
 *
 * A row there is none of says *no data* under Details, where the reads would
 * go; a read with nothing to show says *no data*, a tag list or a list with no
 * items *none*; until the row lands, the shared placeholder shapes stand where
 * its values go, its labels drawn.
 *
 * @packageDocumentation
 */

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Box, chakra, type SystemStyleObject } from "@chakra-ui/react";
import { FloatType, lessFor } from "@elaraai/east";
import { getSomeorUndefined, useContainerWidth } from "@elaraai/east-ui-components";
import { PlaceholderShape } from "@elaraai/east-ui-components/internal";
import {
    barsOf, listLines, orderedTags,
    type FlowchartBinCounts, type FlowchartBins, type FlowchartDetailRowValue, type FlowchartKindDetails, type FlowchartReadValue, type FlowchartRowDetails,
} from "./details.js";
import { FlowchartTag, barAcross, ticksOf } from "./details-card.js";
import { tagLookOf } from "./details-draw.js";
import { PANE_TICK_CHAR, axisTicks, binText, marksText, shareText } from "./details-words.js";
import type { FlowchartWords } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;
type HistogramRead = Extract<FlowchartReadValue, { type: "histogram" }>["value"];
type ListRead = Extract<FlowchartReadValue, { type: "list" }>["value"];
type ListValue = Extract<FlowchartDetailRowValue[number], { type: "list" }>["value"];

const lessFloat = lessFor(FloatType);

/** A bar in the pane at most, inside the bars' 1px rule: the visual spec's 63. */
const PANE_BAR_MOST = 63;
/** A bar that counts anything, at least. */
const PANE_BAR_LEAST = 1.5;
/** The histogram's width until it is measured: the 320 pane's, inside its 16 of padding. */
const PANE_AXIS_W = 288;
/** A list's items before Show n more (R36). */
const LIST_FIRST = 8;

/** A share as a CSS length across its box. */
const across = (share: number): string => `${share * 100}%`;

/**
 * A bar's height in the pane: as tall as its count over the row's tallest, a
 * pixel and a half at least where it counts anything.
 *
 * @param height - Its height, the tallest 1
 * @param count - What it counts
 * @returns Its height, in px
 */
export function paneBarHeight(height: number, count: number): number {
    return lessFloat(0, count) ? Math.max(PANE_BAR_LEAST, height * PANE_BAR_MOST) : 0;
}

/** Props of {@link FlowchartPaneReads}. */
export interface FlowchartPaneReadsProps {
    /** The `flowchartInspector` recipe's slots. */
    readonly styles: Styles;
    /** The kind's details; `undefined` for a kind with none. */
    readonly kind: FlowchartKindDetails | undefined;
    /** The row's key. */
    readonly at: string;
    /** The flowchart's words. */
    readonly words: FlowchartWords;
}

/**
 * The reads the inspector shows of a row (see the module docs), after its
 * head; nothing where its kind shows none there.
 *
 * @param props - The recipe's slots, the kind's details, the row's key, and the words
 * @returns The reads
 */
export function FlowchartPaneReads({ styles, kind, at, words }: FlowchartPaneReadsProps) {
    if (kind === undefined) return null;
    const shown = kind.reads.flatMap((entry, index) => (entry.show.type === "canvas" ? [] : [index]));
    if (shown.length === 0) return null;
    const m = words.m;
    const row = kind.rows.get(at);
    if (row === null) {
        return (
            <Box css={styles.reads} data-inspector-reads="" data-reads="none">
                <Box css={styles.read}>
                    <Box css={styles.readHead}><Box as="span" css={styles.readTitle}>{m.detailsTitle()}</Box></Box>
                    <Box as="span" css={styles.noData} data-read-empty="">{m.detailsNoData()}</Box>
                </Box>
            </Box>
        );
    }
    // The figures next to one another one stats grid, every other read under its title.
    const parts: ReactNode[] = [];
    let run: number[] = [];
    const flush = (): void => {
        if (run.length === 0) return;
        parts.push(<Stats key={`stats:${run[0]}`} styles={styles} kind={kind} row={row} reads={run} words={words} />);
        run = [];
    };
    for (const index of shown) {
        if (kind.reads[index]!.read.type === "figure") {
            run.push(index);
            continue;
        }
        flush();
        parts.push(<PaneRead key={index} styles={styles} kind={kind} row={row} index={index} words={words} />);
    }
    flush();
    return <Box css={styles.reads} data-inspector-reads="" data-reads={row === undefined ? "landing" : "landed"}>{parts}</Box>;
}

/** Figures next to one another in the details, side by side in the stats grid: each its value and its unit over its label. */
function Stats({ styles, kind, row, reads, words }: {
    styles: Styles; kind: FlowchartKindDetails; row: FlowchartRowDetails | undefined; reads: readonly number[]; words: FlowchartWords;
}) {
    return (
        <Box css={styles.readStats} data-read-stats="">
            {reads.map((index) => {
                const read = kind.reads[index]!.read;
                const unit = read.type === "figure" ? getSomeorUndefined(read.value.unit) : undefined;
                const at = row?.values[index];
                const value = at?.type === "figure" ? getSomeorUndefined(at.value) : undefined;
                return (
                    <Box key={index} css={styles.readStat} data-pane-read={index} data-read="figure">
                        {row === undefined ? (
                            <Box css={styles.placeholder} data-place="stat"><PlaceholderShape kind="number" index={index} /></Box>
                        ) : value === undefined ? (
                            <Box as="span" css={styles.noData} data-read-empty="">{words.m.detailsNoData()}</Box>
                        ) : (
                            <Box as="span" css={styles.readStatLine} data-read-figure="">
                                <Box as="span" css={styles.readStatValue} data-read-value="">{words.number(value)}</Box>
                                {unit !== undefined && <Box as="span" css={styles.readStatUnit} data-read-unit="">{unit}</Box>}
                            </Box>
                        )}
                        <Box as="span" css={styles.readStatLabel} data-read-label="">{read.value.label}</Box>
                    </Box>
                );
            })}
        </Box>
    );
}

/** A read's title, and its total beside it once its row lands. */
function ReadHead({ styles, title, total }: { styles: Styles; title: string; total: string | undefined }) {
    return (
        <Box css={styles.readHead}>
            <Box as="span" css={styles.readTitle} data-read-label="">{title}</Box>
            {total !== undefined && <Box as="span" css={styles.readTotal} data-read-total="">{total}</Box>}
        </Box>
    );
}

/** A read other than a figure, under its title. */
function PaneRead({ styles, kind, row, index, words }: {
    styles: Styles; kind: FlowchartKindDetails; row: FlowchartRowDetails | undefined; index: number; words: FlowchartWords;
}) {
    const m = words.m;
    const read = kind.reads[index]!.read;
    const at = row?.values[index];
    const empty = (text: string) => <Box as="span" css={styles.noData} data-read-empty="">{text}</Box>;
    switch (read.type) {
        case "figure":
            return null;
        case "tags": {
            const tags = at?.type === "tags" ? orderedTags(read.value.colors, at.value) : undefined;
            return (
                <Box css={styles.read} data-pane-read={index} data-read="tags">
                    <ReadHead styles={styles} title={read.value.label} total={tags === undefined ? undefined : words.number(tags.length)} />
                    {row === undefined ? (
                        <Box css={styles.placeholder} data-place="tags"><PlaceholderShape kind="chip" index={index} /></Box>
                    ) : tags === undefined ? empty(m.detailsNoData())
                        : tags.length === 0 ? empty(m.detailsNone()) : (
                            <Box css={styles.readTags} data-read-tags="">
                                {tags.map((tag) => <FlowchartTag key={tag} css={styles.tag} text={tag} look={tagLookOf(read.value.colors, tag)} />)}
                            </Box>
                        )}
                </Box>
            );
        }
        case "histogram": {
            const counts = row?.counts[index];
            const noun = getSomeorUndefined(read.value.counts);
            const bins = kind.bins[index];
            const counted = bins !== undefined && counts !== undefined && lessFloat(0, counts.total);
            return (
                <Box css={styles.read} data-pane-read={index} data-read="histogram">
                    <ReadHead styles={styles} title={read.value.label}
                        total={counts === undefined ? undefined : m.detailsCount({ count: words.number(counts.total), noun })} />
                    {row === undefined ? (
                        <Box css={styles.placeholder} data-place="bars"><PlaceholderShape kind="fill" index={index} /></Box>
                    ) : !counted ? empty(m.detailsNoData()) : (
                        <PaneHistogram styles={styles} read={read.value} bins={bins} counts={counts} words={words} />
                    )}
                </Box>
            );
        }
        case "list": {
            const items = at?.type === "list" ? at.value : undefined;
            return (
                <Box css={styles.read} data-pane-read={index} data-read="list">
                    <ReadHead styles={styles} title={read.value.label} total={items === undefined ? undefined : listTotal(read.value, items, words)} />
                    {row === undefined ? (
                        <Box css={styles.placeholder} data-place="row"><PlaceholderShape kind="text" index={index} /></Box>
                    ) : items === undefined ? empty(m.detailsNoData())
                        : items.length === 0 ? empty(m.detailsNone()) : <PaneList styles={styles} items={items} words={words} />}
                </Box>
            );
        }
    }
}

/** A list's total, in its unit: what its values count, together — a value that counts nothing left out. */
function listTotal(read: ListRead, items: ListValue, words: FlowchartWords): string {
    const total = items.reduce((sum, item) => sum + (Number.isFinite(item.value) && !lessFloat(item.value, 0) ? item.value : 0), 0);
    return words.m.detailsCount({ count: words.number(total), noun: getSomeorUndefined(read.unit) });
}

/** A histogram across the pane: its bins, the axis, and its caption. */
function PaneHistogram({ styles, read, bins, counts, words }: {
    styles: Styles; read: HistogramRead; bins: FlowchartBins; counts: FlowchartBinCounts; words: FlowchartWords;
}) {
    const m = words.m;
    const box = useRef<HTMLDivElement | null>(null);
    const slots = useRef<(HTMLElement | null)[]>([]);
    const measured = useContainerWidth(box);
    const width = measured > 0 ? measured : PANE_AXIS_W;
    const [hovered, setHovered] = useState<number | undefined>(undefined);
    const [focused, setFocused] = useState<number | undefined>(undefined);
    // The keyboard's one stop: the bin it last rested on.
    const [stop, setStop] = useState(0);
    const unit = read.unit.type;
    const noun = getSomeorUndefined(read.counts);
    const bars = barsOf(bins, counts.counts);
    const caption = (bin: number): string => m.detailsBinCaption({
        bin: binText(bins.edges, bin, unit, words),
        count: m.detailsCount({ count: words.number(counts.counts[bin] ?? 0), noun }),
        share: shareText(lessFloat(0, counts.total) ? (counts.counts[bin] ?? 0) / counts.total : 0, words),
    });
    const active = hovered ?? focused;
    const onKey = (event: KeyboardEvent<HTMLElement>, bin: number): void => {
        const last = bars.length - 1;
        const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? Math.min(last, bin + 1)
            : event.key === "ArrowLeft" || event.key === "ArrowUp" ? Math.max(0, bin - 1)
                : event.key === "Home" ? 0
                    : event.key === "End" ? last : undefined;
        if (next === undefined) return;
        event.preventDefault();
        setStop(next);
        slots.current[next]?.focus();
    };
    return (
        <Box css={styles.histogram} data-pane-histogram="">
            <Box ref={box} css={styles.bars} role="list" aria-label={read.label} data-pane-bars="">
                {bars.map((bar, b) => {
                    const at = barAcross(bins, bar, width);
                    return (
                        <Box key={b} as="span" ref={(el: HTMLElement | null) => { slots.current[b] = el; }} css={styles.binSlot} role="listitem"
                            tabIndex={b === stop ? 0 : -1} aria-label={caption(b)} data-bin={b} data-flush={at.flush ? "" : undefined} data-active={active === b ? "" : undefined}
                            style={{ left: at.left, width: at.width, minWidth: at.minWidth }}
                            onPointerEnter={() => setHovered(b)} onPointerLeave={() => setHovered(undefined)}
                            onFocus={() => { setStop(b); setFocused(b); }} onBlur={() => setFocused(undefined)} onKeyDown={(event: KeyboardEvent<HTMLElement>) => onKey(event, b)}>
                            <Box as="span" css={styles.bin} style={{ height: paneBarHeight(bar.height, bar.count) }} />
                        </Box>
                    );
                })}
            </Box>
            <Box css={styles.axis} aria-hidden="true" data-pane-axis="">
                {axisTicks(bins, unit, ticksOf(read.ticks), width, PANE_TICK_CHAR, words).map((tick) => (
                    <Box as="span" key={tick.text} css={styles.tick} data-tick="" style={tick.end ? { right: 0 } : { left: tick.x }}>{tick.text}</Box>
                ))}
            </Box>
            <Box css={styles.caption} data-pane-caption="">
                {active === undefined ? marksText(bins.edges, counts.counts, unit, words) : caption(active)}
            </Box>
        </Box>
    );
}

/** A list's items by value: the first 8, then Show n more — and Show fewer once open. */
function PaneList({ styles, items, words }: { styles: Styles; items: ListValue; words: FlowchartWords }) {
    const [open, setOpen] = useState(false);
    const lines = listLines(items, Number.POSITIVE_INFINITY);
    const rest = lines.length - LIST_FIRST;
    const drawn = open || rest <= 0 ? lines : lines.slice(0, LIST_FIRST);
    return (
        <>
            <Box css={styles.listRows} data-pane-list="">
                {drawn.map((line, i) => (
                    <Box key={i} css={styles.listRow} data-list-row={i}>
                        <Box as="span" css={styles.listNameLine}>
                            <Box as="span" css={styles.listName} title={line.name}>{line.name}</Box>
                            {line.note !== undefined && <Box as="span" css={styles.listNote}>{line.note}</Box>}
                        </Box>
                        <Box as="span" css={styles.listValue}>{words.number(line.value)}</Box>
                        <Box as="span" css={styles.listShare}>{shareText(line.share, words)}</Box>
                        <Box as="span" css={styles.listTrack} aria-hidden="true"><Box as="span" css={styles.listFill} style={{ width: across(line.share) }} /></Box>
                    </Box>
                ))}
            </Box>
            {rest > 0 && (
                <chakra.button type="button" css={styles.showMore} aria-expanded={open} data-pane-more="" onClick={() => setOpen((was) => !was)}>
                    {words.m.detailsShowMore({ n: rest, count: words.number(rest), open })}
                </chakra.button>
            )}
        </>
    );
}
