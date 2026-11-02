/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An action column's cell (#1475, `Sheet Action Column - Behaviour Spec.md`
 * §1–§3, §10): the left zone — the state's dot and word, then its summary,
 * or with nothing taken the absent value — then the next half, the offer's
 * first case, and the ▾ part holding the rest. The controls fill the cell
 * flush inside its rules and set no position of their own, so the grid's
 * ring, the cell's last child, paints over them (S11, S12). A row that may
 * not act now keeps its controls, off (T6); a cell that takes no action —
 * read only, owned, a phone's (T9, X4) — shows the state alone.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type MouseEvent } from "react";
import { chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faAngleDown } from "@fortawesome/free-solid-svg-icons";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useSheetWords } from "../words.js";
import type { SheetCellValue } from "../values.js";
import { canTake, verbOf, type ActionCase, type ActionColumn, type ActionOffer } from "./model.js";
import type { SheetActionHost } from "./host.js";

/** Which control of the cell holds its overlay open. */
export type ActionHeld = "next" | "more";

/** Props of {@link ActionCell}. */
export interface ActionCellProps {
    /** The column's machine. */
    column: ActionColumn;
    /** The row's summary: what follows its state (S7). */
    summary: string;
    /** The row's offer. */
    offer: ActionOffer;
    /** Whether the cell draws its controls: not on a read-only sheet, an owned row, a column that takes no edit, or a phone (T9, X4). */
    controls: boolean;
    /** The cell's value is a draft (ST3). */
    dirty: boolean;
    /** The ring is on the cell (ST2). */
    selected: boolean;
    /** The control whose overlay is open. */
    held: ActionHeld | undefined;
    /** An auto save of the cell is in flight: the dot's echo runs (N2). */
    live: boolean;
    /** The next half pressed: take its case, or open its overlay. */
    onNext: (c: ActionCase, anchor: HTMLElement) => void;
    /** The ▾ part pressed: open the Menu of the rest of the offer. */
    onMore: (anchor: HTMLElement) => void;
    /** The pointer rests on a control (P8): its case, or `undefined` as it leaves. */
    onPreview?: ((c: ActionCase | undefined) => void) | undefined;
}

/** The widest state word among a column's cases, by its characters: the slot every state takes (S5). */
const slots = new WeakMap<ActionColumn, string>();
function stateSlot(column: ActionColumn): string {
    const known = slots.get(column);
    if (known !== undefined) return known;
    const n = column.order.reduce((max, c) => Math.max(max, c.state.length), 0);
    // A mono word's width is its characters and their tracking; then the dot and the gap (S4).
    const slot = `calc(${n}ch + ${n * 0.1}em + 16px)`;
    slots.set(column, slot);
    return slot;
}

/** A case's icon, in its 14px slot; the slot is kept empty where it has none (S9). */
function Icon({ css, c }: { css: unknown; c: ActionCase }) {
    return (
        <chakra.span css={css as never} data-slot="actionIcon" data-check={c.icon === "check" ? "" : undefined} aria-hidden="true">
            {c.icon !== undefined && <FontAwesomeIcon icon={["fas", c.icon as IconName]} />}
        </chakra.span>
    );
}

/** Stop the grid taking a press on a control as a press on its cell, and keep the focus where it is (K1). */
function hold(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
}

