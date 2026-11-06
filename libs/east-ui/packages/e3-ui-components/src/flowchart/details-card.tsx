/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a state's card draws of its details (#1510, `Flowchart Records
 * Spec.md` R22, R25–R30, R33, R34), the legend's marks for the reads (R31),
 * a tag in its look, and the probe that measures a card's words as it draws
 * them — in the `flowchart` recipe's slots, which own every colour, size and
 * type: these set data attributes and geometry alone.
 *
 * - **The card**: its head — its label, its ×n and ↻ n, over its key — then
 *   each read the details show on the canvas, in their order, each in the
 *   block its model gives it: a figure's line, its value in the app's locale
 *   with its unit; a tag list beside its label, its lines, the last ending in
 *   +n, its title naming the rest; a title over bars — each a bin, 2 short of
 *   the next, or on a linear axis, too thin for that, flush with it and a pixel
 *   at least; as tall as its count over the card's tallest — and the axis's
 *   ticks; a title over a list's top lines, each its name, a track filled to
 *   its share, and the share. *No data* for a row there is none of or a value
 *   it lacks, *none* for a list with no items; while a row lands, the shared
 *   placeholder shapes where its values go, its labels drawn.
 * - **A tag** (R30), the card's, the legend's and the inspector's: a wash or
 *   the neutral look in the recipe's own slot, or the design system's Tag in
 *   its definition's variant and palette, the slot giving it its size.
 * - **The probe** (#1510): the tag lists' labels and their tags, drawn out of
 *   sight in the slots a card draws them with, measured after each render and
 *   again once the fonts land — so a card's tags wrap, and its height is
 *   known, before the layout places it; where nothing measures (a test's DOM),
 *   the estimate stands.
 *
 * @packageDocumentation
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Tag as ChakraTag, chakra, type SystemStyleObject, type TagRootProps } from "@chakra-ui/react";
import { FloatType, lessFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { PlaceholderShape } from "@elaraai/east-ui-components/internal";
import {
    DETAILS_INNER_W, ESTIMATED_TEXT, listTopOf,
    type FlowchartBar, type FlowchartBins, type FlowchartCard, type FlowchartCardRead, type FlowchartKindDetails, type FlowchartReadValue, type FlowchartTextMeasure,
} from "./details.js";
import { NO_PROBE, tagLookOf, type FlowchartLegendMark, type FlowchartProbeTexts, type FlowchartTagLook } from "./details-draw.js";
import { CARD_TICK_CHAR, axisTicks, marksText, shareText, type FlowchartTickAt } from "./details-words.js";
import type { FlowchartWords } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** A bar on a card at most, inside the bars' 1px rule (R26): the visual spec's 27. */
const CARD_BAR_MOST = 27;

/** A share as a CSS length across its box. */
const across = (share: number): string => `${share * 100}%`;

const lessFloat = lessFor(FloatType);

/** The room between two bars, in px: each 2 short of the next (R26). */
const BAR_GAP = 2;

/** Where a bar draws across its axis, as CSS. */
export interface FlowchartBarAcross {
    /** Where it starts, a share of the axis. */
    readonly left: string;
    /** Its width: its span 2 short of the next, or its span alone where it draws flush. */
    readonly width: string;
    /** Where it draws flush, a pixel; else none. */
    readonly minWidth: string | undefined;
    /** Whether it draws flush with its neighbours: too thin for the room between them. */
    readonly flush: boolean;
}

/**
 * Where a bar draws across an axis `width` px wide (R26): from its start, 2
 * short of its span, the room to the next — or, on a linear axis, where its
 * span leaves under a pixel past that room, its span alone, flush with its
 * neighbours and a pixel at least, so a thin bin still shows what it counts.
 *
 * @param bins - The flowchart's bins
 * @param bar - The bar
 * @param width - The axis's width, in px
 * @returns Its start, its width and its least, and whether it draws flush
 */
export function barAcross(bins: FlowchartBins, bar: FlowchartBar, width: number): FlowchartBarAcross {
    const share = bar.to - bar.from;
    const flush = bins.scale === "linear" && lessFloat(share * width - BAR_GAP, 1);
    return flush
        ? { left: across(bar.from), width: across(share), minWidth: "1px", flush }
        : { left: across(bar.from), width: `calc(${across(share)} - ${BAR_GAP}px)`, minWidth: undefined, flush };
}

/**
 * A bar's height on a card: as tall as its count over the card's tallest, a
 * pixel at least where it counts anything.
 *
 * @param bar - The bar
 * @returns Its height, in px
 */
export function cardBarHeight(bar: FlowchartBar): number {
    return bar.count > 0 ? Math.max(1, Math.round(bar.height * CARD_BAR_MOST)) : 0;
}

/** Props of {@link FlowchartTag}. */
export interface FlowchartTagProps {
    /** Its size: the card's slot, or the inspector's. */
    readonly css: SystemStyleObject | undefined;
    /** Its words. */
    readonly text: string;
    /** Its look. */
    readonly look: FlowchartTagLook;
    /** What it names where its words do not: a +n's, the tags past it. */
    readonly title?: string | undefined;
    /** A +n's mark: the tags it stands for. */
    readonly more?: boolean | undefined;
}

/** The Tag recipe's `colored`: a Tag drawn in the palette it is given. */
const COLORED = { colored: true } as TagRootProps;

/**
 * A tag in its look (R30): a wash or the neutral look in the slot it is given,
 * or the design system's Tag in its definition's variant and palette — the
 * Tag's `colored`, so it draws in the palette — the slot giving it its size
 * alone, its words in the Tag itself, at the slot's type: the Tag's label
 * takes its own size's type, 12px on 16.
 *
 * @param props - Its size, words, look, and title
 * @returns The tag
 */
export function FlowchartTag({ css, text, look, title, more }: FlowchartTagProps) {
    const marks = { "data-flowchart-tag": more === true ? undefined : text, "data-flowchart-more": more === true ? "" : undefined, title };
    if (look.look === "recipe") {
        return (
            <ChakraTag.Root css={css} variant={look.variant as TagRootProps["variant"]} colorPalette={look.palette} {...COLORED} data-look="recipe" {...marks}>
                {text}
            </ChakraTag.Root>
        );
    }
    return (
        <chakra.span css={css} colorPalette={look.look === "wash" ? look.palette : undefined} data-look={look.look} {...marks}>
            {text}
        </chakra.span>
    );
}

/** The neutral look: a +n's. */
const NEUTRAL: FlowchartTagLook = { look: "neutral" };

/** Props of {@link FlowchartCardContent}. */
export interface FlowchartCardContentProps {
    /** The `flowchart` recipe's slots. */
    readonly styles: Styles;
    /** The states' details. */
    readonly kind: FlowchartKindDetails;
    /** The card: its reads, each in its block. */
    readonly card: FlowchartCard;
    /** The flowchart's words. */
    readonly words: FlowchartWords;
    /** What the head names it: its label, else its key. */
    readonly name: string;
    /** Its key under its name; `undefined` where the name is the key. */
    readonly code: string | undefined;
    /** Its ×n and ↻ n, beside its name. */
    readonly badges: ReactNode;
}

/**
 * A state's card where its details draw (R22; see the module docs): its head,
 * then its reads.
 *
 * @param props - The recipe's slots, the details, the card, the words, its name and key, and its badges
 * @returns The card's contents
 */
export function FlowchartCardContent({ styles, kind, card, words, name, code, badges }: FlowchartCardContentProps) {
    return (
        <>
            <Box css={styles.cardHead} data-card-head="">
                <Box css={styles.cardTitle}>
                    <Box as="span" css={styles.cardName} data-card-name="" title={name}>{name}</Box>
                    {badges}
                </Box>
                {code !== undefined && <Box as="span" css={styles.cardKey} data-card-key="">{code}</Box>}
            </Box>
            <Box css={styles.cardBody} data-card-body="">
                {card.reads.map((read) => <CardRead key={read.index} styles={styles} kind={kind} read={read} words={words} />)}
            </Box>
        </>
    );
}

/** One read in its block on a card. */
function CardRead({ styles, kind, read, words }: { styles: Styles; kind: FlowchartKindDetails; read: FlowchartCardRead; words: FlowchartWords }) {
    const described = kind.reads[read.index]!.read;
    const m = words.m;
    const draws = read.draws;
    const block = { "data-card-read": read.index, "data-read": described.type, style: { height: read.height } };
    const empty = (text: string) => <Box as="span" css={styles.noData} data-card-empty="">{text}</Box>;
    const label = <Box as="span" css={styles.readLabel} data-read-label="">{described.value.label}</Box>;
    switch (described.type) {
        case "figure": {
            const unit = getSomeorUndefined(described.value.unit);
            return (
                <Box css={styles.figure} {...block}>
                    {label}
                    {draws.kind === "figure" ? (
                        <Box as="span" css={styles.figureValue} data-card-value="">
                            <Box as="span" css={styles.figureNumber}>{words.number(draws.value)}</Box>
                            {unit !== undefined && <Box as="span" css={styles.figureUnit}>{unit}</Box>}
                        </Box>
                    ) : draws.kind === "placeholder" ? (
                        <Box css={styles.placeholder} data-place="figure"><PlaceholderShape kind="number" index={read.index} /></Box>
                    ) : empty(m.detailsNoData())}
                </Box>
            );
        }
        case "tags":
            return (
                <Box css={styles.tags} {...block}>
                    <Box as="span" css={styles.readLabel} data-read-label="" style={{ width: read.column }}>{described.value.label}</Box>
                    <Box css={styles.tagLines} data-tag-lines="">
                        {draws.kind === "placeholder" ? (
                            <Box css={styles.placeholder} data-place="tags" data-dense=""><PlaceholderShape kind="chip" index={read.index} /></Box>
                        ) : draws.kind !== "tags" ? empty(m.detailsNoData())
                            : draws.lines.length === 0 ? empty(m.detailsNone())
                                : draws.lines.map((line, l) => (
                                    <Box key={l} css={styles.tagLine} data-tag-line={l}>
                                        {line.map((tag) => <FlowchartTag key={tag} css={styles.tag} text={tag} look={tagLookOf(described.value.colors, tag)} />)}
                                        {l === draws.lines.length - 1 && draws.rest.length > 0 && (
                                            <FlowchartTag css={styles.tag} more look={NEUTRAL} text={m.detailsMore({ count: words.number(draws.rest.length) })}
                                                title={m.detailsRest({ tags: draws.rest })} />
                                        )}
                                    </Box>
                                ))}
                    </Box>
                </Box>
            );
        case "histogram": {
            const bins = kind.bins[read.index];
            const unit = described.value.unit.type;
            return (
                <Box css={styles.histogram} {...block}>
                    {label}
                    {draws.kind === "placeholder" ? (
                        <Box css={styles.placeholder} data-place="bars"><PlaceholderShape kind="fill" index={read.index} /></Box>
                    ) : draws.kind !== "bars" || bins === undefined ? empty(m.detailsNoData()) : (
                        <>
                            <Box css={styles.bars} data-card-bars="" role="img"
                                aria-label={marksText(bins.edges, draws.bars.map((bar) => bar.count), unit, words) ?? described.value.label}>
                                {draws.bars.map((bar, b) => {
                                    if (!(bar.count > 0)) return null;
                                    const at = barAcross(bins, bar, DETAILS_INNER_W);
                                    return (
                                        <Box as="span" key={b} css={styles.bar} data-bin={b} data-flush={at.flush ? "" : undefined}
                                            style={{ left: at.left, width: at.width, minWidth: at.minWidth, height: cardBarHeight(bar) }} />
                                    );
                                })}
                            </Box>
                            <Box css={styles.axis} data-card-axis="" aria-hidden="true">
                                {axisTicks(bins, unit, ticksOf(described.value.ticks), DETAILS_INNER_W, CARD_TICK_CHAR, words).map((tick) => (
                                    <Box as="span" key={tick.text} css={styles.tick} data-tick="" style={tick.end ? { right: 0 } : { left: tick.x }}>{tick.text}</Box>
                                ))}
                            </Box>
                        </>
                    )}
                </Box>
            );
        }
        case "list":
            return (
                <Box css={styles.list} {...block}>
                    {label}
                    {draws.kind === "placeholder" ? Array.from({ length: listTopOf(described.value) }, (_, i) => (
                        <Box key={i} css={styles.placeholder} data-place="row"><PlaceholderShape kind="text" index={read.index + i} /></Box>
                    )) : draws.kind !== "list" ? empty(m.detailsNoData())
                        : draws.lines.length === 0 ? empty(m.detailsNone())
                            : draws.lines.map((line, i) => (
                                <Box key={i} css={styles.listRow} data-list-row={i}>
                                    <Box as="span" css={styles.listName} title={line.name}>{line.name}</Box>
                                    <Box as="span" css={styles.listTrack} aria-hidden="true"><Box as="span" css={styles.listFill} style={{ width: across(line.share) }} /></Box>
                                    <Box as="span" css={styles.listShare}>{shareText(line.share, words)}</Box>
                                </Box>
                            ))}
                </Box>
            );
    }
}

/**
 * The ticks a histogram read lists (R28): each where it is, and its own words
 * where it gives them; `undefined` where it lists none, and the axis names
 * round durations.
 *
 * @param ticks - The read's ticks
 * @returns The ticks
 */
export function ticksOf(ticks: Extract<FlowchartReadValue, { type: "histogram" }>["value"]["ticks"]): FlowchartTickAt[] | undefined {
    const given = getSomeorUndefined(ticks);
    return given?.map((tick) => ({ at: tick.at, label: getSomeorUndefined(tick.label) }));
}

/**
 * A read's mark in the legend (R31): a figure's `123`; four bars on a base; a
 * list's two lines and their shares; a label's badge and its two lines — the
 * recipe's colours, by each part's `data-mark`.
 *
 * @param props - The mark
 * @returns The mark
 */
export function FlowchartLegendMarkView({ styles, mark }: { styles: Styles; mark: FlowchartLegendMark }) {
    switch (mark) {
        case "figure":
            return <Box as="span" css={styles.legendMark} data-legend-mark={mark}><Box as="span" css={styles.legendFigure}>123</Box></Box>;
        case "bars":
            return (
                <Box as="span" css={styles.legendMark} data-legend-mark={mark}>
                    <svg width={28} height={16} aria-hidden="true">
                        <rect data-mark="bar" x={3} y={10} width={4} height={4} />
                        <rect data-mark="bar" x={8.5} y={4} width={4} height={10} />
                        <rect data-mark="bar" x={14} y={2} width={4} height={12} />
                        <rect data-mark="bar" x={19.5} y={8} width={4} height={6} />
                        <line data-mark="base" x1={2} y1={14.5} x2={26} y2={14.5} />
                    </svg>
                </Box>
            );
        case "lines":
            return (
                <Box as="span" css={styles.legendMark} data-legend-mark={mark}>
                    <svg width={28} height={16} aria-hidden="true">
                        <rect data-mark="bar" x={2} y={3} width={14} height={3} />
                        <rect data-mark="bar" x={2} y={10} width={8} height={3} />
                        <rect data-mark="share" x={19} y={3} width={7} height={3} />
                        <rect data-mark="share" x={19} y={10} width={7} height={3} />
                    </svg>
                </Box>
            );
        case "label":
            return (
                <Box as="span" css={styles.legendMark} data-legend-mark={mark}>
                    <svg width={28} height={16} aria-hidden="true">
                        <rect data-mark="badge" x={2.5} y={1.5} width={23} height={13} rx={2} />
                        <line data-mark="line" x1={6} y1={5.5} x2={22} y2={5.5} />
                        <line data-mark="detail" x1={8} y1={10.5} x2={20} y2={10.5} />
                    </svg>
                </Box>
            );
    }
}

/** Each measured word's width, by its text: a label's, and a tag's. */
interface Measured {
    readonly label: ReadonlyMap<string, number>;
    readonly tag: ReadonlyMap<string, number>;
}

/** Nothing measured yet. */
const NOTHING_MEASURED: Measured = { label: new Map(), tag: new Map() };

/** Two measures the same, to a hundredth of a px. */
function sameWidths(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [text, w] of b) {
        const was = a.get(text);
        if (was === undefined || Math.abs(was - w) > 0.01) return false;
    }
    return true;
}

/**
 * How wide a card's words draw (#1510; see the module docs): the probe that
 * measures them, and the measure the cards are worked out with — measured
 * where the probe measures, estimated where it does not.
 *
 * @param styles - The `flowchart` recipe's slots
 * @param texts - The words to measure
 * @returns The measure, and the probe to draw out of sight
 */
export function useFlowchartTextMeasure(styles: Styles, texts: FlowchartProbeTexts): { measure: FlowchartTextMeasure; probe: ReactNode } {
    const probeRef = useRef<HTMLDivElement | null>(null);
    const [measured, setMeasured] = useState<Measured>(NOTHING_MEASURED);
    // The fonts landing change what the words measure: measured again.
    const [fonts, setFonts] = useState(0);
    useEffect(() => {
        const set = typeof document === "undefined" ? undefined : document.fonts;
        if (set === undefined) return;
        let live = true;
        const again = (): void => { if (live) setFonts((n) => n + 1); };
        void set.ready.then(again);
        set.addEventListener("loadingdone", again);
        return () => {
            live = false;
            set.removeEventListener("loadingdone", again);
        };
    }, []);
    useLayoutEffect(() => {
        const el = probeRef.current;
        if (el === null) return;
        const label = new Map<string, number>();
        const tag = new Map<string, number>();
        for (const word of el.querySelectorAll<HTMLElement>("[data-measure]")) {
            const w = word.getBoundingClientRect().width;
            // Nothing measures here — a test's DOM: the estimate stands.
            if (!(w > 0)) continue;
            (word.dataset.measure === "label" ? label : tag).set(word.textContent ?? "", w);
        }
        setMeasured((was) => (sameWidths(was.label, label) && sameWidths(was.tag, tag) ? was : { label, tag }));
    }, [texts, fonts]);
    const measure = useMemo((): FlowchartTextMeasure => ({
        label: (text) => measured.label.get(text) ?? ESTIMATED_TEXT.label(text),
        tag: (text) => measured.tag.get(text) ?? ESTIMATED_TEXT.tag(text),
    }), [measured]);
    const probe = texts === NO_PROBE ? null : (
        <Box ref={probeRef} css={styles.measure} aria-hidden="true" data-flowchart-measure="">
            {texts.labels.map((text) => <Box as="span" key={`label:${text}`} css={styles.readLabel} data-measure="label">{text}</Box>)}
            {texts.tags.map((text) => <Box as="span" key={`tag:${text}`} css={styles.tag} data-look="neutral" data-measure="tag">{text}</Box>)}
        </Box>
    );
    return { measure, probe };
}
