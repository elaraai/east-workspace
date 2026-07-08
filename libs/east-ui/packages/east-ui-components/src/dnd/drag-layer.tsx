/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Drag layer — the renderer half of the east-ui drag & drop grammar.
 *
 * One provider per page hosts the drag state machine. Sources (Library
 * cards), draggable events (Roster chips, Blend allocations), droppable
 * cells, and sinks all register here; the provider wires the flow by
 * matching the surfaces' declared ids, so DnD-aware components never wire
 * handlers at each other. Every completed drag reduces to one
 * `DragEventType` value delivered to the owning target's `onDrag`.
 *
 * Visual stages (grip, ghost, indicators, cancel) follow the
 * `drag-drop-visuals` spec via data attributes that the theme styles:
 * `data-dragging` on the origin, `data-drop-valid` / `data-drop-active` on
 * cells and sinks, and the portal ghost.
 *
 * @packageDocumentation
 */

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { variant, some, none, type ValueTypeOf } from "@elaraai/east";
import { type DragEventType, type CellRefType, type LibraryRefType } from "@elaraai/east-ui/internal";

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
    /** Span-edge resize (#268) — Gantt bars, `Planner.Span` events. */
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

interface CellRegistration {
    coord: CellCoord;
    disabled: boolean;
    /** Optional per-payload veto (e.g. a host `canAssign` predicate). A cell
     * whose surface connects but whose veto returns `false` renders the
     * invalid treatment (`data-drop-invalid`) while hovered, and the drop is
     * a no-op. */
    canDrop?: ((payload: DragPayload, clientX?: number, clientY?: number) => boolean) | undefined;
    /** Continuous surfaces (#268): resolve the drop coordinate from the
     * pointer position at drop time — the component maps pointer x → its
     * snapped slot key (e.g. a Gantt row strip mapping x → a snapped ISO
     * instant), as the grammar intends. Absent ⇒ the registered `coord`. */
    resolveCoord?: ((clientX: number, clientY: number) => CellCoord) | undefined;
}

interface SinkRegistration {
    kind: "trash" | "library";
    /** For `library` sinks: the library id (return-to-palette). */
    library?: string;
}

/** What is being dragged. */
export type DragPayload =
    | { kind: "item"; from: { library: string; key: string }; label?: string; ghost: ReactNode }
    | { kind: "event"; from: Required<CellCoord>; ghost: ReactNode }
    /** A span event's edge (#268) — reduces to the grammar `resize`. */
    | { kind: "edge"; from: Required<CellCoord>; edge: "start" | "end"; ghost: ReactNode };

interface ActiveDrag {
    payload: DragPayload;
    x: number;
    y: number;
    altKey: boolean;
}

interface DragLayerContextValue {
    registerTarget(config: DragTargetConfig): () => void;
    registerCell(el: HTMLElement, reg: CellRegistration): () => void;
    registerSink(el: HTMLElement, reg: SinkRegistration): () => void;
    beginDrag(e: ReactPointerEvent, payload: DragPayload): void;
    /** Whether a drag is in flight (sources use it to suppress hover affordances). */
    active: boolean;
}

const DragLayerContext = createContext<DragLayerContextValue | null>(null);

/**
 * Access the drag layer. Throws outside a {@link DragLayerProvider}.
 */
export function useDragLayer(): DragLayerContextValue {
    const context = useContext(DragLayerContext);
    if (!context) {
        throw new Error("useDragLayer must be used within a DragLayerProvider");
    }
    return context;
}

/**
 * Optional access — `null` when no provider is mounted, letting DnD-aware
 * components degrade to static rendering instead of throwing.
 */
