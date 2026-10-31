/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Table rows (`Plan Spec.md` §4·K5) — bucketed numerals on the shared scale,
 * MULTI-SERIES per cell: each series carries its own raw cells plus the
 * position's style declarations (format / tone / strong — declared once per
 * series, never per cell). The renderer joins series by bucket and lays the
 * parts out per the row's `split` (side by side, or stacked lines on a grown
 * row). Per part: explicit `text`/`tone` overrides win; else the value prints
 * through `series.format ?? row.format`, negatives tone `neg`, missing values
 * the muted em-dash, and the series' declared tone covers the rest. Subtotal
 * parents render their renderer-DERIVED cells as one plain series; row
 * emphasis (header / footer) rides the shell's `data-emphasis`. A bucket's
 * cell names its bucket instant (`data-cell`), so the canvas's one overlay
 * layer opens the root's popover and hover card for it (#816). It is a button
 * named by its bucket and the numerals it prints (#819) — the em-dash of a
 * missing value said as words. Its numerals are drawn together, whole, or not
 * at all where the cell is narrower than they are, its hover then saying them
 * (#1269) — and, where it holds a value, a dot in their place, so no value
 * leaves its cell looking empty (#1438): the row measures its plot's width
 * beside its cells, and a cell knows its numerals' width from their length,
 * the table's numerals being of one width.
 *
 * A position its row says takes a typed number (#1436, #1438) takes one, at
 * the Plan's finest zoom, in each bucket holding one of its own values —
 * written at that value's date, so it replaces it — or none, written at its
 * start, while the canvas takes typing: every bucket in the window then draws
 * a cell. Enter, F2, a double click or a digit opens the canvas's one input
 * over the cell ({@link PlanCellInput}); below 480px of main a tap opens it, in
 * a popover anchored to the cell. At a coarser zoom each cell is a summary of
 * the values beneath it and takes none: its tooltip says to zoom to the
 * finest, and a double click, Enter or a tap on it zooms there, about its
 * period, focus landing on the row's cell at its middle. A parent's position
 * drawing its children's subtotals takes none, and a bucket folding several
 * values says, as its tooltip, the resolution they are at and the Plan's zoom
 * showing them apart, where it has one.
 */

import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { FloatType, equalFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Box, Popover, Portal } from "@chakra-ui/react";
import { Plan } from "@elaraai/e3-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import type { TickFormatOpt } from "@elaraai/east-ui-components";
import { ToneStrip, type ToneDatum } from "./ToneStrip.js";
import type { PlanBucket, PlanScale } from "../scale.js";
import { instantKey, timeInstant } from "../instant.js";
import { usePlanRowConflicts } from "./element-draft.js";
import { usePlanEdit } from "../edit/store.js";
import { readTyped, resolutionOfValues, typedText, typesAt, usePlanTypingFocus, usePlanTypingOpen, zoomApart, type PlanTyping } from "../edit/typing.js";
import type { TimeResolution } from "../../shared/time/calendar-math.js";
import { PlanCellInput, type PlanCellInputMove } from "./CellInput.js";
import { cellName, tablePartsText } from "../a11y.js";
import type { PlanRowId } from "../model.js";
import { usePlanWords } from "../words.js";
import { useElementWidth } from "../use-element-height.js";
import { maxOf } from "../reductions.js";

type Styles = Record<string, Record<string, unknown>>;
type TableCellValue = ValueTypeOf<typeof Plan.Types.TableCell>;
type TableSeriesValue = ValueTypeOf<typeof Plan.Types.TableSeries>;
type TypedPositionValue = ValueTypeOf<typeof Plan.Types.TypedPosition>;

export interface TableRowCellsProps {
    rowKey: string;
    /** The row's id — what an element click names the row by (#822). */
    rowId: PlanRowId;
    /** The rendered series — the row's own, or its derived subtotal positions. */
    series: readonly TableSeriesValue[];
    /** The part layout (visible only with more than one series). */
    split: "horizontal" | "vertical";
    /** The ROW's shared format (a series' own format overrides per position). */
    format: TickFormatOpt;
    /** R2 context strip (#591) — re-encode as a tone strip; see {@link ToneStrip}. */
    ctx?: boolean | undefined;
    styles: Styles;
    /** The positions that take a typed number (#1436, #1438): the row's `edits.values`. */
    typed?: readonly TypedPositionValue[] | undefined;
    /** The row's own series as declared — before its children's subtotals or a fold stand in for them: which buckets take typing. */
    own?: readonly TableSeriesValue[] | undefined;
    /** Whether the row has children: a position drawing their subtotals takes no typing. */
    parent?: boolean | undefined;
}

/** A position that takes typing on a row: whether its values are whole, how many of its own each bucket holds, and the resolution they are at. */
interface Typeable {
    readonly position: number;
    readonly whole: boolean;
    readonly held: ReadonlyMap<number, number>;
    readonly resolution: TimeResolution | undefined;
}

const NO_TYPEABLES: readonly Typeable[] = [];
const sameNumber = equalFor(FloatType);

/** The positions of a row that take typing (#1438), each with how many of its own values each bucket holds. */
function typeablesOf(scale: PlanScale, typed: readonly TypedPositionValue[], own: readonly TableSeriesValue[], parent: boolean): readonly Typeable[] {
    return typed.flatMap((t) => {
        const position = Number(t.position);
        const declared = own[position];
        // A parent's position with no values of its own draws its children's subtotals: those take none.
        if (declared === undefined || (parent && declared.cells.length === 0)) return [];
        const held = new Map<number, number>();
        const times: number[] = [];
        for (const c of declared.cells) {
            if (c.at.type === "time") times.push(c.at.value.getTime());
            const b = scale.renderBucketOf(c.at);
            if (b !== undefined) held.set(b.index, (held.get(b.index) ?? 0) + 1);
        }
        return [{ position, whole: t.whole, held, resolution: resolutionOfValues(times) }];
    });
}

/** The position a double click or a tap lands on: the part under it where that one takes typing, else the cell's first. */
function positionAt(target: EventTarget, here: readonly Typeable[]): number {
    const part = target instanceof Element ? target.closest("[data-part]")?.getAttribute("data-part") : undefined;
    const hit = part !== undefined && part !== null ? here.find((t) => t.position === Number(part)) : undefined;
    return (hit ?? here[0]!).position;
}

/** The row holding an element — a desktop row, or a narrow card. */
const rowOf = (el: Element) => el.closest<HTMLElement>("[data-plan-row],[data-plan-card]");
/** A row element's key. */
const keyOfRow = (row: Element) => row.getAttribute("data-plan-row") ?? row.getAttribute("data-plan-card") ?? "";
/** A row's cell at a bucket that takes typing, and the positions it takes. */
function typedCellOf(row: Element, cell: string): { el: HTMLElement; positions: number[] } | undefined {
    const el = [...row.querySelectorAll<HTMLElement>("[data-typed]")].find((c) => c.getAttribute("data-cell") === cell);
    return el === undefined ? undefined : { el, positions: el.getAttribute("data-typed")!.split(" ").map(Number) };
}

/**
 * Move the input to the row above or below that takes a number at the same
 * bucket — the same position where it takes that one — among the rows
 * mounted; none there, it closes.
 *
 * @param typing - The canvas's typing
 * @param from - The cell the input is open on
 * @param cell - Its bucket, as `data-cell` names it
 * @param position - The position typed into
 * @param step - Down (`1`) or up (`-1`)
 */
function moveAcross(typing: PlanTyping, from: HTMLElement, cell: string, position: number, step: 1 | -1): void {
    const row = rowOf(from);
    const frame = row?.closest("[data-virtual-rows],[data-plan-narrow]") ?? from.ownerDocument;
    const rows = [...frame.querySelectorAll<HTMLElement>("[data-plan-row],[data-plan-card]")];
    for (let i = row !== null ? rows.indexOf(row) + step : -1; i >= 0 && i < rows.length; i += step) {
        const there = typedCellOf(rows[i]!, cell);
        if (there === undefined) continue;
        typing.store.openAt({ rowKey: keyOfRow(rows[i]!), position: there.positions.includes(position) ? position : there.positions[0]!, cell });
        return;
    }
    typing.store.close();
}

/** The table-row plot content — per-bucket cells of series-joined parts. */
/** A numeral's width in the table's numerals, in px: 10.5px type, of one width, about 0.62em a character. */
const NUMERAL_PX = 6.5;
/** A cell's inset either side of its numerals, in px. */
const CELL_INSET_PX = 4;
/** The gap between two parts drawn side by side, in px. */
const PART_GAP_PX = 6;

/**
 * How wide a cell's numerals draw, in px: its parts side by side, or the
 * widest of them where they stack.
 *
 * @param texts - Each part's text
 * @param split - How the parts lay out
 * @returns The width
 */
function numeralsPx(texts: readonly string[], split: "horizontal" | "vertical"): number {
    const widths = texts.map((text) => text.length * NUMERAL_PX);
    const inner = split === "vertical" ? Math.max(0, maxOf(widths)) : widths.reduce((a, w) => a + w, 0) + PART_GAP_PX * Math.max(0, texts.length - 1);
    return inner + 2 * CELL_INSET_PX;
}

export function TableRowCells({ rowKey, rowId, series, split, format, styles, ctx, typed, own, parent }: TableRowCellsProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    // Typing (#1436, #1438): never inside a context strip, and only while the canvas takes it.
    const edit = usePlanEdit();
    const typing = ctx === true ? undefined : edit?.typing;
    const open = usePlanTypingOpen(typing?.store, rowKey);
    // A focus asked of the row draws it again, to take it as it draws.
    usePlanTypingFocus(typing?.store, rowKey);
    // The instants its conflicts are at, not yet chosen: the cells holding them wear the warn ring.
    const conflictsAt = usePlanRowConflicts(rowKey);
    // The cells by their bucket, which a popover of the input anchors to below 480px of main.
    const cellEls = useRef(new Map<string, HTMLElement>());
    // The plot's width, which each cell's share of it says whether its numerals fit: unknown before it is laid out.
    const measureRef = useRef<HTMLDivElement | null>(null);
    const plotPx = useElementWidth(measureRef, true);
    const typeables = useMemo(
        () => (typing !== undefined && typed !== undefined && typed.length > 0 ? typeablesOf(scale, typed, own ?? series, parent === true) : NO_TYPEABLES),
        [typing, typed, own, series, parent, scale]);
    // The Plan's zooms, the finest first: its axis's, or, where it states none, the one it shows.
    const zooms = typing === undefined ? [] : typing.zooms.length > 0 ? typing.zooms : scale.resolution !== undefined ? [scale.resolution] : [];
    // At the Plan's finest zoom a bucket takes a typed number holding one value of the position's own, or none; coarser,
    // each cell is a summary, which takes none.
    const types = typesAt(scale.resolution, zooms);
    const takesAt = (t: Typeable, bucket: number): boolean => types && (t.held.get(bucket) ?? 0) <= 1;
    // A zoom from a coarser cell of this row lands on its cell holding the period's middle, once it draws.
    useLayoutEffect(() => {
        const at = typing?.store.takeFocus(rowKey, scale.resolution);
        if (at === undefined) return;
        const b = scale.renderBucketOf(scale.fromNumber(at));
        if (b !== undefined) cellEls.current.get(instantKey(b.start))?.focus({ preventScroll: true });
    });
    /** Zoom to the Plan's finest zoom about a coarser cell's period, to edit it there. */
    const zoomInto = (b: PlanBucket, finest: TimeResolution) => {
        const about = (scale.toNumber(b.start) + scale.toNumber(b.end)) / 2;
        typing?.store.focusOnZoom({ rowKey, at: about, resolution: finest });
        dispatch({ t: "resolution.set", resolution: finest, about });
    };
    // ── R2 (#591): numerals have no small form ──
    // The ROLLUP position is the one that carries the row's headline number
    // (`tableRollupSeries`' contract), so it is the one the strip encodes —
    // a multi-value row shows the shape of its primary series, not an
    // arbitrary overlay of all of them.
    if (ctx === true) {
        const primary = series.find((x) => x.rollup) ?? series[0];
        const data: ToneDatum[] = (primary?.cells ?? []).map((c) => ({
            at: c.at,
            value: c.value.type === "some" ? c.value.value : undefined,
            tone: c.tone.type === "some" && c.tone.value.type === "neg" ? "neg"
                : c.value.type === "some" && c.value.value < 0 ? "neg"
                : undefined,
        }));
        return <ToneStrip data={data} styles={styles} />;
    }
    // Join the series by bucket — parts arrive in series order; a series
    // without a cell in a bucket simply contributes nothing there. RENDER
    // bucketing (#619): overscan cells join and mount too, clipped at rest.
    const bucketByIndex = new Map<number, PlanBucket>();
    const buckets = new Map<number, { si: number; cell: TableCellValue }[]>();
    series.forEach((s, si) => {
        for (const c of s.cells) {
            const b = scale.renderBucketOf(c.at);
            if (b === undefined) continue;
            bucketByIndex.set(b.index, b);
            const list = buckets.get(b.index);
            if (list !== undefined) list.push({ si, cell: c });
            else buckets.set(b.index, [{ si, cell: c }]);
        }
    });
    // Over a row taking typing, every bucket in the window draws a cell, so an empty one takes a first value.
    if (typeables.length > 0) {
        for (const b of scale.buckets) {
            if (buckets.has(b.index)) continue;
            bucketByIndex.set(b.index, b);
            buckets.set(b.index, []);
        }
    }
    const multi = series.length > 1;
    /** Whether a bucket holds a conflict not yet chosen: its period holds an instant one names. */
    const holdsConflict = (b: PlanBucket): boolean => {
        const from = scale.toNumber(b.start), to = scale.toNumber(b.end);
        return conflictsAt.some((at) => { const n = scale.toNumber(timeInstant(at)); return n >= from && n < to; });
    };
    /** The cells along the row that take typing, in order: each bucket's positions, left to right. */
    const along = (): { cell: string; position: number }[] => [...bucketByIndex.values()]
        .sort((a, b) => a.index - b.index)
        .flatMap((b) => typeables.filter((t) => takesAt(t, b.index)).map((t) => ({ cell: instantKey(b.start), position: t.position })));
    // The input, where it is open on this row: its bucket and its position, while both still take typing.
    const openBucket = open !== null ? [...bucketByIndex.values()].find((b) => instantKey(b.start) === open.cell) : undefined;
    const openTypeable = open !== null && openBucket !== undefined
        ? typeables.find((t) => t.position === open.position && takesAt(t, openBucket.index)) : undefined;
    const input = (() => {
        if (typing === undefined || open === null || openBucket === undefined || openTypeable === undefined) return null;
        const b = openBucket;
        const position = openTypeable.position;
        const s = series[position];
        const partFormat = s !== undefined && s.format.type === "some" ? s.format.value : format;
        const held = (own ?? series)[position]?.cells.find((c) => scale.renderBucketOf(c.at)?.index === b.index);
        const current = held !== undefined && held.value.type === "some" ? held.value.value : undefined;
        // The cell it is open on: where focus goes back to, and where a move across the rows starts — the input itself
        // may be in a popover, outside the rows.
        const cellOf = () => cellEls.current.get(open.cell);
        const onWrite = (value: number | undefined, move: PlanCellInputMove, el: HTMLElement) => {
            const unchanged = value === undefined ? current === undefined : current !== undefined && sameNumber(value, current);
            if (!unchanged) {
                // Over the one value the bucket held, at its date, so the number replaces it.
                typing.type({
                    rowKey, position, at: held?.at ?? b.start, bucket: scale.bucketText(b), value,
                    text: value !== undefined ? words.value(value, partFormat) : "",
                });
            }
            if (move === "next" || move === "previous") {
                const cells = along();
                const at = cells.findIndex((c) => c.cell === open.cell && c.position === position);
                const next = cells[at + (move === "next" ? 1 : -1)];
                if (next !== undefined) {
                    typing.store.openAt({ rowKey, ...next });
                    return;
                }
            } else if (move === "up" || move === "down") {
                moveAcross(typing, cellOf() ?? el, open.cell, position, move === "down" ? 1 : -1);
                return;
            }
            const back = move !== "leave" ? cellOf() : undefined;
            typing.store.close();
            back?.focus({ preventScroll: true });
        };
        const onCancel = () => {
            const back = cellOf();
            typing.store.close();
            back?.focus({ preventScroll: true });
        };
        const field = (
            <PlanCellInput key={`${open.cell}|${position}`} styles={styles}
                x0={typing.popover ? undefined : b.x0} x1={typing.popover ? undefined : b.x1} popover={typing.popover}
                text={typedText(current, partFormat, words)} seed={open.seed} whole={openTypeable.whole}
                name={words.m.typedName({ bucket: scale.bucketText(b) })}
                read={(text) => readTyped(text, partFormat, words)} onWrite={onWrite} onCancel={onCancel} />
        );
        if (!typing.popover) return field;
        // Below 480px of main, in a popover anchored to its cell: a press outside it closes it, the field's blur
        // having written what it holds.
        const cell = open.cell;
        return (
            <Popover.Root key={`${cell}|${position}`} open modal={false}
                positioning={{ placement: "bottom", getAnchorElement: () => cellEls.current.get(cell) ?? null }}
                onOpenChange={(d) => { if (!d.open) typing.store.close(); }}>
                <Portal>
                    <Popover.Positioner>
                        <Popover.Content css={styles.tableCellPopover} data-plan-typing-popover="">{field}</Popover.Content>
                    </Popover.Positioner>
                </Portal>
            </Popover.Root>
        );
    })();
    return (
        <>
            <Box ref={measureRef} css={styles.tableCellMeasure} data-plan-measure="" aria-hidden="true" />
            {[...buckets.entries()].map(([bi, parts]) => {
                const b = bucketByIndex.get(bi)!;
                // The positions taking a number here, at the finest zoom: one value of their own in the bucket, or none.
                const typedHere = typeables.filter((t) => takesAt(t, bi));
                const folded = types && typedHere.length === 0 ? typeables.find((t) => (t.held.get(bi) ?? 0) > 1) : undefined;
                // Coarser, a summary: its tooltip says to zoom to the finest, which a double click, Enter or a tap does.
                const coarse = !types && typeables.length > 0 ? zooms[0] : undefined;
                const cell = instantKey(b.start);
                const openHere = (position: number, seed?: string) => typing?.store.openAt({ rowKey, position, cell }, seed);
                const takes = typing !== undefined && typedHere.length > 0;
                const printed = parts.map(({ si, cell }) => {
                    const s = series[si]!;
                    const value = cell.value.type === "some" ? cell.value.value : undefined;
                    const partFormat = s.format.type === "some" ? s.format.value : format;
                    const text = cell.text.type === "some" ? cell.text.value
                        // The declared format, in the canvas's locale (#820),
                        // through the shared interpreter (#850).
                        : value !== undefined ? words.value(value, partFormat)
                        : "—";
                    const tone = cell.tone.type === "some" ? cell.tone.value.type
                        : value === undefined ? "muted"
                        : value < 0 ? "neg"
                        : s.tone.type === "some" ? s.tone.value.type
                        : undefined;
                    return { text, tone, strong: s.strong, si, held: value !== undefined || cell.text.type === "some" };
                });
                // Numerals wider than their column draw a dot in their place where the cell holds a value (#1438).
                const dot = plotPx !== undefined && plotPx > 0 && (b.x1 - b.x0) * plotPx < numeralsPx(printed.map((p) => p.text), split)
                    ? printed.find((p) => p.held) : undefined;
                const conflict = holdsConflict(b);
                return (
                    <Box key={bi} css={styles.tableCellText}
                        data-conflict={conflict ? "" : undefined}
                        ref={(el: HTMLElement | null) => { if (el !== null) cellEls.current.set(cell, el); else cellEls.current.delete(cell); }}
                        data-plan-bucket={bi}
                        // The BUCKET instant — the same subject its click
                        // reports — and focusable for the keyboard path (#816).
                        data-cell={cell}
                        // The positions typing takes here (#1438); a bucket folding several values says where they take one.
                        data-typed={takes ? typedHere.map((t) => t.position).join(" ") : undefined}
                        data-plan-note={folded !== undefined ? words.m.typedFolded({ resolution: folded.resolution, zoom: zoomApart(folded.resolution, zooms) })
                            : coarse !== undefined ? words.m.typedZoomTo({ zoom: coarse }) : undefined}
                        data-plan-frac={b.x0.toFixed(4)}
                        tabIndex={-1}
                        role="button"
                        aria-label={cellName(scale, b, printed.length > 0 ? tablePartsText(printed.map((p) => p.text), words) : words.m.noValue(), words)}
                        data-split={multi ? split : undefined}
                        data-plan-dotted={dot !== undefined ? "" : undefined}
                        style={{ left: `${b.x0 * 100}%`, width: `${(b.x1 - b.x0) * 100}%` }}
                        onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ t: "row.select", key: rowKey });
                            // Parts join BY bucket (their own `at`s may differ
                            // inside it) — the BUCKET instant is the honest
                            // subject, exactly as the payload documents.
                            onElementClick?.(variant("cell", { row: rowId, at: b.start }) as PlanElementRefValue);
                            // Below 480px of main, a tap opens the input (#1438), or on a summary zooms in to edit it.
                            if (takes && typing.popover) openHere(positionAt(e.target, typedHere));
                            else if (coarse !== undefined && typing?.popover === true) zoomInto(b, coarse);
                        }}
                        onDoubleClick={takes ? (e) => { e.stopPropagation(); openHere(positionAt(e.target, typedHere)); }
                            : coarse !== undefined ? (e) => { e.stopPropagation(); zoomInto(b, coarse); } : undefined}
                        onKeyDown={takes ? (e: KeyboardEvent<HTMLElement>) => {
                            if (e.altKey || e.ctrlKey || e.metaKey) return;
                            // A digit, a minus or the decimal separator opens it typed in.
                            const seed = /^\d$/.test(e.key) || e.key === "-" || e.key === words.separators.decimal ? e.key : undefined;
                            if (e.key !== "Enter" && e.key !== "F2" && seed === undefined) return;
                            e.preventDefault();
                            e.stopPropagation();
                            openHere(typedHere[0]!.position, seed);
                        } : coarse !== undefined ? (e: KeyboardEvent<HTMLElement>) => {
                            if (e.key !== "Enter" || e.altKey || e.ctrlKey || e.metaKey) return;
                            e.preventDefault();
                            e.stopPropagation();
                            zoomInto(b, coarse);
                        } : undefined}
                    >
                        {/* Its numerals, together: drawn whole, or — wider than the cell — off its line, out of
                            sight, and said by the cell's hover (#1269); never some of them. A cell holding a value its
                            column cannot draw draws a dot in their place, its numerals kept, hidden, for the hover
                            to say (#1438). */}
                        <Box as="span" css={styles.tableCellGroup} data-table-parts="" data-plan-label="">
                            {printed.map(({ text, tone, strong, si }, i) => (
                                <Box key={i} as="span" css={styles.tableCellPart} data-part={si}
                                    data-tone={tone} data-strong={strong ? "" : undefined}>
                                    {text}
                                </Box>
                            ))}
                        </Box>
                        {dot !== undefined && <Box as="span" css={styles.tableCellDot} data-plan-cell-dot=""
                            data-tone={dot.tone} data-strong={dot.strong ? "" : undefined} />}
                    </Box>
                );
            })}
            {input}
        </>
    );
}
