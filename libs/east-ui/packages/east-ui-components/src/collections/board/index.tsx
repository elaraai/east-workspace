/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Popover, Portal, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faGripVertical, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { equalFor, match, some, none, variant, type ValueTypeOf } from "@elaraai/east";
import { Board, type CellRefType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";
import { VirtualRows } from "../virtual-rows.js";
import { useDragTarget, useDropCell, useDragEventChip, type DragEventValue, type DragMeta, type DragPayload } from "../../dnd/drag-layer";
import { useIRCanDrop, canDropAllows, type CanDropFn } from "../../dnd/ir-can-drop";
import { useReviewController, ReviewFoot } from "../shared/review";

const boardEqual = equalFor(Board.Types.Board);

/** East Board value type. */
export type BoardValue = ValueTypeOf<typeof Board.Types.Board>;

/** East Board entity value type (area / shift / person). */
export type BoardEntityValue = ValueTypeOf<typeof Board.Types.Entity>;

/** East Board assignment value type. */
export type BoardAssignmentValue = ValueTypeOf<typeof Board.Types.Assignment>;

/** A drag-grammar cell reference value. */
type CellRefValue = ValueTypeOf<CellRefType>;

export interface EastChakraBoardProps {
    value: BoardValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;

function cellRef(surface: string, area: string, shift: string, event?: string): CellRefValue {
    return { surface, row: area, slot: shift, event: event !== undefined ? some(event) : none };
}

/** The chip face per state — glyph decorations only, never words. */
function chipText(label: string, assignment: BoardAssignmentValue): string {
    return match(assignment.state, {
        committed: () => label,
        rejected: () => label,
        proposed: (flavour) => match(flavour, {
            added: () => `+${label}`,
            removed: () => label,
            model: () => `+${label}`,
        }),
    });
}

function stateAttr(assignment: BoardAssignmentValue): string {
    return match(assignment.state, {
        committed: () => "committed",
        rejected: () => "rejected",
        proposed: (flavour) => match(flavour, {
            added: () => "added",
            removed: () => "removed",
            model: () => "model",
        }),
    });
}

/** Whether the assignment occupies headcount (committed or proposed-added). */
function fills(assignment: BoardAssignmentValue): boolean {
    const state = stateAttr(assignment);
    return state === "committed" || state === "added";
}

// ============================================================================
// Chip
// ============================================================================

interface BoardChipProps {
    surface: string;
    area: string;
    shift: string;
    assignment: BoardAssignmentValue;
    /** The resolved person face (people-join label, or the raw person key). */
    label: string;
    edit: boolean;
    /** Disables the drag grip (overflow-popover chips — drag-out is deferred). */
    dragDisabled?: boolean;
    styles: SlotStyles;
    onSelect?: ((ref: CellRefValue) => void) | undefined;
    onAccept?: ((ref: CellRefValue) => void) | undefined;
    onRemove?: ((ref: CellRefValue) => void) | undefined;
}

function BoardChip({ surface, area, shift, assignment, label, edit, dragDisabled, styles, onSelect, onAccept, onRemove }: BoardChipProps) {
    const state = stateAttr(assignment);
    const ghost = state === "model";
    // Only proposed assignments are draggable, and only in edit mode.
    const draggable = edit && !dragDisabled && (state === "added" || state === "removed" || state === "model");

    const from = useMemo(
        () => ({ surface, row: area, slot: shift, event: assignment.key }),
        [surface, area, shift, assignment.key],
    );
    const dragGhost = useMemo(() => (
        <Box css={styles.dragGhost}>{label}</Box>
    ), [styles.dragGhost, label]);
    const onPointerDown = useDragEventChip(from, dragGhost, !draggable);

    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const ref = cellRef(surface, area, shift, assignment.key);
        // The ghost's click IS its acceptance affordance.
        if (ghost && onAccept) onAccept(ref);
        else if (onSelect) onSelect(ref);
    }, [surface, area, shift, assignment.key, ghost, onAccept, onSelect]);

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
            {chipText(label, assignment)}
            {ghost && onAccept && (
                <Box
                    as="button"
                    css={styles.chipAction}
                    aria-label="Accept ghost assignment"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); onAccept(cellRef(surface, area, shift, assignment.key)); }}
                >
                    <FontAwesomeIcon icon={faCheck} />
                </Box>
            )}
            {draggable && onRemove && (
                <Box
                    as="button"
                    css={styles.chipAction}
                    data-danger=""
                    aria-label="Remove assignment"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove(cellRef(surface, area, shift, assignment.key)); }}
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

