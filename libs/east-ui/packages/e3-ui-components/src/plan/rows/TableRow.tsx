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
 * (#1269).
 *
 * A position its row says takes a typed number (#1436, #1438) takes one in
 * each bucket holding one of its own values, or none, while the canvas takes
 * typing — every bucket in the window then draws a cell, so an empty one takes
 * a first value. Enter, F2, a double click or a digit opens the canvas's one
 * input over the cell ({@link PlanCellInput}); below 480px of main a tap opens
 * it, in a popover anchored to the cell. A parent's position drawing its
 * children's subtotals takes none, and a bucket folding several values says,
 * as its tooltip, the resolution they take one at.
 */

import { useMemo, useRef, type KeyboardEvent } from "react";
import { FloatType, equalFor, variant, type ValueTypeOf } from "@elaraai/east";
import { Box, Popover, Portal } from "@chakra-ui/react";
import { Plan } from "@elaraai/e3-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import type { TickFormatOpt } from "@elaraai/east-ui-components";
import { ToneStrip, type ToneDatum } from "./ToneStrip.js";
import type { PlanBucket, PlanScale } from "../scale.js";
import { instantKey } from "../instant.js";
import { usePlanEdit } from "../edit/store.js";
import { readTyped, resolutionOfValues, typedText, usePlanTypingOpen, type PlanTyping } from "../edit/typing.js";
import { PlanCellInput, type PlanCellInputMove } from "./CellInput.js";
import { cellName, tablePartsText } from "../a11y.js";
import type { PlanRowId } from "../model.js";
import { usePlanWords } from "../words.js";

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
    readonly resolution: string | undefined;
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
export function TableRowCells({ rowKey, rowId, series, split, format, styles, ctx, typed, own, parent }: TableRowCellsProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    // Typing (#1436, #1438): never inside a context strip, and only while the canvas takes it.
    const edit = usePlanEdit();
    const typing = ctx === true ? undefined : edit?.typing;
    const open = usePlanTypingOpen(typing?.store, rowKey);
    // The cells by their bucket, which a popover of the input anchors to below 480px of main.
    const cellEls = useRef(new Map<string, HTMLElement>());
    const typeables = useMemo(
        () => (typing !== undefined && typed !== undefined && typed.length > 0 ? typeablesOf(scale, typed, own ?? series, parent === true) : NO_TYPEABLES),
        [typing, typed, own, series, parent, scale]);
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
    /** The cells along the row that take typing, in order: each bucket's positions, left to right. */
    const along = (): { cell: string; position: number }[] => [...bucketByIndex.values()]
        .sort((a, b) => a.index - b.index)
        .flatMap((b) => typeables.filter((t) => (t.held.get(b.index) ?? 0) <= 1).map((t) => ({ cell: instantKey(b.start), position: t.position })));
    // The input, where it is open on this row: its bucket and its position, while both still take typing.
    const openBucket = open !== null ? [...bucketByIndex.values()].find((b) => instantKey(b.start) === open.cell) : undefined;
    const openTypeable = open !== null && openBucket !== undefined
        ? typeables.find((t) => t.position === open.position && (t.held.get(openBucket.index) ?? 0) <= 1) : undefined;
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
                typing.type({
                    rowKey, position, at: b.start, bucket: scale.bucketText(b), value,
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
            {[...buckets.entries()].map(([bi, parts]) => {
                const b = bucketByIndex.get(bi)!;
                // The positions taking a number here: one value of their own in the bucket, or none.
                const typedHere = typeables.filter((t) => (t.held.get(bi) ?? 0) <= 1);
                const folded = typedHere.length === 0 ? typeables.find((t) => (t.held.get(bi) ?? 0) > 1) : undefined;
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
                    return { text, tone, strong: s.strong, si };
                });
                return (
                    <Box key={bi} css={styles.tableCellText}
                        ref={(el: HTMLElement | null) => { if (el !== null) cellEls.current.set(cell, el); else cellEls.current.delete(cell); }}
                        data-plan-bucket={bi}
                        // The BUCKET instant — the same subject its click
                        // reports — and focusable for the keyboard path (#816).
                        data-cell={cell}
                        // The positions typing takes here (#1438); a bucket folding several values says where they take one.
                        data-typed={takes ? typedHere.map((t) => t.position).join(" ") : undefined}
                        data-plan-note={folded !== undefined ? words.m.typedFolded({ resolution: folded.resolution }) : undefined}
                        data-plan-frac={b.x0.toFixed(4)}
                        tabIndex={-1}
                        role="button"
                        aria-label={cellName(scale, b, printed.length > 0 ? tablePartsText(printed.map((p) => p.text), words) : words.m.noValue(), words)}
                        data-split={multi ? split : undefined}
                        left={`${b.x0 * 100}%`} width={`${(b.x1 - b.x0) * 100}%`}
                        onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ t: "row.select", key: rowKey });
                            // Parts join BY bucket (their own `at`s may differ
                            // inside it) — the BUCKET instant is the honest
                            // subject, exactly as the payload documents.
                            onElementClick?.(variant("cell", { row: rowId, at: b.start }) as PlanElementRefValue);
                            // Below 480px of main, a tap opens the input (#1438).
                            if (takes && typing.popover) openHere(positionAt(e.target, typedHere));
                        }}
                        onDoubleClick={takes ? (e) => { e.stopPropagation(); openHere(positionAt(e.target, typedHere)); } : undefined}
                        onKeyDown={takes ? (e: KeyboardEvent<HTMLElement>) => {
                            if (e.altKey || e.ctrlKey || e.metaKey) return;
                            // A digit, a minus or the decimal separator opens it typed in.
                            const seed = /^\d$/.test(e.key) || e.key === "-" || e.key === words.separators.decimal ? e.key : undefined;
                            if (e.key !== "Enter" && e.key !== "F2" && seed === undefined) return;
                            e.preventDefault();
                            e.stopPropagation();
                            openHere(typedHere[0]!.position, seed);
                        } : undefined}
                    >
                        {/* Its numerals, together: drawn whole, or — wider than the cell — off its line, out of
                            sight, and said by the cell's hover (#1269); never some of them. */}
                        <Box as="span" css={styles.tableCellGroup} data-table-parts="" data-plan-label="">
                            {printed.map(({ text, tone, strong, si }, i) => (
                                <Box key={i} as="span" css={styles.tableCellPart} data-part={si}
                                    data-tone={tone} data-strong={strong ? "" : undefined}>
                                    {text}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                );
            })}
            {input}
        </>
    );
}