/** Renders an action column's cell. */
export const ActionCell = memo(function ActionCell({ column, summary, offer, controls, dirty, selected, held, live, onNext, onMore, onPreview }: ActionCellProps) {
    const styles = useSlotStyles("sheetAction");
    const { m } = useSheetWords();
    const slot = useMemo(() => stateSlot(column), [column]);
    const state = offer.state;
    const first = offer.offered[0];
    const rest = offer.offered.length > 1;
    const open = canTake(offer);
    const shown = controls && first !== undefined;
    const tone = state?.tone;
    // A column that can offer more than one case keeps its ▾ part's room on every row, so its next halves line up.
    const roomForMore = useMemo(() => column.start.length > 1 || column.order.some((c) => c.next.length > 1), [column]);
    // The control the pointer rests on, until it leaves — or goes from under it, as a case taken removes it (P8).
    const resting = useRef<string | undefined>(undefined);
    const restingCase = shown ? first.name : undefined;
    useEffect(() => {
        if (resting.current !== undefined && resting.current !== restingCase) { resting.current = undefined; onPreview?.(undefined); }
    }, [restingCase, onPreview]);
    useEffect(() => () => { if (resting.current !== undefined) onPreview?.(undefined); }, [onPreview]);
    return (
        <chakra.div css={styles.root} data-slot="actionCell" data-on={selected || dirty ? "" : undefined}
            style={{ ["--action-slot" as string]: slot }}>
            <chakra.div css={styles.zone} data-slot="actionZone">
                {state !== undefined ? (
                    <>
                        <chakra.span css={styles.state} data-slot="actionState" data-tone={tone} data-dirty={dirty ? "" : undefined} data-case={state.name}>
                            <chakra.span css={styles.dot} data-slot="actionDot" data-live={live ? "" : undefined} aria-hidden="true" />
                            {state.state}
                        </chakra.span>
                        {summary !== "" && <chakra.span css={styles.summary} data-slot="actionSummary" data-dirty={dirty ? "" : undefined}>{summary}</chakra.span>}
                    </>
                ) : (
                    <chakra.span css={styles.absent} data-slot="actionAbsent">
                        {offer.offered.length > 0 ? m.actionNotStarted() : offer.blocked ?? m.actionNotStarted()}
                    </chakra.span>
                )}
            </chakra.div>
            {shown && (
                <chakra.button type="button" css={styles.next} data-slot="actionNext" data-kind={first.kind} data-case={first.name}
                    tabIndex={-1} disabled={!open} data-disabled={open ? undefined : ""} data-held={held === "next" ? "" : undefined}
                    aria-haspopup={first.kind === "button" ? undefined : first.kind === "form" ? "dialog" : "menu"}
                    aria-expanded={first.kind === "button" ? undefined : held === "next"}
                    title={offer.incomplete !== undefined ? m.actionIncomplete({ fields: offer.incomplete }) : offer.blocked}
                    onMouseDown={hold}
                    onClick={(event) => { event.stopPropagation(); if (open) onNext(first, event.currentTarget); }}
                    onMouseEnter={() => { resting.current = first.name; onPreview?.(first); }}
                    onMouseLeave={() => { resting.current = undefined; onPreview?.(undefined); }}>
                    <Icon css={styles.icon} c={first} />
                    {verbOf(first)}
                    {first.kind === "choice" && <chakra.span css={styles.caret} data-slot="actionCaret" aria-hidden="true"><FontAwesomeIcon icon={faAngleDown} /></chakra.span>}
                </chakra.button>
            )}
            {shown && rest && (
                <chakra.button type="button" css={styles.more} data-slot="actionMore" tabIndex={-1}
                    disabled={!open} data-disabled={open ? undefined : ""} data-held={held === "more" ? "" : undefined}
                    aria-label={m.actionMore()} title={m.actionMore()} aria-haspopup="menu" aria-expanded={held === "more"}
                    onMouseDown={hold}
                    onClick={(event) => { event.stopPropagation(); if (open) onMore(event.currentTarget); }}>
                    <FontAwesomeIcon icon={faAngleDown} aria-hidden />
                </chakra.button>
            )}
            {shown && !rest && roomForMore && <chakra.span css={styles.moreSpace} data-slot="actionMoreSpace" aria-hidden="true" />}
        </chakra.div>
    );
});

/** Props of {@link ActionCellSlot}. */
export interface ActionCellSlotProps {
    /** What the cell asks of its sheet. */
    host: SheetActionHost;
    /** The row-space index. */
    r: number;
    /** The column's key. */
    columnKey: string;
    /** The column's machine. */
    column: ActionColumn;
    /** The row's action cell. */
    cell: SheetCellValue | undefined;
    /** The row's summary. */
    summary: string;
    /** The ring is on the cell. */
    selected: boolean;
}

/**
 * An action cell in its row: it listens to its sheet's host, so an edit
 * anywhere that may move its offer draws it again, and nothing else of the
 * row (#858).
 */
export const ActionCellSlot = memo(function ActionCellSlot({ host, r, columnKey, column, cell, summary, selected }: ActionCellSlotProps) {
    const seq = useSyncExternalStore(host.subscribe, host.version, host.version);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `seq` is the host's say that what the offer reads moved
    const offer = useMemo(() => host.offer(r, columnKey), [host, r, columnKey, cell, seq]);
    const onNext = useCallback((c: ActionCase, anchor: HTMLElement) => host.next(r, columnKey, c, anchor), [host, r, columnKey]);
    const onMore = useCallback((anchor: HTMLElement) => host.more(r, columnKey, anchor), [host, r, columnKey]);
    const onPreview = useCallback((c: ActionCase | undefined) => host.preview(r, columnKey, c), [host, r, columnKey]);
    if (offer === undefined) return null;
    return (
        <ActionCell column={column} summary={summary} offer={offer} selected={selected}
            controls={host.controls(r, columnKey)} dirty={host.dirty(r, columnKey)} held={host.held(r, columnKey)} live={host.live(r, columnKey)}
            onNext={onNext} onMore={onMore} onPreview={onPreview} />
    );
});
