/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Drag layer — the renderer half of the east-ui drag & drop grammar, on
 * dnd-kit (#608).
 *
 * One provider per page hosts the drags. Sources (Library cards), draggable
 * events (Roster chips, Blend allocations, Board cards), droppable cells and
 * sinks all register here; the provider wires the flow by matching the
 * surfaces' declared ids, so DnD-aware components never wire handlers at each
 * other. Every completed drag reduces to one `DragEventType` value delivered to
 * the owning target's `onDrag`.
 *
 * A drag is picked up by the pointer — a mouse or pen after 4px of travel, a
 * touch after a 300ms hold, a touch on a grip at once ({@link DragPointerSensor})
 * — or by the keyboard ({@link DragKeyboardSensor}): Space or Enter on a
 * focused draggable, the arrow keys to move between the cells that take it
 * (and along a continuous cell's stops), Space or Enter to drop, and Escape or
 * Tab to cancel. Where the drag rests is announced to a screen reader each
 * time it changes, in the layer's words ({@link DragMessages}). A pointer
 * resting near the edge of a scroll container scrolls it, so a drop can reach
 * a row that is off screen, and whatever scrolls under a drag that is still —
 * by that edge, a wheel or a touchpad — is read again where the drag rests.
 *
 * A destination's verdict is always asked of the event the drop would deliver
 * — its duplicate flag included — at the point the drag rests, and asked again
 * of the event actually delivered. A drop resolves where it happened: if the
 * cell the drag rested over left the screen (a virtualized row scrolled
 * away), the drop point is read again, and a drop with nothing under it says
 * so rather than vanishing.
 *
 * Visual stages (grip, ghost, indicators, cancel) follow the
 * `drag-drop-visuals` spec via data attributes that the theme styles:
 * `data-dragging` on the origin, `data-drop-valid` / `data-drop-active` /
 * `data-drop-invalid` on cells and sinks, and the portal ghost.
 *
 * @packageDocumentation
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
    DndContext,
    DragOverlay,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type Announcements,
    type CollisionDetection,
    type DragEndEvent,
    type DragMoveEvent,
    type DragStartEvent,
    type KeyboardCodes,
    type KeyboardCoordinateGetter,
    type Modifier,
    type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import { variant, some, none, type ValueTypeOf } from "@elaraai/east";
import { type DragEventType, type CellRefType, type LibraryRefType } from "@elaraai/east-ui/internal";
import {
    DragKeyboardSensor, DragPointerSensor, type DragKeyboardOptions, type DragPointerOptions, type DragTrack,
} from "./sensor.js";
import { dragMessages, type DragMessages } from "./messages.js";
import { EdgeScroller, scrollStep } from "./auto-scroll.js";

/** A completed drag, as delivered to a target's `onDrag`. */
export type DragEventValue = ValueTypeOf<DragEventType>;

/** JS-side cell coordinate (the `event` field optional rather than an option value). */
export interface CellCoord {
    surface: string;
    row: string;
    slot: string;
    /** Set when the coordinate names an existing event. */
    event?: string;
}

/** Which grammar kinds a target supports (the per-surface matrix row). */
export interface DragKinds {
    add?: boolean;
    move?: boolean;
    remove?: boolean;
    /** Span-edge resize (#268) — temporal span surfaces. */
    resize?: boolean;
}

/** Display-only metadata accompanying a completed drag (not part of the
 * East grammar) — lets targets render an optimistic chip immediately. */
export interface DragMeta {
    /** The dragged card's display label. */
    label?: string;
}

/** A target surface registration. */
export interface DragTargetConfig {
    /** The surface's declared id. */
    id: string;
    /** Library ids accepted for `add`. */
    sources: readonly string[];
    /** Supported event kinds. */
    kinds: DragKinds;
    /** Receives every completed drag on this surface. */
    onDrag?: (event: DragEventValue, meta?: DragMeta) => void;
}

/**
 * A cell's verdict over the event a drop onto it would deliver — `false`
 * refuses it (the ⊘ stage while hovered; the drop is a no-op).
 *
 * @remarks
 * The candidate is the REAL event: an `add`'s `duplicate` is whether Alt is
 * held now, and a continuous cell's coordinate is the one its `resolveCoord`
 * names at the point the drag rests. The layer asks again, of the event it is
 * about to deliver, before it delivers it.
 */
export type DropVeto = (candidate: DragEventValue) => boolean;

/** A droppable cell's optional behaviour. */
export interface DropCellOptions {
    /**
     * Where a keyboard drag may rest inside the cell, in client-x px — a
     * continuous cell's stops (a Plan row's bucket centres). Left / Right step
     * between them; without stops they move to the neighbouring cell.
     */
    stops?: () => readonly number[];
    /** The cell's name, for the announcements — at the coordinate the drag rests on, for what is dragged. */
    name?: (coord: CellCoord, payload: DragPayload) => string;
    /** Told each time a drag rests over the cell and it takes it, with the client point and what is dragged. */
    onHover?: (clientX: number, clientY: number, payload: DragPayload) => void;
    /**
     * Whether the cell takes this payload at all — a structural answer, asked
     * before its veto (#825: a Plan row takes a moved run only when its items
     * are the run's item type). A cell that does not is no destination: it
     * never lights up, and a drag over it rests over nothing, as over a row
     * with no cell. Absent ⇒ every payload its surface connects to.
     */
    accepts?: (payload: DragPayload) => boolean;
}

interface CellRegistration extends DropCellOptions {
    coord: CellCoord;
    disabled: boolean;
    /** The cell's veto over the candidate event. */
    canDrop?: DropVeto | undefined;
    /** Continuous surfaces (#268): resolve the drop coordinate from the point
     * the drag rests at, for what is dragged — the component maps x → its
     * snapped slot key (a Plan row maps x → its bucket's instant, or a moved
     * run's new start, #825). Absent ⇒ the registered `coord`. */
    resolveCoord?: ((clientX: number, clientY: number, payload: DragPayload) => CellCoord) | undefined;
}

/**
 * A cell's registration, live: the cell registers ONCE per element, and the
 * layer reads its latest settings through this ref. Re-registering whenever a
 * setting changed identity would detach and re-attach the cell on every
 * render — a drag starting re-renders every droppable — dropping its stage
 * and the hover a drag rests on.
 */
type LiveCell = { readonly current: CellRegistration };

interface SinkRegistration {
    kind: "trash" | "library";
    /** For `library` sinks: the library id (return-to-palette). */
    library?: string;
}

/** What is being dragged. */
export type DragPayload =
    | { kind: "item"; from: { library: string; key: string }; label?: string; ghost: ReactNode }
    | { kind: "event"; from: Required<CellCoord>; label?: string; ghost: ReactNode }
    /** A span event's edge (#268) — reduces to the grammar `resize`. */
    | { kind: "edge"; from: Required<CellCoord>; edge: "start" | "end"; label?: string; ghost: ReactNode };

/**
 * What a draggable spreads onto its element: its ref, the pointer and
 * keyboard handlers that pick it up, and its accessible role and description.
 */
export interface DragHandle {
    ref: (el: HTMLElement | null) => void;
    onPointerDown?: (event: ReactPointerEvent) => void;
    onKeyDown?: (event: ReactKeyboardEvent) => void;
    role: string;
    tabIndex: number;
    "aria-disabled": boolean;
    "aria-pressed": boolean | undefined;
    "aria-roledescription": string;
    "aria-describedby": string;
}

interface DragLayerContextValue {
    registerTarget(config: DragTargetConfig): () => void;
    registerCell(el: HTMLElement, cell: LiveCell, id: UniqueIdentifier): () => void;
    registerSink(el: HTMLElement, reg: SinkRegistration, id: UniqueIdentifier): () => void;
}

/** The layer's registries — stable for the provider's lifetime, so neither a
 *  drag starting or ending nor a new message table re-registers a cell. */
const DragLayerContext = createContext<DragLayerContextValue | null>(null);
/** Whether a drag is in flight — its own context, read by the few that care. */
const DragActiveContext = createContext(false);
/** The layer's words — its own context, so a host's inline table re-renders only what speaks. */
const DragMessagesContext = createContext<DragMessages>(dragMessages);

/** The registries, whether a drag is in flight, and the layer's words — what {@link useDragLayer} returns. */
export interface DragLayerState extends DragLayerContextValue {
    /** Whether a drag is in flight (sources use it to suppress hover affordances). */
    active: boolean;
    /** The layer's words. */
    messages: DragMessages;
}

/**
 * Access the drag layer. Throws outside a {@link DragLayerProvider}.
 */
export function useDragLayer(): DragLayerState {
    const state = useDragLayerOptional();
    if (!state) {
        throw new Error("useDragLayer must be used within a DragLayerProvider");
    }
    return state;
}

/**
 * Optional access — `null` when no provider is mounted, letting DnD-aware
 * components degrade to static rendering instead of throwing.
 */
export function useDragLayerOptional(): DragLayerState | null {
    const layer = useContext(DragLayerContext);
    const active = useContext(DragActiveContext);
    const messages = useContext(DragMessagesContext);
    return useMemo(() => (layer === null ? null : { ...layer, active, messages }), [layer, active, messages]);
}

/**
 * The drag layer's words — the provider's table, or the English one outside
 * a provider. Reads only the words, so a drag starting or ending never
 * re-renders the caller.
 *
 * @returns The message table in effect
 */
export function useDragMessages(): DragMessages {
    return useContext(DragMessagesContext);
}

function cellRefValue(coord: CellCoord): ValueTypeOf<CellRefType> {
    return {
        surface: coord.surface,
        row: coord.row,
        slot: coord.slot,
        event: coord.event !== undefined ? some(coord.event) : none,
    };
}

function libraryRefValue(from: { library: string; key: string }): ValueTypeOf<LibraryRefType> {
    return { library: from.library, key: from.key };
}

/**
 * The event a payload would deliver onto `coord` — an `add` for a Library
 * card (its `duplicate` the Alt state), a `move` for an event chip, a `resize`
 * for a span edge (the event ref's `slot` is the edge's new slot).
 *
 * @param payload - What is dragged
 * @param coord - Where it would land
 * @param duplicate - Whether Alt is held (an `add` copies)
 * @returns The event
 */
export function dropEvent(payload: DragPayload, coord: CellCoord, duplicate: boolean): DragEventValue {
    if (payload.kind === "item") {
        return variant("add", {
            from: libraryRefValue(payload.from),
            into: cellRefValue(coord),
            duplicate,
        });
    }
    if (payload.kind === "edge") {
        return variant("resize", {
            event: cellRefValue({ ...payload.from, slot: coord.slot }),
            edge: variant(payload.edge, null),
        });
    }
    return variant("move", {
        from: cellRefValue(payload.from),
        to: cellRefValue(coord),
    });
}

/** The dragged thing's name, for the announcements. */
function itemName(payload: DragPayload): string {
    if (payload.label !== undefined) return payload.label;
    return payload.kind === "item" ? payload.from.key : payload.from.event;
}

/** A point, in client px. */
type Point = { x: number; y: number };

/** A drag in flight. */
interface InFlight {
    payload: DragPayload;
    /** The element it began on (`data-dragging`). */
    origin: HTMLElement | null;
    /** The destination it rests over — a connected cell or a valid sink. */
    hovered: HTMLElement | null;
    /** A hovered cell left the screen during the drag. */
    lostTarget: boolean;
    /** Whether the keyboard carries it. */
    keyboard: boolean;
    /** Undo the drag's own listeners. */
    release: () => void;
}

/** How a drag ended — what the end announcement says. */
type Outcome =
    | { kind: "dropped"; item: string; target: string }
    | { kind: "notDropped"; item: string }
    | { kind: "targetGone"; item: string };

/** The keys a keyboard drag answers to — Tab cancels, rather than dropping where the drag rests. */
const KEYBOARD_CODES: KeyboardCodes = {
    start: ["Space", "Enter"],
    cancel: ["Escape", "Tab"],
    end: ["Space", "Enter"],
};

/** The ghost sits 12px right of and 8px below the pointer — never under it. */
const GHOST_OFFSET: Point = { x: 12, y: 8 };

/**
 * Put the ghost beside the pointer: dnd-kit places the overlay over the
 * dragged element, and this moves it so its corner follows the pointer
 * instead. A keyboard drag keeps dnd-kit's placement — over the target.
 */
const beside: Modifier = ({ activatorEvent, activeNodeRect, transform }) => {
    if (activatorEvent === null || activeNodeRect === null || !("clientX" in activatorEvent)) return transform;
    const at = activatorEvent as PointerEvent;
    return {
        ...transform,
        x: transform.x + (at.clientX - activeNodeRect.left) + GHOST_OFFSET.x,
        y: transform.y + (at.clientY - activeNodeRect.top) + GHOST_OFFSET.y,
    };
};
const GHOST_MODIFIERS = [beside, restrictToWindowEdges];

/** The coordinate a cell names at a point, for a payload — its own, when it has no resolver or there is no point. */
function coordAt(reg: CellRegistration, point: Point | undefined, payload: DragPayload): CellCoord {
    return point !== undefined && reg.resolveCoord !== undefined ? reg.resolveCoord(point.x, point.y, payload) : reg.coord;
}

/** Drop every stage attribute a registration may have left on an element. */
function clearStages(el: HTMLElement): void {
    el.removeAttribute("data-drop-valid");
    el.removeAttribute("data-drop-active");
    el.removeAttribute("data-drop-invalid");
}

export interface DragLayerProviderProps {
    children: ReactNode;
    /** The layer's words — any subset, over the English table ({@link dragMessages}). */
    messages?: Partial<DragMessages>;
}

/**
 * Provider hosting the page's drag & drop.
 *
 * @remarks
 * Mount once around any page that composes DnD-aware surfaces (Library,
 * Roster, Board, Blend, Plan). Components register themselves; a Library
 * connects to every target that lists its id in `sources` automatically.
 *
 * @example
 * ```tsx
 * import { DragLayerProvider } from "@elaraai/east-ui-components";
 *
 * function App() {
 *     return (
 *         <DragLayerProvider>
 *             <YourDecisionSurface />
 *         </DragLayerProvider>
 *     );
 * }
 * ```
 */
export function DragLayerProvider({ children, messages }: DragLayerProviderProps) {
    const words = useMemo<DragMessages>(() => ({ ...dragMessages, ...messages }), [messages]);

    const targets = useRef(new Map<string, DragTargetConfig>());
    const cells = useRef(new Map<HTMLElement, LiveCell>());
    const sinks = useRef(new Map<HTMLElement, SinkRegistration>());
    const ids = useRef(new Map<HTMLElement, UniqueIdentifier>());
    const drag = useRef<InFlight | null>(null);
    const [dragged, setDragged] = useState<DragPayload | null>(null);
    const track = useRef<DragTrack>({ altKey: false, point: undefined, abort: undefined }).current;
    /** The point the drag rests at — the pointer, or a keyboard drag's centre. */
    const restPoint = useRef<Point | undefined>(undefined);
    /** The last hit test — a point, and the destination element under it. */
    const lastHit = useRef<{ point: Point; el: HTMLElement | null } | undefined>(undefined);
    const outcome = useRef<Outcome | undefined>(undefined);
    /** What the live region last said the drag rests over — `null` when over nothing — so it speaks again only on a change. */
    const spoken = useRef<string | null>(null);
    const scroller = useRef<EdgeScroller | null>(null);

    // ── Validity ──────────────────────────────────────────────────────────

    /** Whether `reg`'s surface structurally connects to the payload (declared
     * source / intra-surface move), before its veto. */
    const connected = useCallback((reg: CellRegistration, payload: DragPayload): boolean => {
        if (reg.disabled) return false;
        const target = targets.current.get(reg.coord.surface);
        if (!target) return false;
        // The cell's own structural answer — no destination for this payload at all.
        if (reg.accepts !== undefined && !reg.accepts(payload)) return false;
        if (payload.kind === "item") {
            return (target.kinds.add ?? false) && target.sources.includes(payload.from.library);
        }
        if (payload.kind === "edge") {
            // Edge resize: intra-surface AND intra-row — an edge moves along
            // its own row's axis, never onto another row.
            return (target.kinds.resize ?? false)
                && payload.from.surface === reg.coord.surface
                && payload.from.row === reg.coord.row;
        }
        // Event move: intra-surface only.
        return (target.kinds.move ?? false) && payload.from.surface === reg.coord.surface;
    }, []);

    /** Whether a connected cell takes the payload at a point — its veto, asked of the real candidate. */
    const allows = useCallback((reg: CellRegistration, payload: DragPayload, point: Point | undefined): boolean => {
        if (reg.canDrop === undefined) return true;
        return reg.canDrop(dropEvent(payload, coordAt(reg, point, payload), track.altKey));
    }, [track]);

    const sinkValid = useCallback((reg: SinkRegistration, payload: DragPayload): boolean => {
        if (payload.kind !== "event") return false;
        const target = targets.current.get(payload.from.surface);
        if (!target || !(target.kinds.remove ?? false)) return false;
        // Return-to-palette only connects to a library the surface declared.
        if (reg.kind === "library") {
            return reg.library !== undefined && target.sources.includes(reg.library);
        }
        return true;
    }, []);

    /** A destination's name, for the announcements. */
    const targetName = useCallback((el: HTMLElement, point: Point | undefined, payload: DragPayload): string => {
        const cell = cells.current.get(el)?.current;
        if (cell !== undefined) {
            const coord = coordAt(cell, point, payload);
            return cell.name?.(coord, payload) ?? words.cell({ row: coord.row, slot: coord.slot });
        }
        const sink = sinks.current.get(el);
        if (sink?.kind === "library") return words.returnTo({ library: sink.library ?? "" });
        return words.trash();
    }, [words]);

    // ── Registration ──────────────────────────────────────────────────────

    const registerTarget = useCallback((config: DragTargetConfig) => {
        targets.current.set(config.id, config);
        return () => { targets.current.delete(config.id); };
    }, []);

    const forget = useCallback((el: HTMLElement): void => {
        ids.current.delete(el);
        clearStages(el);
        const d = drag.current;
        if (d !== null && d.hovered === el) {
            // The destination left the screen mid-drag (a virtualized row
            // scrolled away): the drop re-reads its point, and says so if
            // nothing is there.
            d.hovered = null;
            d.lostTarget = true;
        }
        if (lastHit.current?.el === el) lastHit.current = undefined;
    }, []);

    const registerCell = useCallback((el: HTMLElement, cell: LiveCell, id: UniqueIdentifier) => {
        cells.current.set(el, cell);
        ids.current.set(el, id);
        el.setAttribute("data-drag-cell", "");
        // A cell can register DURING a drag — a virtualizer scrolls its row
        // into view. The drag-start sweep has already run, so mark it here.
        const d = drag.current;
        if (d !== null && connected(cell.current, d.payload) && allows(cell.current, d.payload, undefined)) {
            el.setAttribute("data-drop-valid", "");
        }
        return () => {
            cells.current.delete(el);
            // Leave the attribute and a de-registered element keeps
            // hit-testing as a destination the layer no longer knows.
            el.removeAttribute("data-drag-cell");
            forget(el);
        };
    }, [connected, allows, forget]);

    const registerSink = useCallback((el: HTMLElement, reg: SinkRegistration, id: UniqueIdentifier) => {
        sinks.current.set(el, reg);
        ids.current.set(el, id);
        el.setAttribute("data-drag-sink", "");
        const d = drag.current;
        if (d !== null && sinkValid(reg, d.payload)) el.setAttribute("data-drop-valid", "");
        return () => {
            sinks.current.delete(el);
            el.removeAttribute("data-drag-sink");
            forget(el);
        };
    }, [sinkValid, forget]);

    // ── Hit testing ───────────────────────────────────────────────────────

    /** The registered destination under a point — the ghost is `pointer-events: none`, so it is never hit. */
    const hit = useCallback((point: Point): HTMLElement | null => {
        const under = document.elementFromPoint(point.x, point.y);
        const dest = under?.closest<HTMLElement>("[data-drag-cell], [data-drag-sink]") ?? null;
        return dest !== null && (cells.current.has(dest) || sinks.current.has(dest)) ? dest : null;
    }, []);

    /** Mark the destination a drag rests over, at a point: active if it takes the drag, ⊘ if it refuses it. */
    const rest = useCallback((el: HTMLElement | null, point: Point) => {
        const d = drag.current;
        if (d === null) return;
        const prev = d.hovered;
        if (prev !== null && prev !== el) {
            prev.removeAttribute("data-drop-active");
            prev.removeAttribute("data-drop-invalid");
        }
        d.hovered = null;
        if (el === null) return;
        const cell = cells.current.get(el)?.current;
        if (cell !== undefined) {
            // An unconnected element is not a destination, and a drop must not consider it one.
            if (!connected(cell, d.payload)) return;
            d.hovered = el;
            // The verdict is asked HERE, at this point — never read back from
            // `data-drop-valid`, the drag-start sweep's snapshot: a veto that
            // discriminates on the slot answers per bucket.
            if (allows(cell, d.payload, point)) {
                el.removeAttribute("data-drop-invalid");
                el.setAttribute("data-drop-valid", "");
                el.setAttribute("data-drop-active", "");
                cell.onHover?.(point.x, point.y, d.payload);
            } else {
                el.removeAttribute("data-drop-active");
                el.setAttribute("data-drop-invalid", "");
            }
            return;
        }
        const sink = sinks.current.get(el);
        if (sink !== undefined && sinkValid(sink, d.payload)) {
            el.setAttribute("data-drop-active", "");
            d.hovered = el;
        }
    }, [connected, allows, sinkValid]);

    /**
     * dnd-kit's collision step: the destination under the pointer, or under a
     * keyboard drag's centre — hit afresh each time, since the content under a
     * still point moves when something scrolls. The move handler reuses it.
     */
    const collide = useCallback<CollisionDetection>(({ collisionRect, pointerCoordinates }) => {
        const point = pointerCoordinates ?? {
            x: collisionRect.left + collisionRect.width / 2,
            y: collisionRect.top + collisionRect.height / 2,
        };
        restPoint.current = point;
        const el = hit(point);
        lastHit.current = { point, el };
        const id = el !== null ? ids.current.get(el) : undefined;
        return id !== undefined ? [{ id }] : [];
    }, [hit]);

    // ── Keyboard ──────────────────────────────────────────────────────────

    /** Where the arrow key takes a keyboard drag — the next destination in its direction, or a stop within the cell. */
    const nextPoint = useCallback((code: string, from: Point): Point | undefined => {
        const d = drag.current;
        if (d === null) return undefined;
        const horizontal = code === "ArrowLeft" || code === "ArrowRight";
        const forward = code === "ArrowRight" || code === "ArrowDown";
        const current = d.hovered;
        const here = current !== null ? cells.current.get(current)?.current : undefined;
        // Within a continuous cell, Left / Right step between its stops.
        if (horizontal && current !== null && here?.stops !== undefined) {
            const stops = here.stops();
            const stop = forward
                ? stops.find((x) => x > from.x + 0.5)
                : [...stops].reverse().find((x) => x < from.x - 0.5);
            if (stop !== undefined) return { x: stop, y: from.y };
        }
        // Otherwise the nearest destination in that direction: along the key's
        // axis first, then as close across it as possible.
        const base = current?.getBoundingClientRect();
        let best: { el: HTMLElement; score: number } | undefined;
        const consider = (el: HTMLElement) => {
            if (el === current) return;
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const along = horizontal ? (forward ? cx - from.x : from.x - cx) : (forward ? cy - from.y : from.y - cy);
            // Strictly beyond the cell the drag rests in, in the key's direction.
            const beyond = base === undefined ? along > 1
                : horizontal ? (forward ? r.left >= base.right - 1 : r.right <= base.left + 1)
                    : (forward ? r.top >= base.bottom - 1 : r.bottom <= base.top + 1);
            if (!beyond) return;
            const across = horizontal
                ? Math.max(0, r.top - from.y, from.y - r.bottom)
                : Math.max(0, r.left - from.x, from.x - r.right);
            const score = along + 4 * across;
            if (best === undefined || score < best.score) best = { el, score };
        };
        for (const [el, cell] of cells.current) if (connected(cell.current, d.payload)) consider(el);
        for (const [el, reg] of sinks.current) if (sinkValid(reg, d.payload)) consider(el);
        if (best === undefined) {
            // Nothing that way on screen: scroll the container the drag rests
            // in a step, so a virtualizer mounts what lies beyond; the next
            // press finds it.
            if (current !== null) scrollStep(current, code);
            return undefined;
        }
        const target: HTMLElement = best.el;
        target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        const r = target.getBoundingClientRect();
        const stops = cells.current.get(target)?.current.stops?.();
        // Up / Down keep the column; Left / Right enter at the near stop.
        const x = !horizontal
            ? Math.min(Math.max(from.x, r.left + 1), r.right - 1)
            : stops !== undefined && stops.length > 0 ? (forward ? stops[0]! : stops[stops.length - 1]!)
                : r.left + r.width / 2;
        return { x, y: r.top + r.height / 2 };
    }, [connected, sinkValid]);

    /** Where an arrow key takes a keyboard drag's collision rect — the sensor asks for the arrows alone. */
    const coordinateGetter = useCallback<KeyboardCoordinateGetter>((event, { context }) => {
        const rect = context.collisionRect;
        if (rect === null) return undefined;
        const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const to = nextPoint(event.code, from);
        if (to === undefined) return undefined;
        return { x: to.x - rect.width / 2, y: to.y - rect.height / 2 };
    }, [nextPoint]);

    const pointerOptions = useMemo<DragPointerOptions>(() => ({ distance: 4, delay: 300, tolerance: 8, track }), [track]);
    const keyboardOptions = useMemo<DragKeyboardOptions>(
        () => ({ keyboardCodes: KEYBOARD_CODES, coordinateGetter, track }),
        [coordinateGetter, track],
    );
    const sensors = useSensors(
        useSensor(DragPointerSensor, pointerOptions),
        useSensor(DragKeyboardSensor, keyboardOptions),
    );

    // ── The drag's lifecycle ──────────────────────────────────────────────

    const onDragStart = useCallback(({ active, activatorEvent }: DragStartEvent) => {
        const data = active.data.current as { payload?: DragPayload; node?: { current: HTMLElement | null } } | undefined;
        const payload = data?.payload;
        if (payload === undefined) return;
        const origin = data?.node?.current ?? null;
        origin?.setAttribute("data-dragging", "");
        // A keyboard drag's modifiers are the keyboard's, and its sensor tracks them.
        const keyboard = activatorEvent instanceof KeyboardEvent;
        // Content scrolled under a drag that did not move — a wheel, a
        // touchpad, the edge scroller — brings another destination under it:
        // rest again where it now is. dnd-kit re-reads collisions only when
        // an ancestor of the node it last reported as over scrolls, and that
        // node lags a render behind, so the layer watches every scroll itself.
        const restAgain = () => {
            const point = restPoint.current;
            if (point === undefined) return;
            const el = hit(point);
            lastHit.current = { point, el };
            rest(el, point);
        };
        document.addEventListener("scroll", restAgain, { capture: true, passive: true });
        const releases: (() => void)[] = [() => document.removeEventListener("scroll", restAgain, { capture: true })];
        if (!keyboard) {
            scroller.current = new EdgeScroller(restAgain);
            releases.push(() => { scroller.current?.stop(); scroller.current = null; });
        }
        drag.current = {
            payload, origin, hovered: null, lostTarget: false, keyboard,
            release: () => { for (const r of releases) r(); },
        };
        outcome.current = undefined;
        spoken.current = null;
        lastHit.current = undefined;
        restPoint.current = undefined;
        // Candidates precede the drop — mark every valid destination now.
        for (const [el, cell] of cells.current) {
            if (connected(cell.current, payload) && allows(cell.current, payload, undefined)) el.setAttribute("data-drop-valid", "");
        }
        for (const [el, reg] of sinks.current) {
            if (sinkValid(reg, payload)) el.setAttribute("data-drop-valid", "");
        }
        setDragged(payload);
    }, [hit, rest, connected, allows, sinkValid]);

    /**
     * The drag moved, or what it rests over changed: mark where it rests now.
     * dnd-kit reports a move when the drag's translation changes, and an
     * over when the destination does — which can be a render later than the
     * move, since collisions wait for the ghost to be measured — so both land
     * here.
     */
    const onDragMove = useCallback((_event: DragMoveEvent) => {
        const d = drag.current;
        const point = restPoint.current;
        if (d === null || point === undefined) return;
        const el = lastHit.current !== undefined && lastHit.current.point === point ? lastHit.current.el : hit(point);
        rest(el, point);
        if (!d.keyboard) scroller.current?.update(point);
    }, [hit, rest]);

    /** End the drag: clear every stage, and deliver the drop when it commits. */
    const finish = useCallback((commit: boolean) => {
        const d = drag.current;
        drag.current = null;
        for (const el of cells.current.keys()) clearStages(el);
        for (const el of sinks.current.keys()) clearStages(el);
        setDragged(null);
        if (d === null) return;
        d.origin?.removeAttribute("data-dragging");
        d.release();
        const item = itemName(d.payload);
        if (!commit) return;
        // A drop resolves where it happened — the pointer's release point, or
        // where a keyboard drag rests — never the last hover read back: the
        // cell hovered last may have left the screen since.
        const point = d.keyboard ? restPoint.current : (track.point ?? restPoint.current);
        const el = point !== undefined ? hit(point) : null;
        if (el === null || point === undefined) {
            if (d.lostTarget) {
                console.warn("[DnD] the drop's target left the screen during the drag, and nothing lies under the drop point — nothing was dropped");
                outcome.current = { kind: "targetGone", item };
            } else {
                outcome.current = { kind: "notDropped", item };
            }
            return;
        }
        const { payload } = d;
        const cell = cells.current.get(el)?.current;
        const sink = sinks.current.get(el);
        if (cell !== undefined && connected(cell, payload)) {
            const target = targets.current.get(cell.coord.surface);
            // Continuous surfaces name the coordinate at the drop point
            // (component-owned snapping, #268); discrete cells use their own.
            // The name is read first: it describes where the drop lands, and
            // the delivery may change what the cell draws.
            const coord = coordAt(cell, point, payload);
            const event = dropEvent(payload, coord, track.altKey);
            const name = targetName(el, point, payload);
            // The veto is asked once more, of the event about to be
            // delivered — its duplicate flag the one the drop carries.
            if (target?.onDrag === undefined || !(cell.canDrop?.(event) ?? true)) {
                outcome.current = { kind: "notDropped", item };
                return;
            }
            target.onDrag(event, payload.kind === "item" && payload.label !== undefined ? { label: payload.label } : undefined);
            outcome.current = { kind: "dropped", item, target: name };
            return;
        }
        if (sink !== undefined && sinkValid(sink, payload) && payload.kind === "event") {
            const target = targets.current.get(payload.from.surface);
            target?.onDrag?.(variant("remove", {
                from: cellRefValue(payload.from),
                to: variant(sink.kind === "trash" ? "trash" : "source", null),
            }));
            outcome.current = { kind: "dropped", item, target: targetName(el, point, payload) };
            return;
        }
        outcome.current = { kind: "notDropped", item };
    }, [track, hit, connected, sinkValid, targetName]);

    const onDragEnd = useCallback((_event: DragEndEvent) => finish(true), [finish]);
    const onDragCancel = useCallback(() => finish(false), [finish]);

    // dnd-kit never tears down the sensor of a drag whose context unmounts, so
    // a layer leaving mid-drag ends the drag itself — no drop, and nothing left
    // listening to the page.
    useEffect(() => () => {
        track.abort?.();
        const d = drag.current;
        drag.current = null;
        d?.release();
    }, [track]);

    // ── Announcements ─────────────────────────────────────────────────────

    const announcements = useMemo<Announcements>(() => {
        const payloadOf = (active: { data: { current?: unknown } }): DragPayload | undefined =>
            (active.data.current as { payload?: DragPayload } | undefined)?.payload;
        /**
         * Where the drag rests, said when it changes — a new destination, or a
         * new slot of a continuous one (a Plan row's next bucket is the same
         * droppable, so dnd-kit's over alone would never say it). Read from
         * what the move handler just marked, which runs before this.
         */
        const sayWhere = ({ active }: { active: { data: { current?: unknown } } }): string | undefined => {
            const payload = payloadOf(active);
            const d = drag.current;
            if (payload === undefined || d === null) return undefined;
            const item = itemName(payload);
            const el = d.hovered;
            if (el === null) {
                // Leaving a destination is news; resting over nothing again is not.
                if (spoken.current === null) return undefined;
                spoken.current = null;
                return words.notOver({ item });
            }
            const point = restPoint.current;
            const target = targetName(el, point, payload);
            const cell = cells.current.get(el)?.current;
            const message = cell === undefined || allows(cell, payload, point)
                ? words.over({ item, target })
                : words.refused({ item, target });
            if (message === spoken.current) return undefined;
            spoken.current = message;
            return message;
        };
        return {
            onDragStart: ({ active }) => {
                const payload = payloadOf(active);
                return payload !== undefined ? words.pickedUp({ item: itemName(payload) }) : undefined;
            },
            onDragMove: sayWhere,
            onDragOver: sayWhere,
            onDragEnd: ({ active }) => {
                const payload = payloadOf(active);
                const done = outcome.current;
                if (payload === undefined || done === undefined) return undefined;
                if (done.kind === "dropped") return words.dropped({ item: done.item, target: done.target });
                if (done.kind === "targetGone") return words.targetGone({ item: done.item });
                return words.notDropped({ item: done.item });
            },
            onDragCancel: ({ active }) => {
                const payload = payloadOf(active);
                return payload !== undefined ? words.cancelled({ item: itemName(payload) }) : undefined;
            },
        };
    }, [words, targetName, allows]);
    const accessibility = useMemo(() => ({
        announcements,
        screenReaderInstructions: { draggable: words.instructions() },
    }), [announcements, words]);

    // The registries never change identity, so neither a drag starting or
    // ending nor a new message table re-registers a cell (every `useDropCell`
    // ref reads this value).
    const context = useMemo<DragLayerContextValue>(() => ({
        registerTarget,
        registerCell,
        registerSink,
    }), [registerTarget, registerCell, registerSink]);

    // ── Shared trash sink (#267) ──────────────────────────────────────────
    // While a drag whose owning target declares `kinds.remove` is in flight,
    // the provider renders a fixed trash zone (bottom-centre portal) wired
    // through the ordinary `trash` sink path — dropping delivers
    // `remove: { from, to: trash }` with zero per-component work. Structural
    // validity only: a trash drop is never `data-drop-invalid` (a veto is a
    // cell concern). Per-chip trash buttons remain the click path.
    const trashEligible = dragged !== null
        && dragged.kind === "event"
        && (targets.current.get(dragged.from.surface)?.kinds.remove ?? false);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={collide}
            autoScroll={false}
            accessibility={accessibility}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragOver={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
        >
            <DragLayerContext.Provider value={context}>
                <DragMessagesContext.Provider value={words}>
                    <DragActiveContext.Provider value={dragged !== null}>
                        {children}
                        {trashEligible && <TrashZone label={words.trash()} />}
                    </DragActiveContext.Provider>
                </DragMessagesContext.Provider>
            </DragLayerContext.Provider>
            <DragOverlay className="east-drag-ghost" zIndex={1700} modifiers={GHOST_MODIFIERS} dropAnimation={null}>
                {dragged !== null ? <div data-drag-ghost="">{dragged.ghost}</div> : null}
            </DragOverlay>
        </DndContext>
    );
}

/** The shared trash zone — an ordinary `trash` sink, portalled to the page's bottom centre. */
function TrashZone({ label }: { label: string }) {
    const sinkRef = useDropSink("trash");
    return createPortal(
        <div ref={sinkRef as (el: HTMLDivElement | null) => void} data-drag-trash="" aria-label={label}>
            ⌫
        </div>,
        document.body,
    );
}

// ============================================================================
// Registration hooks — what DnD-aware components consume
// ============================================================================

/**
 * Register a target surface (Roster, Board, Blend, Plan) for the lifetime of
 * the component. Returns nothing — cells reference the surface by id.
 */
export function useDragTarget(config: DragTargetConfig | null): void {
    const layer = useContext(DragLayerContext);
    useEffect(() => {
        if (!layer || !config) return undefined;
        return layer.registerTarget(config);
    }, [layer, config]);
}

/**
 * Ref callback registering a droppable cell. Pass `null` coord to skip
 * registration (e.g. published mode).
 *
 * @param coord - The cell's coordinate (a continuous cell's: where it answers the drag-start sweep)
 * @param disabled - Take no drop
 * @param canDrop - The cell's veto over the event a drop would deliver ({@link DropVeto})
 * @param resolveCoord - A continuous cell's coordinate at a point, for what is dragged
 * @param options - Keyboard stops, a name for the announcements, a hover callback, a structural `accepts`
 * @returns The ref to attach to the cell's element
 */
export function useDropCell(
    coord: CellCoord | null,
    disabled = false,
    canDrop?: DropVeto,
    resolveCoord?: (clientX: number, clientY: number, payload: DragPayload) => CellCoord,
    options?: DropCellOptions,
): (el: HTMLElement | null) => void {
    const layer = useContext(DragLayerContext);
    const id = useId();
    const { setNodeRef } = useDroppable({ id, disabled: layer === null || coord === null || disabled });
    // The cell registers once per element; the layer reads these settings
    // live (`LiveCell`), kept to the committed render's.
    const settings: CellRegistration | null = coord === null ? null : { ...options, coord, disabled, canDrop, resolveCoord };
    const live = useRef<CellRegistration | null>(settings);
    useLayoutEffect(() => { live.current = settings; });
    const present = settings !== null;
    const cleanup = useRef<(() => void) | null>(null);
    return useCallback((el: HTMLElement | null) => {
        setNodeRef(el);
        cleanup.current?.();
        cleanup.current = null;
        if (layer && el && present) {
            cleanup.current = layer.registerCell(el, live as LiveCell, id);
        }
    }, [layer, id, setNodeRef, present]);
}

/**
 * Ref callback registering a sink: the trash affordance, or a Library frame
 * (return-to-palette) when `library` is given.
 */
export function useDropSink(kind: "trash" | "library", library?: string): (el: HTMLElement | null) => void {
    const layer = useContext(DragLayerContext);
    const id = useId();
    const { setNodeRef } = useDroppable({ id, disabled: layer === null });
    const cleanup = useRef<(() => void) | null>(null);
    return useCallback((el: HTMLElement | null) => {
        setNodeRef(el);
        cleanup.current?.();
        cleanup.current = null;
        if (layer && el) {
            cleanup.current = layer.registerSink(
                el,
                kind === "library" && library !== undefined ? { kind, library } : { kind },
                id,
            );
        }
    }, [layer, id, setNodeRef, kind, library]);
}

/** A draggable, for any payload — what the three source hooks share. */
function useDragHandle(payload: DragPayload | null, disabled: boolean): DragHandle | undefined {
    const layer = useContext(DragLayerContext);
    const words = useContext(DragMessagesContext);
    const id = useId();
    const node = useRef<HTMLElement | null>(null);
    const enabled = layer !== null && payload !== null && !disabled;
    const { setNodeRef, setActivatorNodeRef, listeners, attributes } = useDraggable({
        id,
        data: { payload, node },
        disabled: !enabled,
        ...(layer !== null ? { attributes: { roleDescription: words.draggable() } } : {}),
    });
    const ref = useCallback((el: HTMLElement | null) => {
        node.current = el;
        setNodeRef(el);
        // The element itself activates — a key pressed in a control inside it
        // (an amount input, an action button) never picks the drag up.
        setActivatorNodeRef(el);
    }, [setNodeRef, setActivatorNodeRef]);
    return useMemo(() => (enabled
        ? { ref, ...(listeners as Pick<DragHandle, "onPointerDown" | "onKeyDown"> | undefined), ...attributes }
        : undefined), [enabled, ref, listeners, attributes]);
}

/**
 * A Library card's drag handle — spread it onto the card; it starts an `add`
 * drag. `undefined` when not draggable (no provider, or `disabled`).
 *
 * @param from - The card: its library, its key and its label
 * @param ghost - What follows the pointer
 * @param disabled - Not draggable
 * @returns The handle to spread onto the card, or `undefined`
 */
export function useDragSourceItem(
    from: { library: string; key: string; label?: string } | null,
    ghost: ReactNode,
    disabled = false,
): DragHandle | undefined {
    const payload = useMemo<DragPayload | null>(() => (from === null ? null : {
        kind: "item",
        from: { library: from.library, key: from.key },
        ...(from.label !== undefined ? { label: from.label } : {}),
        ghost,
    }), [from, ghost]);
    return useDragHandle(payload, disabled);
}

/**
 * An existing event chip's drag handle — it starts a `move` / `remove` drag.
 * Only proposed events are draggable — pass `disabled` for committed ones.
 *
 * @param from - The chip's coordinate, its event key included
 * @param ghost - What follows the pointer
 * @param disabled - Not draggable
 * @param label - The chip's name, for the announcements (default: the event key)
 * @returns The handle to spread onto the chip, or `undefined`
 */
export function useDragEventChip(
    from: Required<CellCoord> | null,
    ghost: ReactNode,
    disabled = false,
    label?: string,
): DragHandle | undefined {
    const payload = useMemo<DragPayload | null>(() => (from === null ? null : {
        kind: "event", from, ghost, ...(label !== undefined ? { label } : {}),
    }), [from, ghost, label]);
    return useDragHandle(payload, disabled);
}

/**
 * A span event's edge handle (#268) — it starts a `resize` drag. The
 * destination is intra-row: valid cells are the same row's slots (continuous
 * surfaces resolve the snapped slot at drop time), and the drop reduces to
 * `resize: { event, edge }` where the event ref's `slot` is the moved edge's
 * new slot.
 *
 * @param from - The span's coordinate, its event key included
 * @param edge - Which edge
 * @param ghost - What follows the pointer
 * @param disabled - Not draggable
 * @param label - The span's name, for the announcements (default: the event key)
 * @returns The handle to spread onto the edge, or `undefined`
 */
export function useDragEventEdge(
    from: Required<CellCoord> | null,
    edge: "start" | "end",
    ghost: ReactNode,
    disabled = false,
    label?: string,
): DragHandle | undefined {
    const payload = useMemo<DragPayload | null>(() => (from === null ? null : {
        kind: "edge", from, edge, ghost, ...(label !== undefined ? { label } : {}),
    }), [from, edge, ghost, label]);
    return useDragHandle(payload, disabled);
}
