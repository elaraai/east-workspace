/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `BuilderFrame` (#1125) — the one frame of a builder-style component: the
 * one toolbar across the top, banners under it, a pane before and a pane
 * after the main area, and a footer. Every region but main is optional, and
 * the frame holds no content of its own: a builder is laid out by naming its
 * regions. Studio's builder (through the snap grid's editing canvas) and the
 * query builder are laid out with it.
 *
 * It is built from what exists: its top row is the shared {@link Toolbar},
 * and each pane it draws is a {@link DockPane}, whose rail, tabs and collapse
 * are its own. What the frame adds is the layout around them, and where each
 * pane sits:
 *
 * - **pinned** — in the flow; opening it pushes main aside;
 * - **overlay** — its rail stays in the flow, so main never moves; opened,
 *   the pane floats over main from its edge, full height — never so wide
 *   that less than 48px of main shows beside it ({@link MIN_SCRIM},
 *   {@link paneWidths}). Esc closes it and returns the focus to its rail —
 *   but a layer open in it that takes Esc itself, marked `data-escape-layer`
 *   (a Chooser laid in a pane), closes first — and one overlay pane is open
 *   at a time;
 * - **auto** (the default) — pinned while main keeps `minMain` beside the
 *   pinned panes, the start pane placed first; overlaid otherwise, and at
 *   560px and narrower always ({@link placePanes}). The width is the frame's
 *   own, so a frame in a narrow host behaves as on a narrow screen. A pane
 *   that starts to overlay for lack of room closes, and opens again once it
 *   is pinned again, unless it was opened or closed in between.
 *
 * A pane that persists keeps only what the viewer chose: its own collapse or
 * opening. What the frame does — a pane closed for lack of room and opened
 * again, or closed so that one overlay pane is open at a time — is never
 * written, so a reload restores the viewer's choice whatever width the frame
 * had when it closed the pane.
 *
 * While an overlay pane is open for lack of room — an `auto` pane
 * overlaying, or any overlay pane at 560px and narrower — the scrim covers
 * main, and a tap on it, in the strip beside the pane, closes the pane; a
 * pane its host sets to `overlay` on a wider frame floats over a live main. While a drag is under way an open
 * overlay pane slides off main and its scrim lifts, so it never hides a drop
 * target; both come back when the drag ends.
 *
 * The `builderFrame` slot recipe owns every style; the frame sets its data
 * attributes (`data-builder-frame`, `data-frame-slot`, `data-pane-mode`,
 * `data-collapsed`, `data-scrim`) and geometry only.
 *
 * Cold load is `loading` (#1398, CL4, CL5): the skeleton covers the regions,
 * its body's rows at the component's own pitch (`loadingPitch`), and a
 * `liveFooter` stays out from under it, its loading line saying what is read.
 * After cold load a read in flight is `busy`: nothing is covered — the
 * toolbar, the panes, the selection and Save stay live — and main, the region
 * being read, is `aria-busy` (CL12).
 *
 * **A phone's frame** — 560px wide or narrower (`Mobile Builder Frame Spec.md`,
 * ruled 3 Nov 2026) — stacks its regions and gives main the frame's whole
 * width:
 *
 * - the toolbar's second row, 56px over its 44px buttons, for the items that
 *   draw one (`ToolbarItem.secondRow` — the history, and the Elara eye before
 *   it, from a frame of `secondRowFrom` up), which leave the first row for it
 *   (FR1, FR6); a builder with none draws no second row;
 * - the footer, laid over main's foot while its loading line or a live notice
 *   shows, and nothing else of its rail: in the flow under main with no height
 *   of its own, so main never resizes as a read or a notice comes and goes —
 *   a Schematic never refits its drawing for one (ruled 7 Nov 2026, revising
 *   R5, whose line in the second row drew a row a read-only builder had only
 *   while a read was out). How far up main it reaches is main's
 *   `--builder-foot-inset`, which what main draws at its foot — a Schematic's
 *   scale and minimap — stands clear of. A footer with no loading line, the
 *   query builder's status line, stays in the flow;
 * - no pane at either side: a described pane that collapses is a tab of the pane strip on the
 *   frame's bottom edge — its icon, its label, and its detail or its badge —
 *   and opens as a view over the whole builder, edge to edge, sliding in from
 *   the right as the Filters view does (ruled 3 Nov 2026, in place of FR5's
 *   drawer up from the strip), its tabs at its head and its collapse there
 *   (FR4), which closes it, as Esc does. One is open at a time, and the focus moves into it as it opens
 *   and back to its tab as it closes. Each keeps its open tab and its bodies
 *   mounted across the width, as the pane does; what it holds is told it is
 *   in a phone's drawer ({@link FrameDrawer}), for its phone form;
 * - in a frame given `phonePanel`, what main's popovers and an open pane's open
 *   draws in the bottom panel, in the flow above the strip, as the Sheet's
 *   action bar stands ({@link FrameBottomPanel}, FR9): main, or the pane, gives
 *   way to it. The toolbar's stay views. The second row's own conflicts open
 *   in main's panel whichever frame it is, and Discard asks in a band under the
 *   row ({@link FrameSessionBand}, FR8): a phone has no anchored popovers;
 * - a menu or a Select's list anywhere in it opens as a view over the builder
 *   ({@link FramePhoneLayer}), through the shared layers its hosts draw them with.
 *
 * @packageDocumentation
 */

