/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faGripVertical, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { equalFor, match, some, none, variant, type ValueTypeOf } from "@elaraai/east";
import { Roster, type CellRefType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";
import { useDragTarget, useDropCell, useDragEventChip, type DragEventValue, type DragMeta, type DragPayload } from "../../dnd/drag-layer";
import { useIRCanDrop, canDropAllows, type CanDropFn } from "../../dnd/ir-can-drop";
import { useReviewController, DecisionButtons, ReviewFoot, DECISION_WIDTH } from "../shared/review";

const rosterEqual = equalFor(Roster.Types.Roster);

/** East Roster value type. */
export type RosterValue = ValueTypeOf<typeof Roster.Types.Roster>;

/** East Roster shift value type. */
export type RosterShiftValue = ValueTypeOf<typeof Roster.Types.Shift>;

/** A drag-grammar cell reference value. */
type CellRefValue = ValueTypeOf<CellRefType>;

export interface EastChakraRosterProps {
    value: RosterValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;

function cellRef(surface: string, person: string, day: string, event?: string): CellRefValue {
    return { surface, row: person, slot: day, event: event !== undefined ? some(event) : none };
}

/** The chip text per the spec's visual grammar for each state. */
function chipText(shift: RosterShiftValue): string {
    return match(shift.state, {
        committed: () => shift.label,
        rejected: () => shift.label,
        proposed: (flavour) => match(flavour, {
            added: () => `+${shift.label}`,
            removed: () => `${shift.label} ▸ —`,
            model: () => `+ ghost ${shift.label}`,
        }),
    });
}

function stateAttr(shift: RosterShiftValue): string {
    return match(shift.state, {
        committed: () => "committed",
        rejected: () => "rejected",
        proposed: (flavour) => match(flavour, {
            added: () => "added",
            removed: () => "removed",
            model: () => "model",
        }),
    });
}

// ============================================================================
// Chip
// ============================================================================

interface RosterChipProps {
    surface: string;
    person: string;
    day: string;
    shift: RosterShiftValue;
    edit: boolean;
    styles: SlotStyles;
    onSelect?: ((ref: CellRefValue) => void) | undefined;
    onAccept?: ((ref: CellRefValue) => void) | undefined;
    onRemove?: ((ref: CellRefValue) => void) | undefined;
}

function RosterChip({ surface, person, day, shift, edit, styles, onSelect, onAccept, onRemove }: RosterChipProps) {
    const state = stateAttr(shift);
    const ghost = state === "model";
    // Only proposed shifts are draggable, and only in edit mode.
    const draggable = edit && (state === "added" || state === "removed" || state === "model");

    const from = useMemo(
        () => ({ surface, row: person, slot: day, event: shift.key }),
        [surface, person, day, shift.key],
    );
    const dragGhost = useMemo(() => (
        <Box css={styles.dragGhost}>{shift.label}</Box>
    ), [styles.dragGhost, shift.label]);
    const onPointerDown = useDragEventChip(from, dragGhost, !draggable);

    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const ref = cellRef(surface, person, day, shift.key);
        // The ghost's click IS its acceptance affordance.
        if (ghost && onAccept) onAccept(ref);
        else if (onSelect) onSelect(ref);
    }, [surface, person, day, shift.key, ghost, onAccept, onSelect]);

    return (
        <Box
            css={styles.chip}
            data-state={state}
            onPointerDown={onPointerDown}
            onClick={handleClick}
            {...(draggable && onPointerDown ? { "data-draggable": "" } : {})}
        >
            {draggable && onPointerDown && (
                <Box as="span" css={styles.chipGrip}>
                    <FontAwesomeIcon icon={faGripVertical} />
                </Box>
            )}
            {chipText(shift)}
            {ghost && onAccept && (
                <Box
                    as="button"
                    css={styles.chipAction}
                    aria-label="Accept ghost shift"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); onAccept(cellRef(surface, person, day, shift.key)); }}
                >
                    <FontAwesomeIcon icon={faCheck} />
                </Box>
            )}
            {draggable && onRemove && (
                <Box
                    as="button"
                    css={styles.chipAction}
                    data-danger=""
                    aria-label="Remove shift"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove(cellRef(surface, person, day, shift.key)); }}
                >
                    <FontAwesomeIcon icon={faTrashCan} />
                </Box>
            )}
        </Box>
    );
}