interface BoardCellProps {
    surface: string;
    area: string;
    shift: string;
    /** Cell assignments paired with their resolved person faces. */
    chips: Array<{ assignment: BoardAssignmentValue; label: string }>;
    /** Required headcount, when a requirement covers this cell. */
    required: number | undefined;
    /** Per-cell chip cap before the `+N` overflow. */
    maxVisible: number | undefined;
    edit: boolean;
    /** Per-payload drop veto (duplicate person AND the host's IR `canDrop`). */
    canDrop: (payload: DragPayload) => boolean;
    styles: SlotStyles;
    onSelect?: ((ref: CellRefValue) => void) | undefined;
    onAccept?: ((ref: CellRefValue) => void) | undefined;
    onRemove?: ((ref: CellRefValue) => void) | undefined;
    onAddAt?: ((ref: CellRefValue) => void) | undefined;
}

function BoardCell({ surface, area, shift, chips, required, maxVisible, edit, canDrop, styles, onSelect, onAccept, onRemove, onAddAt }: BoardCellProps) {
    const coord = useMemo(() => ({ surface, row: area, slot: shift }), [surface, area, shift]);
    const dropRef = useDropCell(edit ? coord : null, false, canDrop);
    const [overflowOpen, setOverflowOpen] = useState(false);

    const filled = chips.filter(c => fills(c.assignment)).length;
    const ghosts = chips.filter(c => stateAttr(c.assignment) === "model").length;
    const openSlots = required !== undefined && edit ? Math.max(0, required - filled - ghosts) : 0;
    const tone = required === undefined ? undefined
        : filled > required ? "over" : filled === required ? "ok" : "under";

    const overflowing = maxVisible !== undefined && chips.length > maxVisible;
    const visible = overflowing ? chips.slice(0, maxVisible) : chips;
    const hidden = overflowing ? chips.slice(maxVisible) : [];

    const handleAdd = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (onAddAt) onAddAt(cellRef(surface, area, shift));
    }, [onAddAt, surface, area, shift]);
    const handleClick = useCallback(() => {
        if (edit && chips.length === 0 && openSlots === 0 && onAddAt) onAddAt(cellRef(surface, area, shift));
    }, [edit, chips.length, openSlots, onAddAt, surface, area, shift]);

    const chipEl = (chip: { assignment: BoardAssignmentValue; label: string }, dragDisabled?: boolean) => (
        <BoardChip
            key={chip.assignment.key}
            surface={surface}
            area={area}
            shift={shift}
            assignment={chip.assignment}
            label={chip.label}
            edit={edit}
            {...(dragDisabled !== undefined ? { dragDisabled } : {})}
            styles={styles}
            onSelect={onSelect}
            onAccept={onAccept}
            onRemove={onRemove}
        />
    );

    return (
        <Box
            ref={dropRef}
            css={styles.cell}
            onClick={handleClick}
            {...(edit && chips.length === 0 && openSlots === 0 && onAddAt ? { "data-addable": "" } : {})}
        >
            {required !== undefined && (
                <Box css={styles.coverage}>
                    <Box as="span" css={styles.coverageCount} data-tone={tone}>{filled}/{required}</Box>
                </Box>
            )}
            {visible.map(chip => chipEl(chip))}
            {overflowing && (
                <Popover.Root
                    open={overflowOpen}
                    onOpenChange={(e) => setOverflowOpen(e.open)}
                    positioning={{ placement: "bottom-start" }}
                    lazyMount
                    unmountOnExit
                >
                    <Popover.Trigger asChild>
                        <Box
                            as="button"
                            css={styles.overflowChip}
                            aria-label={`${hidden.length} more assignments`}
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                            +{hidden.length}
                        </Box>
                    </Popover.Trigger>
                    <Portal>
                        <Popover.Positioner>
                            <Popover.Content css={styles.overflowContent}>
                                {hidden.map(chip => chipEl(chip, true))}
                            </Popover.Content>
                        </Popover.Positioner>
                    </Portal>
                </Popover.Root>
            )}
            {Array.from({ length: openSlots }, (_, i) => (
                <Box
                    key={`open-${i}`}
                    as="button"
                    css={styles.openSlot}
                    aria-label="Open slot"
                    onClick={handleAdd}
                >
                    ⊕
                </Box>
            ))}
        </Box>
    );
}