export function useDragLayerOptional(): DragLayerContextValue | null {
    return useContext(DragLayerContext);
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

export interface DragLayerProviderProps {
    children: ReactNode;
}

/**
 * Provider hosting the page's drag & drop state machine.
 *
 * @remarks
 * Mount once around any page that composes DnD-aware surfaces (Library,
 * Roster, Blend). Components register themselves; a Library connects to
 * every target that lists its id in `sources` automatically.
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
export function DragLayerProvider({ children }: DragLayerProviderProps) {
    const targets = useRef(new Map<string, DragTargetConfig>());
    const cells = useRef(new Map<HTMLElement, CellRegistration>());
    const sinks = useRef(new Map<HTMLElement, SinkRegistration>());
    const [drag, setDrag] = useState<ActiveDrag | null>(null);
    const dragRef = useRef<ActiveDrag | null>(null);
    const originEl = useRef<HTMLElement | null>(null);
    const hovered = useRef<HTMLElement | null>(null);

    const registerTarget = useCallback((config: DragTargetConfig) => {
        targets.current.set(config.id, config);
        return () => { targets.current.delete(config.id); };
    }, []);

    const registerCell = useCallback((el: HTMLElement, reg: CellRegistration) => {
        cells.current.set(el, reg);
        el.setAttribute("data-drag-cell", "");
        return () => { cells.current.delete(el); };
    }, []);

    const registerSink = useCallback((el: HTMLElement, reg: SinkRegistration) => {
        sinks.current.set(el, reg);
        el.setAttribute("data-drag-sink", "");
        return () => { sinks.current.delete(el); };
    }, []);

    /** Whether `reg`'s surface structurally connects to the payload (declared
     * source / intra-surface move), before per-cell vetoes. */
    const cellConnected = useCallback((reg: CellRegistration, payload: DragPayload): boolean => {
        if (reg.disabled) return false;
        const target = targets.current.get(reg.coord.surface);
        if (!target) return false;
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
    /** Whether `reg` is a valid destination for the in-flight payload. The
     * pointer position is forwarded when known (hover / drop) so continuous
     * surfaces can resolve their candidate; the drag-start sweep omits it
     * (such cells answer structurally and veto on hover instead). */
    const cellValid = useCallback((reg: CellRegistration, payload: DragPayload, x?: number, y?: number): boolean =>
        cellConnected(reg, payload) && (reg.canDrop?.(payload, x, y) ?? true), [cellConnected]);
    /** Whether `reg` connects but its per-cell veto forbids this payload —
     * the hovered-invalid (⃠) treatment. */
    const cellVetoed = useCallback((reg: CellRegistration, payload: DragPayload, x?: number, y?: number): boolean =>
        cellConnected(reg, payload) && reg.canDrop?.(payload, x, y) === false, [cellConnected]);

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

    const clearIndicators = useCallback(() => {
        for (const el of cells.current.keys()) {
            el.removeAttribute("data-drop-valid");
            el.removeAttribute("data-drop-active");
            el.removeAttribute("data-drop-invalid");
        }
        for (const el of sinks.current.keys()) {
            el.removeAttribute("data-drop-valid");
            el.removeAttribute("data-drop-active");
        }
        hovered.current = null;
    }, []);

    const endDrag = useCallback((commit: boolean) => {
        const active = dragRef.current;
        const over = hovered.current;
        clearIndicators();
        originEl.current?.removeAttribute("data-dragging");
        originEl.current = null;
        dragRef.current = null;
        setDrag(null);
        if (!commit || !active || !over) return;

        const { payload, altKey, x, y } = active;
        const cell = cells.current.get(over);
        const sink = sinks.current.get(over);
        if (cell && cellValid(cell, payload, x, y)) {
            const target = targets.current.get(cell.coord.surface);
            if (!target?.onDrag) return;
            // Continuous surfaces resolve the drop coordinate from the pointer
            // (component-owned snapping, #268); discrete cells use their coord.
            const dropCoord = cell.resolveCoord?.(x, y) ?? cell.coord;
            if (payload.kind === "item") {
                target.onDrag(variant("add", {
                    from: libraryRefValue(payload.from),
                    into: cellRefValue(dropCoord),
                    duplicate: altKey,
                }), payload.label !== undefined ? { label: payload.label } : undefined);
            } else if (payload.kind === "edge") {
                // The grammar `resize`: the event ref's `slot` is the moved
                // edge's NEW slot (the destination), `event` the span's key.
                target.onDrag(variant("resize", {
                    event: cellRefValue({ ...payload.from, slot: dropCoord.slot }),
                    edge: variant(payload.edge, null),
                }));
            } else {
                target.onDrag(variant("move", {
                    from: cellRefValue(payload.from),
                    to: cellRefValue(dropCoord),
                }));
            }
        } else if (sink && sinkValid(sink, payload) && payload.kind === "event") {
            const target = targets.current.get(payload.from.surface);
            target?.onDrag?.(variant("remove", {
                from: cellRefValue(payload.from),
                to: variant(sink.kind === "trash" ? "trash" : "source", null),
            }));
        }
    }, [cellValid, sinkValid, clearIndicators]);

    const beginDrag = useCallback((e: ReactPointerEvent, payload: DragPayload) => {
        if (dragRef.current) return;
        e.preventDefault();
        const origin = e.currentTarget as HTMLElement;
        origin.setAttribute("data-dragging", "");
        originEl.current = origin;

        // Drop indicators precede the drop — mark every valid destination now.
        for (const [el, reg] of cells.current) {
            if (cellValid(reg, payload)) el.setAttribute("data-drop-valid", "");
        }
        for (const [el, reg] of sinks.current) {
            if (sinkValid(reg, payload)) el.setAttribute("data-drop-valid", "");
        }

        const start: ActiveDrag = { payload, x: e.clientX, y: e.clientY, altKey: e.altKey };
        dragRef.current = start;
        setDrag(start);

        const onMove = (ev: globalThis.PointerEvent) => {
            const current = dragRef.current;
            if (!current) return;
            const next = { ...current, x: ev.clientX, y: ev.clientY, altKey: ev.altKey };
            dragRef.current = next;
            setDrag(next);
            // The ghost is pointer-events: none, so elementFromPoint sees through it.
            const under = document.elementFromPoint(ev.clientX, ev.clientY);
            const dest = under?.closest<HTMLElement>("[data-drag-cell], [data-drag-sink]") ?? null;
            const valid = dest !== null && dest.hasAttribute("data-drop-valid");
            if (hovered.current && hovered.current !== dest) {
                hovered.current.removeAttribute("data-drop-active");
                hovered.current.removeAttribute("data-drop-invalid");
                hovered.current = null;
            }
            if (dest && valid) {
                // A structurally-valid CONTINUOUS cell may still veto at this
                // exact pointer position (its candidate resolves per-pointer).
                const reg = cells.current.get(dest);
                if (reg && cellVetoed(reg, current.payload, ev.clientX, ev.clientY)) {
                    dest.removeAttribute("data-drop-active");
                    dest.setAttribute("data-drop-invalid", "");
                    hovered.current = dest;
                } else {
                    dest.removeAttribute("data-drop-invalid");
                    dest.setAttribute("data-drop-active", "");
                    hovered.current = dest;
                }
            } else if (dest) {
                // A connected-but-vetoed cell shows the invalid treatment.
                const reg = cells.current.get(dest);
                if (reg && cellVetoed(reg, current.payload, ev.clientX, ev.clientY)) {
                    dest.setAttribute("data-drop-invalid", "");
                    hovered.current = dest;
                }
            }
        };
        const cleanup = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            document.removeEventListener("keydown", onKey, true);
        };
        const onUp = () => { cleanup(); endDrag(true); };
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") { cleanup(); endDrag(false); }
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("keydown", onKey, true);
    }, [cellValid, cellVetoed, sinkValid, endDrag]);

    const context = useMemo<DragLayerContextValue>(() => ({
        registerTarget,
        registerCell,
        registerSink,
        beginDrag,
        active: drag !== null,
    }), [registerTarget, registerCell, registerSink, beginDrag, drag]);

    // ── Shared trash sink (#267) ──────────────────────────────────────────
    // While a drag whose owning target declares `kinds.remove` is in flight,
    // the provider renders a fixed trash zone (bottom-centre portal) wired
    // through the ordinary `trash` sink path — dropping delivers
    // `remove: { from, to: trash }` with zero per-component work. Structural
    // validity only: a trash drop is never `data-drop-invalid` (the `canDrop`
    // veto is a cell concern). Per-chip trash buttons remain the click path.
    const trashEligible = drag !== null
        && drag.payload.kind === "event"
        && (targets.current.get(drag.payload.from.surface)?.kinds.remove ?? false);
    const trashCleanup = useRef<(() => void) | null>(null);
    const trashRef = useCallback((el: HTMLElement | null) => {
        trashCleanup.current?.();
        trashCleanup.current = null;
        if (el) {
            trashCleanup.current = registerSink(el, { kind: "trash" });
            // The zone mounts AFTER beginDrag's valid-destination sweep, so
            // mark it valid for the in-flight payload here.
            const active = dragRef.current;
            if (active && sinkValid({ kind: "trash" }, active.payload)) {
                el.setAttribute("data-drop-valid", "");
            }
        }
    }, [registerSink, sinkValid]);

    return (
        <DragLayerContext.Provider value={context}>
            {children}
            {trashEligible && createPortal(
                <div ref={trashRef as (el: HTMLDivElement | null) => void} data-drag-trash="" aria-label="Remove (drop to trash)">
                    ⌫
                </div>,
                document.body,
            )}
            {drag !== null && createPortal(
                <div
                    data-drag-ghost=""
                    style={{
                        position: "fixed",
                        left: 0,
                        top: 0,
                        transform: `translate(${drag.x + 12}px, ${drag.y + 8}px)`,
                        pointerEvents: "none",
                        zIndex: 1700,
                    }}
                >
                    {drag.payload.ghost}
                </div>,
                document.body,
            )}
        </DragLayerContext.Provider>
    );
}

// ============================================================================
// Registration hooks — what DnD-aware components consume
// ============================================================================

/**
 * Register a target surface (Roster, Blend) for the lifetime of the
 * component. Returns nothing — cells reference the surface by id.
 */
export function useDragTarget(config: DragTargetConfig | null): void {
    const layer = useDragLayerOptional();
    useEffect(() => {
        if (!layer || !config) return undefined;
        return layer.registerTarget(config);
    }, [layer, config]);
}

/**
 * Ref callback registering a droppable cell. Pass `null` coord to skip
 * registration (e.g. published mode).
 */
export function useDropCell(
    coord: CellCoord | null,
    disabled = false,
    canDrop?: (payload: DragPayload) => boolean,
    resolveCoord?: (clientX: number, clientY: number) => CellCoord,
): (el: HTMLElement | null) => void {
    const layer = useDragLayerOptional();
    const cleanup = useRef<(() => void) | null>(null);
    return useCallback((el: HTMLElement | null) => {
        cleanup.current?.();
        cleanup.current = null;
        if (layer && el && coord) {
            cleanup.current = layer.registerCell(el, { coord, disabled, canDrop, resolveCoord });
        }
    }, [layer, coord, disabled, canDrop, resolveCoord]);
}

/**
 * Ref callback registering a sink: the trash affordance, or a Library frame
 * (return-to-palette) when `library` is given.
 */
export function useDropSink(kind: "trash" | "library", library?: string): (el: HTMLElement | null) => void {
    const layer = useDragLayerOptional();
    const cleanup = useRef<(() => void) | null>(null);
    return useCallback((el: HTMLElement | null) => {
        cleanup.current?.();
        cleanup.current = null;
        if (layer && el) {
            cleanup.current = layer.registerSink(
                el,
                kind === "library" && library !== undefined ? { kind, library } : { kind },
            );
        }
    }, [layer, kind, library]);
}

/**
 * Pointer-down handler starting an `add` drag from a Library card. Returns
 * `undefined` when not draggable (no provider, or `disabled`).
 */
export function useDragSourceItem(
    from: { library: string; key: string; label?: string } | null,
    ghost: ReactNode,
    disabled = false,
): ((e: ReactPointerEvent) => void) | undefined {
    const layer = useDragLayerOptional();
    return useMemo(() => {
        if (!layer || !from || disabled) return undefined;
        return (e: ReactPointerEvent) => layer.beginDrag(e, {
            kind: "item",
            from: { library: from.library, key: from.key },
            ...(from.label !== undefined ? { label: from.label } : {}),
            ghost,
        });
    }, [layer, from, ghost, disabled]);
}

/**
 * Pointer-down handler starting a `move` / `remove` drag from an existing
 * event chip. Only proposed events are draggable — pass `disabled` for
 * committed ones.
 */
export function useDragEventChip(
    from: Required<CellCoord> | null,
    ghost: ReactNode,
    disabled = false,
): ((e: ReactPointerEvent) => void) | undefined {
    const layer = useDragLayerOptional();
    return useMemo(() => {
        if (!layer || !from || disabled) return undefined;
        return (e: ReactPointerEvent) => layer.beginDrag(e, { kind: "event", from, ghost });
    }, [layer, from, ghost, disabled]);
}

/**
 * Pointer-down handler starting a `resize` drag from a span event's edge
 * (#268). The destination is intra-row: valid cells are the same row's slots
 * (continuous surfaces resolve the snapped slot at drop time), and the drop
 * reduces to `resize: { event, edge }` where the event ref's `slot` is the
 * moved edge's new slot. Returns `undefined` when not draggable.
 */
export function useDragEventEdge(
    from: Required<CellCoord> | null,
    edge: "start" | "end",
    ghost: ReactNode,
    disabled = false,
): ((e: ReactPointerEvent) => void) | undefined {
    const layer = useDragLayerOptional();
    return useMemo(() => {
        if (!layer || !from || disabled) return undefined;
        return (e: ReactPointerEvent) => layer.beginDrag(e, { kind: "edge", from, edge, ghost });
    }, [layer, from, edge, ghost, disabled]);
}