// ============================================================================
// Cell
// ============================================================================

interface RosterCellProps {
    surface: string;
    person: string;
    day: string;
    shifts: RosterShiftValue[];
    edit: boolean;
    styles: SlotStyles;
    /** Per-cell veto builder from the root's IR `canDrop` (#261). */
    vetoFor?: ((coord: { surface: string; row: string; slot: string }) => (payload: DragPayload) => boolean) | undefined;
    onSelect?: ((ref: CellRefValue) => void) | undefined;
    onAccept?: ((ref: CellRefValue) => void) | undefined;
    onRemove?: ((ref: CellRefValue) => void) | undefined;
    onAddAt?: ((ref: CellRefValue) => void) | undefined;
}

function RosterCell({ surface, person, day, shifts, edit, styles, vetoFor, onSelect, onAccept, onRemove, onAddAt }: RosterCellProps) {
    const coord = useMemo(() => ({ surface, row: person, slot: day }), [surface, person, day]);
    const veto = useMemo(() => vetoFor?.(coord), [vetoFor, coord]);
    const dropRef = useDropCell(edit ? coord : null, false, veto);

    const handleClick = useCallback(() => {
        if (edit && shifts.length === 0 && onAddAt) onAddAt(cellRef(surface, person, day));
    }, [edit, shifts.length, onAddAt, surface, person, day]);

    return (
        <Box
            ref={dropRef}
            css={styles.cell}
            onClick={handleClick}
            {...(edit && shifts.length === 0 && onAddAt ? { "data-addable": "" } : {})}
        >
            {shifts.map(shift => (
                <RosterChip
                    key={shift.key}
                    surface={surface}
                    person={person}
                    day={day}
                    shift={shift}
                    edit={edit}
                    styles={styles}
                    onSelect={onSelect}
                    onAccept={onAccept}
                    onRemove={onRemove}
                />
            ))}
        </Box>
    );
}

// ============================================================================
// Roster
// ============================================================================

/**
 * Renders an East UI Roster value — the people × days shift grid. Registers
 * as the DnD **target** under `value.id` in edit mode: cells accept `add`
 * drops from the declared Libraries, proposed chips drag (`move` /
 * `remove`), and every completed drag funnels through `onDrag`.
 */