// ============================================================================
// Board
// ============================================================================

/**
 * Renders an East UI Board value — the single-day areas × shifts assignment
 * grid. Registers as the DnD **target** under `value.id` in edit mode: cells
 * accept `add` drops from the declared Libraries, proposed chips drag
 * (`move` / `remove`), and every completed drag funnels through `onDrag`.
 * Dropping a person onto a cell that already holds them is a no-op (the
 * duplicate-person guard). Renders no built-in user-facing copy — numerals,
 * glyphs and tones only.
 */
export const EastChakraBoard = memo(function EastChakraBoard({ value, storageKey }: EastChakraBoardProps) {
    const styles = useSlotRecipe({ key: "board" })() as SlotStyles;
    const edit = value.mode.type === "edit";

    // Interactive-state pattern: drops and acceptances apply to local
    // assignment state immediately (the widget works without callbacks); the
    // callbacks persist the change, and the prop sync reconciles
    // authoritative data.
    const [assignments, setAssignments] = useState<BoardAssignmentValue[]>(() => [...value.assignments]);
    useEffect(() => { setAssignments([...value.assignments]); }, [value.assignments]);
    // Faces for optimistic adds whose person key is not in `people` yet.
    const [localFaces, setLocalFaces] = useState<Map<string, string>>(() => new Map());

    const onDragFn = useMemo(() => getSomeorUndefined(value.onDrag), [value.onDrag]);
    // IR-level drop veto (#261) — the shared `canDrop` contract (the factory
    // compiles the deprecated `canAssign` sugar into it). Verdict-cached per
    // (payload, cell); a THROWING predicate logs and ALLOWS (fail-open) so a
    // broken validator cannot brick the board.
    const canDropFn = useMemo(() => getSomeorUndefined(value.canDrop) as CanDropFn | undefined, [value.canDrop]);
    const vetoFor = useIRCanDrop(canDropFn);

    // ── Review foot (optional, #265) ──────────────────────────────────────
    // Board v1 renders the shared commitBar BATCH foot only (Approve all /
    // Reject all / Rerun + summary) — per-area decisions are an epic
    // candidate. Ghost onAccept stays the per-tile path. No per-row
    // decisions ⇒ no approvals to seed the controller with.
    const review = useMemo(() => getSomeorUndefined(value.review), [value.review]);
    const reviewApprovals = useMemo(() => [] as never[], []);
    const reviewController = useReviewController(review, reviewApprovals);
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const onAcceptFn = useMemo(() => getSomeorUndefined(value.onAccept), [value.onAccept]);
    const onAddAtFn = useMemo(() => getSomeorUndefined(value.onAddAt), [value.onAddAt]);

    const faces = useMemo(() => {
        const out = new Map<string, string>();
        for (const person of value.people) out.set(person.key, person.label);
        return out;
    }, [value.people]);
    const faceFor = useCallback((person: string): string =>
        faces.get(person) ?? localFaces.get(person) ?? person, [faces, localFaces]);

    const occupied = useCallback((area: string, shift: string, person: string, excludeKey?: string): boolean =>
        assignments.some(a => a.area === area && a.shift === shift && a.person === person && a.key !== excludeKey),
    [assignments]);

    /** The person a drag payload carries — a Library card's key IS the person
     * key; a moving chip resolves through its assignment. */
    const payloadPerson = useCallback((payload: DragPayload): { person: string; excludeKey?: string } | undefined => {
        if (payload.kind === "item") return { person: payload.from.key };
        const moving = assignments.find(a => a.key === payload.from.event);
        return moving !== undefined ? { person: moving.person, excludeKey: moving.key } : undefined;
    }, [assignments]);
    /** Per-cell drop veto: the built-in duplicate-person guard AND the host's
     * IR `canDrop` verdict. Unresolvable payloads allow (fail-open). */
    const cellCanDrop = useCallback((area: string, shift: string) => {
        const veto = vetoFor?.({ surface: value.id, row: area, slot: shift });
        return (payload: DragPayload): boolean => {
            const who = payloadPerson(payload);
            if (who !== undefined && occupied(area, shift, who.person, who.excludeKey)) return false;
            return veto?.(payload) ?? true;
        };
    }, [payloadPerson, occupied, vetoFor, value.id]);

    const handleDrag = useCallback((event: DragEventValue, meta?: DragMeta) => {
        // Re-check the IR veto with the real event before mutating (the hover
        // veto already gated the ⊘ stage; sink removes are always valid).
        if ((event.type === "add" || event.type === "move") && !canDropAllows(canDropFn, event)) return;
        if (event.type === "add") {
            const { from, into } = event.value;
            // Duplicate-person guard: the dragged card's key IS the person key.
            if (occupied(into.row, into.slot, from.key)) return;
            setAssignments([...assignments, {
                key: `local:${from.library}:${from.key}:${into.row}:${into.slot}:${assignments.length}`,
                person: from.key,
                area: into.row,
                shift: into.slot,
                state: variant("proposed", variant("added", null)),
            }]);
            if (meta?.label !== undefined && !faces.has(from.key)) {
                setLocalFaces(prev => new Map(prev).set(from.key, meta.label!));
            }
        } else if (event.type === "move") {
            const { from, to } = event.value;
            const key = from.event.type === "some" ? from.event.value : undefined;
            const moving = assignments.find(a => a.key === key);
            if (moving === undefined || occupied(to.row, to.slot, moving.person, moving.key)) return;
            setAssignments(assignments.map(a => a.key === key
                ? { ...a, area: to.row, shift: to.slot }
                : a));
        } else if (event.type === "remove") {
            const key = event.value.from.event.type === "some" ? event.value.from.event.value : undefined;
            setAssignments(assignments.filter(a => a.key !== key));
        }
        if (onDragFn) queueMicrotask(() => onDragFn(event));
    }, [assignments, faces, occupied, canDropFn, onDragFn]);
    const handleSelect = useMemo(() => onSelectFn
        ? (ref: CellRefValue) => queueMicrotask(() => onSelectFn(ref))
        : undefined, [onSelectFn]);
    const handleAccept = useCallback((ref: CellRefValue) => {
        const key = ref.event.type === "some" ? ref.event.value : undefined;
        const next = assignments.map(a =>
            a.key === key && a.state.type === "proposed" && a.state.value.type === "model"
                ? { ...a, state: variant("proposed", variant("added", null)) as BoardAssignmentValue["state"] }
                : a);
        setAssignments(next);
        if (onAcceptFn) queueMicrotask(() => onAcceptFn(ref));
    }, [assignments, onAcceptFn]);
    const handleRemove = useCallback((ref: CellRefValue) => {
        const key = ref.event.type === "some" ? ref.event.value : undefined;
        setAssignments(assignments.filter(a => a.key !== key));
        if (onDragFn) {
            const event: DragEventValue = variant("remove", { from: ref, to: variant("trash", null) });
            queueMicrotask(() => onDragFn(event));
        }
    }, [assignments, onDragFn]);
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

    // Group assignments into cells by area × shift, faces resolved.
    const cells = useMemo(() => {
        const out = new Map<string, Array<{ assignment: BoardAssignmentValue; label: string }>>();
        for (const assignment of assignments) {
            // Published boards render committed assignments only.
            if (!edit && assignment.state.type !== "committed") continue;
            const key = `${assignment.area} ${assignment.shift}`;
            if (!out.has(key)) out.set(key, []);
            out.get(key)!.push({ assignment, label: faceFor(assignment.person) });
        }
        return out;
    }, [assignments, edit, faceFor]);

    const requirements = useMemo(() => {
        const out = new Map<string, number>();
        const rows = getSomeorUndefined(value.requirements);
        if (rows !== undefined) {
            for (const row of rows) out.set(`${row.area} ${row.shift}`, Number(row.required));
        }
        return out;
    }, [value.requirements]);

    const maxVisibleValue = getSomeorUndefined(value.maxVisible);
    const maxVisible = maxVisibleValue !== undefined ? Number(maxVisibleValue) : undefined;
    const areaHeader = getSomeorUndefined(value.areaHeader);
    const areaWidth = getSomeorUndefined(value.areaWidth) ?? "150px";
    const summary = getSomeorUndefined(value.summary);

    // Uniform sizing contract (#320) — bound the board; it scrolls within,
    // mounting only the visible area rows via the shared VirtualRows frame.
    const gridCols = `${areaWidth} repeat(${value.shifts.length}, 1fr)`;

    // The header row and each area row are independent grids sharing one column
    // template (border-per-cell, no grid gap), so they align while each row
    // becomes a self-contained virtual item.
    const headerNode = (
        <Box css={styles.grid} style={{ gridTemplateColumns: gridCols }}>
            <Box css={styles.headerCell}>{areaHeader}</Box>
            {value.shifts.map(shift => {
                const sublabel = getSomeorUndefined(shift.sublabel);
                return (
                    <Box key={shift.key} css={styles.headerCell}>
                        {shift.label}
                        {sublabel !== undefined && <Box as="span" css={styles.headerSublabel}>{sublabel}</Box>}
                    </Box>
                );
            })}
        </Box>
    );

    const renderRow = (i: number): ReactNode => {
        const area = value.areas[i];
        if (area === undefined) return null;
        const sublabel = getSomeorUndefined(area.sublabel);
        return (
            <Box css={styles.grid} style={{ gridTemplateColumns: gridCols }}>
                <Box css={styles.areaCell}>
                    <Box as="span" css={styles.areaLabel}>{area.label}</Box>
                    {sublabel !== undefined && <Box as="span" css={styles.areaSublabel}>{sublabel}</Box>}
                </Box>
                {value.shifts.map(shift => (
                    <BoardCell
                        key={`${area.key}-${shift.key}`}
                        surface={value.id}
                        area={area.key}
                        shift={shift.key}
                        chips={cells.get(`${area.key} ${shift.key}`) ?? []}
                        required={requirements.get(`${area.key} ${shift.key}`)}
                        maxVisible={maxVisible}
                        edit={edit}
                        canDrop={cellCanDrop(area.key, shift.key)}
                        styles={styles}
                        onSelect={handleSelect}
                        onAccept={edit ? handleAccept : undefined}
                        onRemove={edit ? handleRemove : undefined}
                        onAddAt={handleAddAt}
                    />
                ))}
            </Box>
        );
    };

    const footerNode = summary !== undefined ? (
        <Box css={styles.strip}>
            <Box as="span" css={styles.stripSummary}>{summary}</Box>
        </Box>
    ) : undefined;

    // With the review commit bar pinned OUTSIDE the scroll frame, the sized
    // flex-column WRAPPER takes the component's bound and the frame fills the
    // remainder (`fillParent`) — otherwise a percentage / `fill` height would
    // resolve against the auto-height wrapper and silently unbind.
    const heightCss = parseCssSize(getSomeorUndefined(value.height));
    const maxHeightCss = parseCssSize(getSomeorUndefined(value.maxHeight));
    const footShown = reviewController !== undefined && reviewController.showFoot;
    const frameFills = footShown && (heightCss !== undefined || maxHeightCss !== undefined);
    const frame = (
        <VirtualRows
            height={frameFills ? undefined : heightCss}
            maxHeight={frameFills ? undefined : maxHeightCss}
            fillParent={frameFills}
            header={headerNode}
            footer={footerNode}
            count={value.areas.length}
            estimateSize={() => 80}
            renderRow={renderRow}
            rootCss={{ ...styles.root }}
        />
    );

    // The review commit bar pins outside the scroll frame (like Planner).
    return reviewController !== undefined && footShown
        ? (
            <Box display="flex" flexDirection="column" width="100%" height={heightCss} maxHeight={maxHeightCss} minHeight="0">
                {frame}
                <ReviewFoot controller={reviewController} storageKey={storageKey} />
            </Box>
        )
        : frame;
}, (prev, next) => boardEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