import {
    Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState,
    type CSSProperties, type KeyboardEvent, type MutableRefObject, type ReactNode, type Ref,
} from "react";
import { flushSync } from "react-dom";
import { Box, chakra, Skeleton, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { useFormatters } from "../../format/index.js";
import { FrameSessionBand } from "./session-row.js";
import { useViewEscape } from "./view-escape.js";
import { FrameOverlaySlot } from "./overlay-slot.js";
import { FrameDrawer } from "./drawer-context.js";
import { FrameBottomPanel } from "./bottom-panel.js";
import { FramePhoneLayer } from "./frame-layer.js";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { kept, keptFlag } from "../../platform/kept.js";
import { DockPane, type DockRailMark } from "../dock/index.js";
import { Toolbar, type ToolbarItem } from "../../toolbar/index.js";
import { useDragLayerOptional } from "../../dnd/drag-layer";
import {
    MIN_MAIN, NARROW_FRAME, paneWidths, placePanes, type PaneMode, type PanePlacement, type PanePlacements, type PaneWeight, type PaneWidths,
} from "./place.js";

export { FrameSessionBand } from "./session-row.js";

/** A phone form's `version`: back on a wider row, what the toolbar measured of it says nothing of the item's own forms. */
const PHONE_FORM = "phone";
export { FrameOverlaySlot } from "./overlay-slot.js";
export { FrameDrawer } from "./drawer-context.js";
export { FrameBottomPanel } from "./bottom-panel.js";

export {
    MIN_MAIN, MIN_SCRIM, NARROW_FRAME, paneWidths, placePanes,
    type PaneMode, type PanePlacement, type PanePlacements, type PaneWeight, type PaneWidths,
} from "./place.js";

type Styles = Record<string, SystemStyleObject>;

/** A side of main a pane sits at. */
type Side = "start" | "end";

const SIDES: readonly Side[] = ["start", "end"];

/** A pane's rail: what it keeps in the flow while collapsed or overlaying — DockPane's, the design system's 44px. */
const RAIL = 44;

/** A pane's width open when its host names none: the design system's rail (app layout). */
const DEFAULT_SIZE = "320px";

/** A width is taken as moved past this many CSS px. */
const MOVED_PX = 0.5;

/** The cold-load skeleton's row pitch when its host names none, in px. */
const DEFAULT_LOADING_PITCH = 40;

/** How many rows the cold-load skeleton's body draws: enough for a tall host at the smallest pitch; the body clips the rest. */
const LOADING_ROWS = 40;

/** Props of {@link BuilderFrame}. */
export interface BuilderFrameProps {
    /** Main: the one region every frame has. It takes the room the panes leave and gives its content a bounded box, so the content scrolls itself. */
    children: ReactNode;
    /** The one toolbar across the top: the shared {@link Toolbar}'s items. */
    toolbar?: ReadonlyArray<ToolbarItem | false | null | undefined> | undefined;
    /** In-flow banners under the toolbar, the frame's full width. */
    banners?: ReactNode;
    /** The pane before main. */
    start?: BuilderFramePane | undefined;
    /** The pane after main. */
    end?: BuilderFramePane | undefined;
    /** One band under everything: a status line, say. */
    footer?: ReactNode;
    /**
     * Opt into the cold-load skeleton until the first layout/fonts and the
     * requested data are ready — cold load only (#1398, CL5): a period
     * change, a narrowing or a new revision is `busy`, never `loading`.
     * Regions remain mounted, hidden and inert, preserving their state and
     * measured size.
     */
    loading?: boolean | undefined;
    /**
     * A read the view needs is in flight after cold load (#1398, CL3, CL5): a
     * window, a period, a narrowing. Nothing is covered — the toolbar, the
     * panes, the selection and Save stay live — and main, the region being
     * read, is `aria-busy` (CL12). The footer's loading line says what is read.
     */
    busy?: boolean | undefined;
    /**
     * The row pitch the cold-load skeleton's body draws at, in px: the
     * component's own (#1398) — the Sheet's density's, the Plan's row
     * geometry — so the skeleton matches what it covers. 40 unless given.
     */
    loadingPitch?: number | undefined;
    /**
     * Whether the footer stays live under the cold-load skeleton (#1398): its
     * legend real and its loading line saying what is read, rather than
     * covered with the rest. `false` unless given.
     */
    liveFooter?: boolean | undefined;
    /**
     * Whether, in a phone's frame, what main and an open pane open draws in the
     * bottom panel over the pane strip, rather than in a popover (FR9): a builder
     * whose phone form is cards of actions. Wider frames are as they are.
     * `false` unless given.
     */
    phonePanel?: boolean | undefined;
    /**
     * Whether, in a phone's frame, what main and an open pane open draws as a view over the whole builder, as the
     * toolbar's does: a builder whose choices want the height (`Query Builder Phone Spec.md` QP33). `false` unless given.
     */
    phoneViews?: boolean | undefined;
    /** Where each pane keeps its open tab, and its collapsed state when it persists. */
    storageKey: string;
    /** The narrowest main may get beside pinned panes before an `auto` pane overlays it: 480 (px) by default. */
    minMain?: number | undefined;
    /** The frame's accessible name. */
    label?: string | undefined;
    /** The root element: the bounds of popovers inside the frame, say — or what a host's own slot is measured over, the optimiser's landing (#1409). */
    ref?: Ref<HTMLDivElement> | undefined;
    /**
     * A host's styles on the root, beside the recipe's own: a slot of the host's drawn from attributes the frame's
     * content carries — the optimiser's landing over the entries a run marked (#1409). The root is the frame's box,
     * so a host that has no root of its own around the frame still draws on nothing but the frame.
     */
    rootCss?: SystemStyleObject | undefined;
    /** A host's attributes on the root, read by its `rootCss`: the run's `data-optimise-landing` and `data-optimise-lit` (#1409). The frame's own come after them. */
    rootProps?: Readonly<Record<string, string | undefined>> | undefined;
    /** The toolbar's element: where a host finds its own items' controls — the search box a key puts the focus on, say. */
    toolbarRef?: Ref<HTMLDivElement> | undefined;
    /** Keys pressed anywhere in the frame, its panes included: the host's shortcuts. */
    onKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
}

/** A pane: one the frame draws, or one its content draws, placed as it is and pinned at its side. */
export type BuilderFramePane = BuilderFrameDock | { readonly element: ReactNode };

/** A pane the frame draws: a {@link DockPane}. */
export interface BuilderFrameDock {
    /** Its name: the toggle's words, the rail's label, the title when it has no tabs. */
    label: string;
    /** What it holds, when it has no tabs: one body. */
    body?: ReactNode;
    /** What it holds: tabs, each with its own body and, after its label, any count of what it holds — one that `flash`es as a run of the app's optimiser lands (#1409). */
    tabs?: ReadonlyArray<{ key: string; label: string; count?: string | number | undefined; flash?: boolean | undefined; body: ReactNode }> | undefined;
    /** The open tab: the host's; omitted, the pane's own, kept under the frame's storage key. */
    tab?: string | undefined;
    /** Told each time a tab is opened from the pane, with its key. */
    onTabChange?: ((key: string) => void) | undefined;
    /**
     * In a phone's frame, one tab of the strip for each of the pane's own tabs, in place of the one for the pane: a tap
     * opens the pane at that tab (`Query Builder Phone Spec.md` QP17, the builder with a single pane).
     */
    phoneTabs?: ReadonlyArray<{ key: string; label: string; icon?: string | undefined; detail?: string | undefined }> | undefined;
    /** The rail's icon: a Font Awesome solid name. */
    icon?: string | undefined;
    /** A badge on the rail. Numeric counts use the shared compact formatter; their exact value remains accessible. */
    badge?: string | number | undefined;
    /** A mark on the rail after its badge: what the collapsed pane holds that needs a look (`Overdue event`). */
    mark?: DockRailMark | undefined;
    /** A line on the rail under its label. */
    detail?: string | undefined;
    /** Whether the rail's tile and badge are the brand's: what the pane shows is live. */
    active?: boolean | undefined;
    /** Its width open, a CSS length: 320px, the design system's rail, by default. */
    size?: string | undefined;
    /** `auto` (the default), `pinned` or `overlay`. */
    mode?: PaneMode | undefined;
    /** Collapsed: the host's; omitted, the pane's own, seeded by `defaultCollapsed`. */
    collapsed?: boolean | undefined;
    /** Collapsed at first, when the pane keeps its own state. */
    defaultCollapsed?: boolean | undefined;
    /** Told each time the pane collapses or opens. */
    onCollapsedChange?: ((collapsed: boolean) => void) | undefined;
    /** Whether the viewer's own collapse or opening of it outlives a reload: `none` by default. What the frame does for lack of room is never kept. */
    persist?: "none" | "local" | "session" | undefined;
    /** `false`: it never collapses — no rail, no toggle — and so is always pinned. `true` by default. */
    collapsible?: boolean | undefined;
}

/** What the frame measured of itself: its width, and each pane's width open (an element pane's as drawn), in px. */
interface Measured {
    readonly width: number;
    readonly start: number;
    readonly end: number;
}

/**
 * Whether a pane is one its content draws.
 *
 * @param pane - The pane
 * @returns Whether it is an `{ element }` pane
 */
function isElementPane(pane: BuilderFramePane): pane is { readonly element: ReactNode } {
    return "element" in pane;
}

/**
 * Whether a band is given: anything React draws but nothing.
 *
 * @param node - The band
 * @returns Whether the frame draws its region
 */
function given(node: ReactNode): boolean {
    return node !== undefined && node !== null && node !== false;
}

/**
 * A plain px length's width — what a pane's width needs no measuring for.
 *
 * @param size - A CSS length
 * @returns Its px, or `undefined` for any other length
 */
function pxOf(size: string): number | undefined {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(size.trim());
    return px === null ? undefined : Number(px[1]);
}

/** A described pane's collapsed state, as the frame keeps it. */
interface PaneCollapse {
    /** Whether it is collapsed — never, for a pane that does not collapse. */
    readonly collapsed: boolean;
    /**
     * Collapses or opens it: its own state, and its host told. The viewer's
     * change persists, when the pane persists; the frame's own does not.
     */
    readonly set: (next: boolean, by: "viewer" | "frame") => void;
}

/**
 * A described pane's collapsed state, on the interactive-state pattern: local
 * state seeded from `collapsed` / `defaultCollapsed`; a host-driven
 * `collapsed` pushes into it; every change is the pane's own state, told to
 * the host through a microtask — and, when the pane persists and the viewer
 * made the change, persisted.
 *
 * @param key - The pane's storage key
 * @param dock - The pane, when the frame draws one
 * @param onHost - Told when the host drives a change the frame did not make
 * @returns The state, and its setter
 */
function usePaneCollapse(key: string, dock: BuilderFrameDock | undefined, onHost: (collapsed: boolean) => void): PaneCollapse {
    const prop = dock?.collapsed;
    const persist = dock?.persist ?? "none";
    const onChange = dock?.onCollapsedChange;
    // The viewer's last choice, kept for a persisted pane (platform/kept.ts) and read before the pane's first draw.
    const choice = useMemo(() => persist === "none" ? undefined
        : kept(`${key}.dock.collapsed`, keptFlag, { where: persist === "session" ? "tab" : "browser" }), [key, persist]);
    const [own, setOwn] = useState<boolean>(() => prop ?? choice?.read() ?? dock?.defaultCollapsed ?? false);
    const ownRef = useRef(own);
    ownRef.current = own;
    const onHostRef = useRef(onHost);
    onHostRef.current = onHost;
    // A host-driven `collapsed` pushes into the state — unless it echoes what the frame just set.
    useLayoutEffect(() => {
        if (prop === undefined || prop === ownRef.current) return;
        setOwn(prop);
        onHostRef.current(prop);
    }, [prop]);
    const set = useCallback((next: boolean, by: "viewer" | "frame") => {
        setOwn(next);
        if (by === "viewer" && prop === undefined) choice?.write(next);
        if (onChange) queueMicrotask(() => onChange(next));
    }, [prop, choice, onChange]);
    return { collapsed: dock !== undefined && dock.collapsible !== false && own, set };
}

/**
 * A pane as the placement rule weighs it.
 *
 * @param pane - The pane
 * @param open - Its width open (an element pane's as drawn), in px
 * @param collapsed - Whether it is collapsed
 * @returns Its weight
 */
function weightOf(pane: BuilderFramePane | undefined, open: number, collapsed: boolean): PaneWeight | undefined {
    if (pane === undefined) return undefined;
    if (isElementPane(pane)) return { mode: "pinned", open, rail: open, collapsed: false };
    return { mode: modeOf(pane), open, rail: RAIL, collapsed };
}

/**
 * How a described pane is set: one that never collapses is always pinned.
 *
 * @param dock - The pane
 * @returns Its mode
 */
function modeOf(dock: BuilderFrameDock): PaneMode {
    return dock.collapsible === false ? "pinned" : dock.mode ?? "auto";
}

/**
 * Where the panes sit before the frame has measured itself: as on a wide
 * frame — `auto` pinned, the rest as their hosts set them.
 *
 * @param start - The start pane
 * @param end - The end pane
 * @returns Each pane's place
 */
function unmeasured(start: BuilderFramePane | undefined, end: BuilderFramePane | undefined): PanePlacements {
    const at = (pane: BuilderFramePane | undefined): PanePlacement | undefined =>
        pane === undefined ? undefined : isElementPane(pane) || modeOf(pane) !== "overlay" ? "pinned" : "overlay";
    return { start: at(start), end: at(end) };
}

/**
 * Lays a builder-style component out — see the module docs.
 *
 * @param props - The regions, the panes and the frame's options ({@link BuilderFrameProps})
 * @returns The frame
 */
export function BuilderFrame(props: BuilderFrameProps) {
    const { children, toolbar, banners, start, end, footer, storageKey, label, ref, rootCss, rootProps, toolbarRef, onKeyDown, loading, busy, liveFooter, phonePanel, phoneViews } = props;
    const formatters = useFormatters();
    const minMain = props.minMain ?? MIN_MAIN;
    const loadingPitch = props.loadingPitch ?? DEFAULT_LOADING_PITCH;
    const styles = useSlotStyles("builderFrame") as Styles;
    const dragging = useDragLayerOptional()?.active ?? false;

    const startDock = start !== undefined && !isElementPane(start) ? start : undefined;
    const endDock = end !== undefined && !isElementPane(end) ? end : undefined;
    const dockOf = (side: Side) => (side === "start" ? startDock : endDock);

    // Panes the frame closed as they started to overlay for lack of room —
    // opened again once they are pinned again, unless opened or closed meanwhile.
    const autoClosed = useRef(new Set<Side>());
    // The pane opened last: the one kept open when both would overlay open.
    const lastOpened = useRef<Side | undefined>(undefined);
    const onHost = (side: Side, collapsed: boolean) => {
        autoClosed.current.delete(side);
        if (!collapsed) lastOpened.current = side;
    };
    const startCollapse = usePaneCollapse(`${storageKey}.start`, startDock, (collapsed) => onHost("start", collapsed));
    const endCollapse = usePaneCollapse(`${storageKey}.end`, endDock, (collapsed) => onHost("end", collapsed));
    const collapseOf = (side: Side) => (side === "start" ? startCollapse : endCollapse);
    /** A pane collapsed or opened from the pane, by Esc, or by the scrim: the viewer's doing. */
    const toggled = (side: Side, collapsed: boolean) => {
        autoClosed.current.delete(side);
        if (!collapsed) lastOpened.current = side;
        collapseOf(side).set(collapsed, "viewer");
    };

    // ── What the frame measures of itself ───────────────────────────────
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [initialReady, setInitialReady] = useState(false);
    // Covered by the cold-load skeleton: until the first complete read has landed and its fonts with it.
    const covered = loading !== undefined && (loading || !initialReady);
    // A live footer stays out from under the skeleton, which ends at its top (geometry, measured before paint).
    const footerLive = covered && liveFooter === true && given(footer);
    const footerRef = useRef<HTMLDivElement | null>(null);
    const [footerHeight, setFooterHeight] = useState<number | undefined>(undefined);
    useLayoutEffect(() => {
        if (!footerLive) return undefined;
        const el = footerRef.current;
        if (el === null) return undefined;
        const read = () => setFooterHeight(el.getBoundingClientRect().height);
        read();
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, [footerLive]);
    const slotRefs: Record<Side, MutableRefObject<HTMLDivElement | null>> = { start: useRef(null), end: useRef(null) };
    const probeRefs: Record<Side, MutableRefObject<HTMLDivElement | null>> = { start: useRef(null), end: useRef(null) };
    const [measured, setMeasured] = useState<Measured | undefined>(undefined);
    const measuredRef = useRef(measured);
    measuredRef.current = measured;
    /** A pane's width open: its size, when that is a px length; else as its probe lays it out; an element pane's as drawn. */
    const openWidth = (side: Side, pane: BuilderFramePane | undefined): number => {
        if (pane === undefined) return 0;
        if (isElementPane(pane)) return slotRefs[side].current?.getBoundingClientRect().width ?? 0;
        return pxOf(pane.size ?? DEFAULT_SIZE) ?? probeRefs[side].current?.getBoundingClientRect().width ?? 0;
    };
    const measure = () => {
        const root = rootRef.current;
        if (root === null) return;
        const width = root.getBoundingClientRect().width;
        // A frame that is not laid out — hidden, or not in the page — keeps what it last measured.
        if (!(width > 0)) return;
        const next: Measured = { width, start: openWidth("start", start), end: openWidth("end", end) };
        const was = measuredRef.current;
        if (was !== undefined && Math.abs(was.width - next.width) <= MOVED_PX && Math.abs(was.start - next.start) <= MOVED_PX
            && Math.abs(was.end - next.end) <= MOVED_PX) return;
        measuredRef.current = next;
        setMeasured(next);
    };
    const measureRef = useRef(measure);
    measureRef.current = measure;
    // Measured after every render, before paint: a pane's size or its content may have
    // moved. It ends: a measure that has not moved sets nothing.
    useLayoutEffect(() => { measure(); });
    // Measure the real regions while covered. Wait for fonts only on the first
    // resolved window; later polling/edits never restart an initial-load delay.
    useLayoutEffect(() => {
        if (loading === undefined || loading || initialReady) return;
        let live = true;
        const finish = () => { if (live) setInitialReady(true); };
        const fonts = rootRef.current?.ownerDocument.fonts;
        if (fonts === undefined) finish();
        else void fonts.ready.then(finish, finish);
        return () => { live = false; };
    }, [loading, initialReady]);
    // A width change is taken before the frame paints at it, as the shared toolbar takes one.
    const observer = useRef<ResizeObserver | null>(null);
    const observed = useRef(new Set<Element>());
    useLayoutEffect(() => {
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(() => flushSync(() => measureRef.current()));
        observer.current = ro;
        if (rootRef.current !== null) ro.observe(rootRef.current);
        const seen = observed.current;
        return () => {
            ro.disconnect();
            observer.current = null;
            seen.clear();
        };
    }, []);
    // The probes and the element panes are watched as they come and go.
    useLayoutEffect(() => {
        const ro = observer.current;
        if (ro === null) return;
        const now = new Set<Element>();
        for (const side of SIDES) {
            const pane = side === "start" ? start : end;
            const watched = pane === undefined ? null : isElementPane(pane) ? slotRefs[side].current : probeRefs[side].current;
            if (watched !== null) now.add(watched);
        }
        for (const el of now) if (!observed.current.has(el)) ro.observe(el);
        for (const el of observed.current) if (!now.has(el)) ro.unobserve(el);
        observed.current = now;
    });

    // ── A phone's frame: the second row, the strip and the drawers ──────
    const phone = measured !== undefined && measured.width <= NARROW_FRAME;
    /** Whether an item is the second row's: on a phone, an item that draws one, from the narrowest frame it takes it at. */
    const inSecondRow = (it: ToolbarItem | false | null | undefined): it is ToolbarItem =>
        phone && !!it && it.secondRow !== undefined && (measured?.width ?? 0) >= (it.secondRowFrom ?? 0);
    // Which items the second row takes, by key: what the first row's items are made again by, never the width itself.
    const secondKeys = toolbar === undefined ? "" : toolbar.filter(inSecondRow).map((it) => it.key).join("\u0000");
    // The first row's items: on a phone, without those the second row draws, and each with a phone form drawing that
    // alone, in its order (FR2). The same array while neither moves, so the toolbar draws again only as its items do.
    const firstRow = useMemo(() => {
        if (toolbar === undefined || !phone) return toolbar;
        const moved = new Set(secondKeys === "" ? [] : secondKeys.split("\u0000"));
        const items = toolbar.filter((it): it is ToolbarItem => !!it && !moved.has(it.key));
        const phoned = items.map((it): ToolbarItem => it.phone === undefined ? it
            // In the phone forms' order: the views, the count, the rail's button, Search Records.
            : { key: it.key, forms: [it.phone.form], keep: it.keep, held: it.held, version: PHONE_FORM, grow: it.phone.grow, shrink: it.phone.shrink });
        const order = (it: ToolbarItem) => it.phone?.order ?? 0;
        const row = phoned.map((it, i) => ({ it, at: order(items[i]!), i })).sort((a, b) => a.at - b.at || a.i - b.i);
        // The controls placed by their order, the rail's button and Search Records, stand at the row's end with the
        // slack before them, as they do after the count line: where no view tabs take the slack and none of the
        // builder's own items ends the row, the first of them that does not give way leads the row's end cluster, and
        // those after it follow.
        const lead = row.some(({ it }) => it.grow === true || it.side === "end") ? -1 : row.findIndex(({ it, at }) => at > 0 && it.shrink !== true);
        return row.map(({ it }, k) => (lead >= 0 && k >= lead ? { ...it, side: "end" as const } : it));
    }, [toolbar, secondKeys, phone]);
    const secondRow = toolbar === undefined ? [] : toolbar.filter(inSecondRow).map((it) => ({ key: it.key, node: it.secondRow }));
    // The slot a toolbar item's full-height view draws itself in, over every region: the rail's Filters view (FR7).
    const [overlaySlot, setOverlaySlot] = useState<HTMLElement | null>(null);
    // The bottom panel's slots, where main's popovers and an open pane's draw (FR9): main's, and each pane's own.
    const [mainPanel, setMainPanel] = useState<HTMLElement | null>(null);
    const [startPanel, setStartPanel] = useState<HTMLElement | null>(null);
    const [endPanel, setEndPanel] = useState<HTMLElement | null>(null);
    // The band under the second row, where its items ask something (FR8).
    const [sessionBand, setSessionBand] = useState<HTMLElement | null>(null);
    const panelOf = (slot: HTMLElement | null) => (phone && phonePanel === true && !covered ? slot : null);
    const sessionRow = phone && secondRow.length > 0;
    // How far up main's foot a phone's footer laid over it reaches (`--builder-foot-inset`), for what main draws at its
    // foot — a Schematic's scale and minimap — to stand clear of it. Its band is measured whether it speaks or not, so
    // what stands clear of it stays put as a read or a notice comes and goes; a footer in the flow takes its own room. A
    // frame whose footer does not hang sets nothing: a wider frame's commits are its host's alone.
    const [footBand, setFootBand] = useState(0);
    const footHangs = phone && given(footer);
    const footInset = footHangs ? footBand : 0;
    useLayoutEffect(() => {
        const el = footerRef.current;
        if (!footHangs || el === null) return undefined;
        const read = () => {
            const band = el.getBoundingClientRect().height > MOVED_PX ? 0
                : [...el.children].reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0);
            setFootBand((was) => (Math.abs(was - band) > MOVED_PX ? band : was));
        };
        if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") { read(); return undefined; }
        const ro = new ResizeObserver(read);
        // What the footer holds comes and goes with its host's state: each part of it watched as it does.
        const watch = () => {
            ro.disconnect();
            ro.observe(el);
            for (const child of el.children) ro.observe(child);
            read();
        };
        watch();
        const mo = new MutationObserver(watch);
        mo.observe(el, { childList: true });
        return () => { ro.disconnect(); mo.disconnect(); };
    }, [footHangs]);
    /** Whether a side's pane is a drawer: a described pane that collapses, on a phone — one that never does stays pinned. */
    const drawn = (side: Side) => phone && dockOf(side) !== undefined && dockOf(side)?.collapsible !== false;

    // ── Where each pane sits, and how wide it is open ───────────────────
    const startWeight = measured === undefined ? undefined : weightOf(start, measured.start, startCollapse.collapsed);
    const endWeight = measured === undefined ? undefined : weightOf(end, measured.end, endCollapse.collapsed);
    const placement: PanePlacements = measured === undefined
        ? unmeasured(start, end)
        : placePanes(measured.width, startWeight, endWeight, minMain);
    // An open overlay pane leaves a strip of main beside it; until the frame has measured itself, a pane is its size.
    const widths: PaneWidths | undefined = measured === undefined ? undefined : paneWidths(measured.width, startWeight, endWeight, placement);
    // An `auto` pane that starts to overlay closes; once pinned again, it opens
    // again. Then, on the states as they will stand, one overlay pane is open
    // at a time: the one opened last.
    const placed = useRef<PanePlacements>({ start: undefined, end: undefined });
    useLayoutEffect(() => {
        const was = placed.current;
        placed.current = placement;
        const collapsed: Record<Side, boolean> = { start: startCollapse.collapsed, end: endCollapse.collapsed };
        for (const side of SIDES) {
            const dock = dockOf(side);
            if (dock === undefined || modeOf(dock) !== "auto") continue;
            if (placement[side] === "overlay" && was[side] !== "overlay" && !collapsed[side]) {
                autoClosed.current.add(side);
                collapsed[side] = true;
                collapseOf(side).set(true, "frame");
            } else if (placement[side] === "pinned" && was[side] === "overlay" && autoClosed.current.has(side)) {
                autoClosed.current.delete(side);
                collapsed[side] = false;
                collapseOf(side).set(false, "frame");
            }
        }
        if (placement.start === "overlay" && placement.end === "overlay" && startDock !== undefined && endDock !== undefined
            && !collapsed.start && !collapsed.end) {
            const close: Side = lastOpened.current === "end" ? "start" : "end";
            autoClosed.current.delete(close);
            collapseOf(close).set(true, "frame");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a change of place or of a pane's state is what this answers.
    }, [placement.start, placement.end, startCollapse.collapsed, endCollapse.collapsed]);

    /** The overlay pane that is open, if one is. */
    const openOverlay = SIDES.find((side) => placement[side] === "overlay" && dockOf(side) !== undefined && !collapseOf(side).collapsed);
    const openDock = openOverlay === undefined ? undefined : dockOf(openOverlay);
    // A phone's open pane, a view over the whole builder: it needs no scrim.
    const phoneDrawer = openOverlay !== undefined && drawn(openOverlay) ? openOverlay : undefined;
    // The scrim: while an overlay pane is open for lack of room — an `auto` pane overlaying, or any at 560px and narrower.
    const scrim = openDock !== undefined && !dragging && phoneDrawer === undefined
        && (modeOf(openDock) === "auto" || (measured !== undefined && measured.width <= NARROW_FRAME));

    // ── The focus, back on a closed pane's rail ─────────────────────────
    // The pane draws its rail in the render that closes it; the rail's
    // control leads it — the expand control, alone on its bar.
    const railFocus = useRef<Side | undefined>(undefined);
    useLayoutEffect(() => {
        const side = railFocus.current;
        if (side === undefined) return;
        railFocus.current = undefined;
        if (drawn(side)) {
            const dock = dockOf(side);
            const key = dock?.phoneTabs === undefined ? side : `${side}:${dock.tab ?? dock.phoneTabs[0]?.key}`;
            rootRef.current?.querySelector<HTMLElement>(`[data-pane-tab="${key}"]`)?.focus({ preventScroll: true });
        }
        else slotRefs[side].current?.querySelector<HTMLElement>(":scope > * > [data-collapsed] > :first-child > button")?.focus();
    });
    // A drawer opened from its tab takes the focus: its open tab, or its first control.
    const drawerFocus = useRef<Side | undefined>(undefined);
    useLayoutEffect(() => {
        const side = drawerFocus.current;
        if (side === undefined) return;
        drawerFocus.current = undefined;
        const drawer = slotRefs[side].current;
        (drawer?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? drawer?.querySelector<HTMLElement>("button, [href], input, [tabindex]"))?.focus({ preventScroll: true });
    });
    /** A strip tab: its drawer opens, or, open, closes; one of the pane's own tabs opens it there. */
    const onPaneTab = (side: Side, tab?: string) => {
        const open = !collapseOf(side).collapsed;
        const dock = dockOf(side);
        if (tab !== undefined && open && dock?.tab !== tab) { dock?.onTabChange?.(tab); return; }
        if (tab !== undefined && !open) dock?.onTabChange?.(tab);
        if (open) railFocus.current = side;
        else drawerFocus.current = side;
        toggled(side, open);
    };

    // Esc closes the open overlay pane before anything else in the frame hears it. A drag's
    // Esc is the drag's, and a layer portaled out of the frame's regions — a popover, a menu —
    // takes its own, as it does with the key already handled; so does a layer laid in a region
    // that takes Esc itself and says so (`data-escape-layer`: a Chooser laid in a pane).
    const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || event.defaultPrevented || dragging || openOverlay === undefined) return;
        const region = event.target instanceof Element ? event.target.closest("[data-frame-slot]") : null;
        if (region === null || region.closest("[data-builder-frame]") !== rootRef.current) return;
        const layer = (event.target as Element).closest("[data-escape-layer]");
        if (layer !== null && region.contains(layer)) return;
        event.preventDefault();
        event.stopPropagation();
        railFocus.current = openOverlay;
        toggled(openOverlay, true);
    };
    // A phone's pane is a view over the builder: Esc closes it wherever the focus is, as the Filters view's does.
    useViewEscape(phone && openOverlay !== undefined && !dragging, () => {
        if (openOverlay === undefined) return;
        railFocus.current = openOverlay;
        toggled(openOverlay, true);
    });
    // A tap on the scrim closes the pane; the focus, if it was in the pane, goes back to its rail.
    const onScrim = () => {
        if (openOverlay === undefined) return;
        const active = rootRef.current?.ownerDocument.activeElement ?? null;
        if (slotRefs[openOverlay].current?.contains(active) === true) railFocus.current = openOverlay;
        toggled(openOverlay, true);
    };

    const setRoot = useCallback((el: HTMLDivElement | null) => {
        rootRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref !== null && ref !== undefined) (ref as MutableRefObject<HTMLDivElement | null>).current = el;
    }, [ref]);

    const pane = (side: Side, described: BuilderFramePane) => {
        if (isElementPane(described)) {
            return (
                <Box ref={slotRefs[side]} css={styles.pane} data-frame-slot={side} data-pane-mode="pinned">
                    {described.element}
                </Box>
            );
        }
        const placedAt = placement[side] ?? "pinned";
        const collapsed = collapseOf(side).collapsed;
        const size = described.size ?? DEFAULT_SIZE;
        const floating = placedAt === "overlay" && !collapsed;
        // Floating, as wide as the placement leaves it room for.
        const sheetWidth = widths?.[side];
        // Off main, toward its own edge, while a drag is under way.
        const aside = floating && dragging ? (side === "start" ? "translateX(-100%)" : "translateX(100%)") : undefined;
        return (
            <Box ref={slotRefs[side]} css={styles.pane} data-frame-slot={side} data-pane-mode={placedAt}
                data-collapsed={collapsed ? "" : undefined}
                style={{ width: placedAt === "overlay" || collapsed ? `${RAIL}px` : size }}>
                <Box css={styles.sheet} style={floating ? { width: sheetWidth === undefined ? size : `${sheetWidth}px`, transform: aside } : undefined}>
                    <DockPane
                        storageKey={`${storageKey}.${side}`}
                        side={side}
                        surface="shell"
                        expandedSize="100%"
                        railSize="100%"
                        label={described.label}
                        icon={described.icon}
                        badge={described.badge}
                        mark={described.mark}
                        detail={described.detail}
                        active={described.active}
                        tabs={described.tabs}
                        body={described.body}
                        tab={described.tab}
                        onTabChange={described.onTabChange}
                        collapsible={described.collapsible}
                        collapsed={collapsed}
                        onCollapsedChange={(next) => toggled(side, next)}
                    />
                </Box>
                {pxOf(size) === undefined && <Box ref={probeRefs[side]} css={styles.probe} style={{ width: size }} aria-hidden />}
            </Box>
        );
    };

    /** A described pane on a phone: a drawer up from the strip, mounted closed so its tab and bodies keep. */
    const drawer = (side: Side, dock: BuilderFrameDock) => {
        const open = !collapseOf(side).collapsed;
        return (
            <Box key={side} ref={slotRefs[side]} css={styles.drawer} id={`${storageKey}.${side}.drawer`} data-frame-slot={side} data-frame-drawer=""
                data-open={open ? "" : undefined} data-aside={open && dragging ? "" : undefined} role="region" aria-label={dock.label}
                inert={!open} aria-hidden={open ? undefined : true}>
                {/* A tray whose collapse points down, toward the strip; it is drawn collapsed only while the drawer is closed.
                    What it holds is told it is in a phone's drawer: a pane's phone form (SH12). */}
                <FrameDrawer.Provider value={true}>
                <FrameOverlaySlot.Provider value={phoneViews === true && !covered ? overlaySlot : null}>
                <FrameBottomPanel.Provider value={panelOf(side === "start" ? startPanel : endPanel)}>
                <DockPane
                    storageKey={`${storageKey}.${side}`}
                    orientation="vertical"
                    side="end"
                    surface="shell"
                    expandedSize="100%"
                    railSize="100%"
                    label={dock.label}
                    icon={dock.icon}
                    tabs={dock.tabs}
                    body={dock.body}
                    tab={dock.tab}
                    onTabChange={dock.onTabChange}
                    collapsed={!open}
                    onCollapsedChange={(next) => { if (next) { railFocus.current = side; toggled(side, true); } }}
                />
                </FrameBottomPanel.Provider>
                </FrameOverlaySlot.Provider>
                </FrameDrawer.Provider>
                {phonePanel === true && <Box ref={side === "start" ? setStartPanel : setEndPanel} css={styles.bottomPanel} data-frame-slot="bottomPanel" />}
            </Box>
        );
    };
    const paneTab = (side: Side, dock: BuilderFrameDock) => {
        const open = !collapseOf(side).collapsed;
        const meta = dock.detail ?? (dock.badge === undefined || dock.badge === "" ? undefined
            : typeof dock.badge === "number" ? formatters.compact(dock.badge) : dock.badge);
        return (
            <chakra.button key={side} type="button" role="tab" css={styles.paneTab} data-pane-tab={side} aria-selected={open}
                aria-controls={`${storageKey}.${side}.drawer`} data-active={dock.active === true ? "" : undefined} onClick={() => onPaneTab(side)}>
                {dock.icon !== undefined && <Box as="span" css={styles.paneTabIcon}><FontAwesomeIcon icon={dock.icon as IconName} /></Box>}
                <Box as="span" css={styles.paneTabLabel}>{dock.label}</Box>
                {meta !== undefined && <>{" "}<Box as="span" css={styles.paneTabMeta}>{meta}</Box></>}
                {dock.mark !== undefined && <Box as="span" css={styles.paneTabMark} role="img" aria-label={dock.mark.label} data-tone={dock.mark.tone}>
                    <FontAwesomeIcon icon={dock.mark.icon as IconName} />
                </Box>}
            </chakra.button>
        );
    };
    /** One of a pane's own tabs on the strip (`BuilderFrameDock.phoneTabs`). */
    const ownTab = (side: Side, dock: BuilderFrameDock, tab: NonNullable<BuilderFrameDock["phoneTabs"]>[number]) => {
        const selected = !collapseOf(side).collapsed && dock.tab === tab.key;
        return (
            <chakra.button key={`${side}:${tab.key}`} type="button" role="tab" css={styles.paneTab} data-pane-tab={`${side}:${tab.key}`} aria-selected={selected}
                aria-controls={`${storageKey}.${side}.drawer`} onClick={() => onPaneTab(side, tab.key)}>
                {tab.icon !== undefined && <Box as="span" css={styles.paneTabIcon}><FontAwesomeIcon icon={tab.icon as IconName} /></Box>}
                <Box as="span" css={styles.paneTabLabel}>{tab.label}</Box>
                {tab.detail !== undefined && <>{" "}<Box as="span" css={styles.paneTabMeta}>{tab.detail}</Box></>}
            </chakra.button>
        );
    };
    const strip = SIDES.flatMap((side) => {
        const dock = dockOf(side);
        if (dock === undefined || !drawn(side)) return [];
        return dock.phoneTabs === undefined ? [paneTab(side, dock)] : dock.phoneTabs.map((tab) => ownTab(side, dock, tab));
    });

    return (
        <Box ref={setRoot} css={rootCss === undefined ? styles.root : [styles.root, rootCss]} {...rootProps}
            data-builder-frame="" data-phone={phone ? "" : undefined} data-loading={covered ? "" : undefined} aria-busy={loading === undefined ? undefined : covered}
            {...(label !== undefined ? { role: "group", "aria-label": label } : {})}
            onKeyDownCapture={onKeyDownCapture} onKeyDown={onKeyDown}>
            <FramePhoneLayer.Provider value={phone && !covered ? overlaySlot : null}>
            {toolbar !== undefined && (
                <Box ref={toolbarRef} css={styles.toolbar} data-frame-slot="toolbar" inert={covered} aria-hidden={covered ? true : undefined}>
                    <FrameOverlaySlot.Provider value={phone && !covered ? overlaySlot : null}>
                        <Toolbar items={firstRow ?? toolbar} gap={phone ? "none" : undefined} />
                    </FrameOverlaySlot.Provider>
                </Box>
            )}
            {/* A phone's second row: each item's own, in item order (FR6). */}
            {sessionRow && (
                <Box css={styles.sessionRow} data-frame-slot="sessionRow" inert={covered} aria-hidden={covered ? true : undefined}>
                    <FrameSessionBand.Provider value={!covered ? sessionBand : null}>
                        <FrameBottomPanel.Provider value={!covered ? mainPanel : null}>
                            {secondRow.map(({ key, node }) => <Fragment key={key}>{node}</Fragment>)}
                        </FrameBottomPanel.Provider>
                    </FrameSessionBand.Provider>
                </Box>
            )}
            {sessionRow && <Box ref={setSessionBand} css={styles.sessionBand} data-frame-slot="sessionBand" inert={covered} aria-hidden={covered ? true : undefined} />}
            {given(banners) && <Box css={styles.banners} data-frame-slot="banners" inert={covered} aria-hidden={covered ? true : undefined}>{banners}</Box>}
            <Box css={styles.body} data-frame-slot="body" inert={covered} aria-hidden={covered ? true : undefined}>
                {start !== undefined && !drawn("start") && pane("start", start)}
                {/* The region a read after cold load is in flight for (#1398, CL12): nothing covered, main busy. */}
                <Box css={styles.main} data-frame-slot="main" aria-busy={busy === undefined ? undefined : busy && !covered}
                    style={footInset > 0 ? { "--builder-foot-inset": `${footInset}px` } as CSSProperties : undefined}>
                    <FrameOverlaySlot.Provider value={phoneViews === true && !covered ? overlaySlot : null}>
                        <FrameBottomPanel.Provider value={panelOf(mainPanel)}>{children}</FrameBottomPanel.Provider>
                    </FrameOverlaySlot.Provider>
                    {scrim && <Box css={styles.scrim} data-scrim="" aria-hidden onClick={onScrim} />}
                </Box>
                {end !== undefined && !drawn("end") && pane("end", end)}
            </Box>
            {phone && <Box ref={setMainPanel} css={styles.bottomPanel} data-frame-slot="bottomPanel" inert={covered} aria-hidden={covered ? true : undefined} />}
            {strip.length > 0 && (
                <Box css={styles.paneStrip} data-frame-slot="paneStrip" role="tablist" aria-label={label === undefined ? "Panes" : `${label} panes`}
                    inert={covered} aria-hidden={covered ? true : undefined}>
                    {strip}
                </Box>
            )}
            {given(footer) && (
                <Box ref={footerRef} css={styles.footer} data-frame-slot="footer" data-frame-live={footerLive ? "" : undefined}
                    inert={covered && !footerLive} aria-hidden={covered && !footerLive ? true : undefined}>
                    {footer}
                </Box>
            )}
            {/* A phone's panes: each a view over the whole builder, edge to edge, as the Filters view is (ruled 3 Nov 2026,
                in place of FR5's drawer). */}
            {SIDES.map((side) => {
                const dock = dockOf(side);
                return dock !== undefined && drawn(side) ? drawer(side, dock) : null;
            })}
            {/* A phone's view over the whole builder, a toolbar item's (FR7): empty, it takes no pointer. */}
            </FramePhoneLayer.Provider>
            {phone && <Box ref={setOverlaySlot} css={styles.overlay} data-frame-slot="overlay" inert={covered} aria-hidden={covered ? true : undefined} />}
            {covered && <Box css={styles.loading} data-builder-loading="" role="status" aria-label={label === undefined ? "Loading builder" : `Loading ${label}`}
                style={{ "--builder-loading-pitch": `${loadingPitch}px`, ...(footerLive ? { bottom: `${footerHeight ?? 0}px` } : {}) } as CSSProperties}>
                {toolbar !== undefined && <Box css={[styles.toolbar, styles.loadingBar]} aria-hidden>
                    <Skeleton css={styles.loadingLine} /><Skeleton css={styles.loadingLine} /><Skeleton css={styles.loadingLine} />
                </Box>}
                <Box css={styles.loadingBody} aria-hidden>{Array.from({ length: LOADING_ROWS }, (_, i) => <Box key={i} css={styles.loadingRow} data-builder-loading-row="">
                    <Skeleton css={[styles.loadingLine, styles.loadingCell]} /><Skeleton css={[styles.loadingLine, styles.loadingCell]} /><Skeleton css={[styles.loadingLine, styles.loadingCell]} />
                </Box>)}</Box>
                {given(footer) && !footerLive && <Box css={styles.loadingFooter} aria-hidden><Skeleton css={styles.loadingLine} /></Box>}
            </Box>}
        </Box>
    );
}