export const EastChakraRoster = memo(function EastChakraRoster({ value, storageKey }: EastChakraRosterProps) {
    const styles = useSlotRecipe({ key: "roster" })() as SlotStyles;
    const edit = value.mode.type === "edit";

    // Interactive-state pattern: drops and acceptances apply to local shift
    // state immediately (the widget works without callbacks); the callbacks
    // persist the change, and the prop sync reconciles authoritative data.
    const [shifts, setShifts] = useState<RosterShiftValue[]>(() => [...value.shifts]);
    useEffect(() => { setShifts([...value.shifts]); }, [value.shifts]);

    const onDragFn = useMemo(() => getSomeorUndefined(value.onDrag), [value.onDrag]);
    const canDropFn = useMemo(() => getSomeorUndefined(value.canDrop) as CanDropFn | undefined, [value.canDrop]);
    const vetoFor = useIRCanDrop(canDropFn);

    // ── Review chrome (optional, #265) ────────────────────────────────────
    // Row-level review (rows = people): the shared Decision column at the
    // grid's right edge + the commitBar foot. Composes with — does not
    // replace — per-tile ghost accept: ✓ resolves ONE ghost,
    // review.onApprove({ rowIndex }) signs off a LINE (interplay host-owned).
    const review = useMemo(() => getSomeorUndefined(value.review), [value.review]);
    const approvals = useMemo(() => value.people.map((person) => person.approval), [value]);
    const reviewController = useReviewController(review, approvals);
    const chromeRecipe = useSlotRecipe({ key: "reviewChrome" });
    const reviewChrome = useMemo(() => chromeRecipe({}) as SlotStyles, [chromeRecipe]);
    const reviewDotStyles = useMemo(() => {
        const out: Record<string, SystemStyleObject> = {};
        for (const t of ["success", "warning", "danger", "info", "neutral"]) out[t] = (chromeRecipe({ status: t } as Record<string, unknown>) as SlotStyles).statusDot ?? {};
        return out;
    }, [chromeRecipe]);
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const onAcceptFn = useMemo(() => getSomeorUndefined(value.onAccept), [value.onAccept]);
    const onAddAtFn = useMemo(() => getSomeorUndefined(value.onAddAt), [value.onAddAt]);

    const handleDrag = useCallback((event: DragEventValue, meta?: DragMeta) => {
        // Re-check the IR veto with the real event before mutating (the hover
        // veto already gated the ⊘ stage; sink removes are always valid).
        if ((event.type === "add" || event.type === "move") && !canDropAllows(canDropFn, event)) return;
        let next = shifts;
        if (event.type === "add") {
            const { from, into } = event.value;
            next = [...shifts, {
                key: `local:${from.library}:${from.key}:${into.row}:${into.slot}:${shifts.length}`,
                person: into.row,
                day: into.slot,
                label: meta?.label ?? from.key,
                state: variant("proposed", variant("added", null)),
            }];
        } else if (event.type === "move") {
            const { from, to } = event.value;
            const key = from.event.type === "some" ? from.event.value : undefined;
            next = shifts.map(shift => shift.key === key
                ? { ...shift, person: to.row, day: to.slot }
                : shift);
        } else if (event.type === "remove") {
            const key = event.value.from.event.type === "some" ? event.value.from.event.value : undefined;
            next = shifts.filter(shift => shift.key !== key);
        }
        setShifts(next);
        if (onDragFn) queueMicrotask(() => onDragFn(event));
    }, [shifts, onDragFn, canDropFn]);
    const handleSelect = useMemo(() => onSelectFn
        ? (ref: CellRefValue) => queueMicrotask(() => onSelectFn(ref))
        : undefined, [onSelectFn]);
    const handleAccept = useCallback((ref: CellRefValue) => {
        const key = ref.event.type === "some" ? ref.event.value : undefined;
        const next = shifts.map(shift =>
            shift.key === key && shift.state.type === "proposed" && shift.state.value.type === "model"
                ? { ...shift, state: variant("proposed", variant("added", null)) as RosterShiftValue["state"] }
                : shift);
        setShifts(next);
        if (onAcceptFn) queueMicrotask(() => onAcceptFn(ref));
    }, [shifts, onAcceptFn]);
    const handleRemove = useCallback((ref: CellRefValue) => {
        const key = ref.event.type === "some" ? ref.event.value : undefined;
        setShifts(shifts.filter(shift => shift.key !== key));
        if (onDragFn) {
            const event: DragEventValue = variant("remove", { from: ref, to: variant("trash", null) });
            queueMicrotask(() => onDragFn(event));
        }
    }, [shifts, onDragFn]);

    const handleAddAt = useMemo(() => onAddAtFn
        ? (ref: CellRefValue) => queueMicrotask(() => onAddAtFn(ref))
        : undefined, [onAddAtFn]);

    const targetConfig = useMemo(() => edit ? {
        id: value.id,
        sources: [...value.sources],
        kinds: { add: true, move: true, remove: true },
        onDrag: handleDrag,
    } : null, [edit, value.id, value.sources, handleDrag]);
    useDragTarget(targetConfig);

    // Group shifts into cells by person × day.
    const cells = useMemo(() => {
        const out = new Map<string, RosterShiftValue[]>();
        for (const shift of shifts) {
            // Published rosters render committed shifts only.
            if (!edit && shift.state.type !== "committed") continue;
            const key = `${shift.person} ${shift.day}`;
            if (!out.has(key)) out.set(key, []);
            out.get(key)!.push(shift);
        }
        return out;
    }, [shifts, edit]);

    const summary = getSomeorUndefined(value.summary);

    // Uniform sizing contract (#320) — bound the grid; it scrolls within.
    const boundH = parseCssSize(getSomeorUndefined(value.height));
    const boundMaxH = parseCssSize(getSomeorUndefined(value.maxHeight));
    return (
        <Box css={styles.root} height={boundH} maxHeight={boundMaxH} {...((boundH ?? boundMaxH) !== undefined ? { overflowY: "auto" as const, minHeight: "0" } : {})}>
            <Box css={styles.grid} style={{ gridTemplateColumns: `${getSomeorUndefined(value.personWidth) ?? "150px"} repeat(${value.days.length}, 1fr)${reviewController !== undefined ? ` ${DECISION_WIDTH}` : ""}` }}>
                <Box css={styles.headerCell}>{value.personHeader}</Box>
                {value.days.map(day => (
                    <Box key={day} css={styles.headerCell}>{day}</Box>
                ))}
                {reviewController !== undefined && review !== undefined && (
                    <Box css={reviewChrome.decisionHeader} data-slot="decisionHeader">{review.columnLabel}</Box>
                )}
                {value.people.map((person, personIndex) => {
                    const sublabel = getSomeorUndefined(person.sublabel);
                    const rowStatusTag = reviewController !== undefined ? getSomeorUndefined(person.status)?.type : undefined;
                    return [
                        <Box key={`${person.key}-label`} css={styles.personCell}>
                            <Box as="span" css={styles.personLabel}>
                                {rowStatusTag !== undefined && <Box as="span" css={reviewDotStyles[rowStatusTag]} data-slot="statusDot" />}
                                {person.label}
                            </Box>
                            {sublabel && <Box as="span" css={styles.personSublabel}>{sublabel}</Box>}
                        </Box>,
                        ...value.days.map(day => (
                            <RosterCell
                                key={`${person.key}-${day}`}
                                surface={value.id}
                                person={person.key}
                                day={day}
                                shifts={cells.get(`${person.key} ${day}`) ?? []}
                                edit={edit}
                                styles={styles}
                                vetoFor={vetoFor}
                                onSelect={handleSelect}
                                onAccept={edit ? handleAccept : undefined}
                                onRemove={edit ? handleRemove : undefined}
                                onAddAt={handleAddAt}
                            />
                        )),
                        ...(reviewController !== undefined ? [(
                            <Box
                                key={`${person.key}-decision`}
                                css={reviewChrome.decisionCol}
                                data-slot="decisionCol"
                                data-status={rowStatusTag}
                                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            >
                                <DecisionButtons rowIndex={personIndex} controller={reviewController} />
                            </Box>
                        )] : []),
                    ];
                })}
            </Box>
            {(summary !== undefined || edit) && (
                <Box css={styles.strip}>
                    {summary !== undefined && <Box as="span" css={styles.stripSummary}>{summary}</Box>}
                    {edit && (
                        <Box as="span" css={styles.stripHint}>
                            drag handles ⠿ · click empty cell to add · ✓ accept ghost · ⌫ remove
                        </Box>
                    )}
                </Box>
            )}
            {reviewController !== undefined && reviewController.showFoot && (
                <ReviewFoot controller={reviewController} storageKey={storageKey} />
            )}
        </Box>
    );
}, (prev, next) => rosterEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
