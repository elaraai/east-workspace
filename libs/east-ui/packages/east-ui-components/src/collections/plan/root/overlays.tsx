/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * ONE overlay layer for the whole canvas (#816) — a popover, a hover card and a
 * tooltip, each a single Zag machine that exists only while it is open, however
 * many elements the canvas mounts.
 *
 * Elements are plain DOM. Every element kind already names itself —
 * `data-run`, `data-event`, `data-chip`, `data-mark`, `data-cell` (the cell's
 * instant, `instantKey`-encoded) — and its row names it (`data-plan-row`, or a
 * narrow card's `data-plan-card`), so the element ref a resolver is called
 * with is read back from the DOM. The canvas body listens once:
 *
 * - a click opens the popover (and a second click on the same element closes
 *   it) — in the CAPTURE phase, because the elements stop their clicks from
 *   reaching the row, and selection and `on*Click` keep working as before;
 * - Enter on a focused element opens the popover, and Esc closes it and hands
 *   focus back to the element — that Esc is the popover's, never also a rung
 *   of the canvas's esc ladder (the popover's layer takes it first and
 *   prevents it, and the canvas skips a prevented key);
 * - hovering an element opens the hover card after a short delay, on devices
 *   that can hover; leaving it closes the card unless the pointer moved into
 *   the card;
 * - hovering a labelled port, cell marker or link ribbon (#818) shows its
 *   `aria-label` as a tooltip.
 *
 * The open element and its resolved body live in the controller; the DOM node
 * a surface anchors to lives here, out of the store. A surface anchors with
 * `positioning.getAnchorElement`, so it follows the element while the canvas
 * scrolls — and closes once the element leaves the viewport, or the canvas.
 *
 * @packageDocumentation
 */

import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { HoverCard, Popover, Portal, Tooltip } from "@chakra-ui/react";
import { equalFor, variant } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../../component.js";
import { useHoverCapable } from "../../../contracts/adaptive.js";
import type { PlanElementRefValue } from "../context.js";
import { instantKey, instantOfKey } from "../instant.js";
import { usePlanController, usePlanSelector } from "../controller/react.js";
import type { PlanController, PlanSnapshot } from "../controller/index.js";
import { PlanPartBoundary } from "../rows/PartBoundary.js";

type Styles = Record<string, Record<string, unknown>>;

/** The elements a popover or hover card opens from — every element kind's own attribute. */
export const PLAN_ELEMENT_SELECTOR = "[data-run],[data-event],[data-chip],[data-mark],[data-cell]";
/** The labelled marks a tooltip reads — their `aria-label` is its text: ports,
 *  cell markers, and link ribbons (#818). */
export const PLAN_TIP_SELECTOR = "[data-port][aria-label],[data-marker][aria-label],[data-link][aria-label]";

/** Hover intent before a card or tooltip opens — long enough to skip pass-through. */
const OPEN_DELAY_MS = 150;
/** Grace before a card closes, so the pointer can travel into it. */
const CLOSE_DELAY_MS = 120;

const refEqual = equalFor(Plan.Types.ElementRef);

/** Where the open surfaces anchor, and the hover timers — DOM facts, kept out of the store. */
export interface PlanOverlayAnchors {
    popover: HTMLElement | null;
    hover: HTMLElement | null;
    tooltip: HTMLElement | null;
    hoverOpen: ReturnType<typeof setTimeout> | undefined;
    hoverClose: ReturnType<typeof setTimeout> | undefined;
    tipOpen: ReturnType<typeof setTimeout> | undefined;
    /** Set by Esc: the closing popover hands focus back to its element. */
    returnFocus: boolean;
}

/**
 * A canvas's anchor record — created once per mount.
 *
 * @returns An empty record
 */
export function createOverlayAnchors(): PlanOverlayAnchors {
    return {
        popover: null, hover: null, tooltip: null,
        hoverOpen: undefined, hoverClose: undefined, tipOpen: undefined,
        returnFocus: false,
    };
}

/** The element `target` sits in, when it belongs to THIS canvas — a canvas
 *  nested in an expand render or a popover body answers for its own. */
function elementIn(body: HTMLElement | null, target: EventTarget | null, selector: string): HTMLElement | null {
    if (body === null || !(target instanceof Element)) return null;
    const el = target.closest<HTMLElement>(selector);
    if (el === null || !body.contains(el)) return null;
    return el.closest("[data-plan-body]") === body ? el : null;
}

/**
 * The element ref a DOM element names — its kind attribute and its row.
 *
 * @param el - An element matching {@link PLAN_ELEMENT_SELECTOR}
 * @returns The ref, or `undefined` when the element names none
 */
export function refOfElement(el: Element): PlanElementRefValue | undefined {
    const holder = el.closest("[data-plan-row],[data-plan-card]");
    const row = holder?.getAttribute("data-plan-row") ?? holder?.getAttribute("data-plan-card");
    if (row === null || row === undefined) return undefined;
    const run = el.getAttribute("data-run");
    if (run !== null) return variant("run", { row, run }) as PlanElementRefValue;
    const event = el.getAttribute("data-event");
    if (event !== null) return variant("event", { row, event }) as PlanElementRefValue;
    const chip = el.getAttribute("data-chip");
    if (chip !== null) return variant("chip", { row, chip }) as PlanElementRefValue;
    const mark = el.getAttribute("data-mark");
    if (mark !== null) return variant("mark", { row, mark }) as PlanElementRefValue;
    const cell = el.getAttribute("data-cell");
    const at = cell !== null ? instantOfKey(cell) : undefined;
    return at !== undefined ? variant("cell", { row, at }) as PlanElementRefValue : undefined;
}

/** A labelled mark's identity — its row and the mark's own attribute; a link
 *  ribbon's, its index in the root's links. */
function tipOf(el: Element): { key: string; text: string } | undefined {
    const text = el.getAttribute("aria-label");
    if (text === null) return undefined;
    // A ribbon spans rows, so it belongs to none — the link is its identity.
    const link = el.getAttribute("data-link");
    if (link !== null) return { key: `link|${link}`, text };
    const holder = el.closest("[data-plan-row],[data-plan-card]");
    const row = holder?.getAttribute("data-plan-row") ?? holder?.getAttribute("data-plan-card");
    if (row === null || row === undefined) return undefined;
    const port = el.getAttribute("data-port");
    return { key: port !== null ? `${row}|port|${port}` : `${row}|marker|${el.getAttribute("data-marker") ?? ""}`, text };
}

/** A stable identity for an open surface — its element's kind, row and key. */
function refKey(ref: PlanElementRefValue): string {
    switch (ref.type) {
        case "run": return `run|${ref.value.row}|${ref.value.run}`;
        case "event": return `event|${ref.value.row}|${ref.value.event}`;
        case "chip": return `chip|${ref.value.row}|${ref.value.chip}`;
        case "mark": return `mark|${ref.value.row}|${ref.value.mark}`;
        case "cell": return `cell|${ref.value.row}|${instantKey(ref.value.at)}`;
    }
}

/** What the root's element interactions can open. */
export interface PlanOverlayPresence {
    /** The root declares a popover resolver. */
    popover: boolean;
    /** The root declares a hover resolver. */
    hover: boolean;
}

/** The body's delegated listeners. */
export interface PlanOverlayHandlers {
    onClickCapture: (e: MouseEvent<HTMLElement>) => void;
    onPointerOver: (e: PointerEvent<HTMLElement>) => void;
    onPointerOut: (e: PointerEvent<HTMLElement>) => void;
    /** Enter on a focused element opens its popover, and Esc closes an open
     *  one; `true` when the key was the layer's (the canvas then ignores it). */
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => boolean;
}

/**
 * The canvas body's delegated overlay listeners.
 *
 * @param bodyRef - The canvas body (the one element listening)
 * @param controller - The canvas controller (the open surfaces' state)
 * @param anchors - This canvas's anchor record
 * @param presence - Which resolvers the root declares
 * @returns The listeners to spread on the body
 */
export function usePlanOverlayHandlers(
    bodyRef: RefObject<HTMLElement | null>,
    controller: PlanController,
    anchors: PlanOverlayAnchors,
    presence: PlanOverlayPresence,
): PlanOverlayHandlers {
    const hoverCapable = useHoverCapable();
    const { popover: hasPopover, hover: hasHover } = presence;
    useEffect(() => () => {
        clearTimeout(anchors.hoverOpen);
        clearTimeout(anchors.hoverClose);
        clearTimeout(anchors.tipOpen);
    }, [anchors]);
    return useMemo<PlanOverlayHandlers>(() => {
        const openPopover = (el: HTMLElement, toggle: boolean): boolean => {
            const ref = refOfElement(el);
            if (ref === undefined) return false;
            const open = controller.getSnapshot().overlay.popover;
            if (toggle && open !== null && refEqual(open.ref, ref)) {
                controller.overlayIntent("popover", open.ref, false);
                return true;
            }
            anchors.popover = el;
            clearTimeout(anchors.hoverOpen);
            controller.overlayIntent("popover", ref, true);
            return true;
        };
        return {
            onClickCapture: (e) => {
                if (!hasPopover) return;
                const el = elementIn(bodyRef.current, e.target, PLAN_ELEMENT_SELECTOR);
                if (el !== null) openPopover(el, true);
            },
            onKeyDown: (e) => {
                if (e.key === "Escape") {
                    // An open popover is the ladder's top rung. Its own layer
                    // listens on the document, so it takes the Escape first and
                    // prevents it, and the canvas skips a prevented key — except
                    // in the popover's first frame, before the layer listens.
                    // This closes that one.
                    const open = controller.getSnapshot().overlay.popover;
                    if (open === null) return false;
                    e.preventDefault();
                    controller.overlayIntent("popover", open.ref, false);
                    anchors.popover?.focus({ preventScroll: true });
                    return true;
                }
                if (e.key !== "Enter" || !hasPopover) return false;
                const el = elementIn(bodyRef.current, e.target, PLAN_ELEMENT_SELECTOR);
                if (el === null || !openPopover(el, false)) return false;
                e.preventDefault();
                return true;
            },
            onPointerOver: (e) => {
                const body = bodyRef.current;
                const tip = elementIn(body, e.target, PLAN_TIP_SELECTOR);
                if (tip !== null && anchors.tooltip !== tip) {
                    clearTimeout(anchors.tipOpen);
                    anchors.tipOpen = setTimeout(() => {
                        const open = tipOf(tip);
                        if (open === undefined || !tip.isConnected) return;
                        anchors.tooltip = tip;
                        controller.tooltipIntent(open);
                    }, OPEN_DELAY_MS);
                }
                if (!hasHover || !hoverCapable) return;
                const el = elementIn(body, e.target, PLAN_ELEMENT_SELECTOR);
                if (el === null) return;
                clearTimeout(anchors.hoverClose);
                if (anchors.hover === el && controller.getSnapshot().overlay.hover !== null) return;
                clearTimeout(anchors.hoverOpen);
                anchors.hoverOpen = setTimeout(() => {
                    const ref = refOfElement(el);
                    if (ref === undefined || !el.isConnected) return;
                    // A popover open on this element already says more.
                    const pop = controller.getSnapshot().overlay.popover;
                    if (pop !== null && refEqual(pop.ref, ref)) return;
                    anchors.hover = el;
                    controller.overlayIntent("hover", ref, true);
                }, OPEN_DELAY_MS);
            },
            onPointerOut: (e) => {
                const body = bodyRef.current;
                const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
                const tip = elementIn(body, e.target, PLAN_TIP_SELECTOR);
                if (tip !== null && (to === null || !tip.contains(to))) {
                    clearTimeout(anchors.tipOpen);
                    if (anchors.tooltip === tip) {
                        anchors.tooltip = null;
                        controller.tooltipIntent(null);
                    }
                }
                const el = elementIn(body, e.target, PLAN_ELEMENT_SELECTOR);
                if (el === null || (to !== null && el.contains(to))) return;
                clearTimeout(anchors.hoverOpen);
                const open = controller.getSnapshot().overlay.hover;
                if (open === null || anchors.hover !== el) return;
                // The pointer may be on its way into the card: give it a moment,
                // which the card's own pointer-enter cancels.
                clearTimeout(anchors.hoverClose);
                anchors.hoverClose = setTimeout(() => controller.overlayIntent("hover", open.ref, false), CLOSE_DELAY_MS);
            },
        };
    }, [bodyRef, controller, anchors, hasPopover, hasHover, hoverCapable]);
}

const selectOverlay = (s: PlanSnapshot) => s.overlay;

/** Close a surface whose anchor left the viewport (or the canvas). */
function useAnchorWatch(anchor: HTMLElement | null, open: boolean, close: () => void): void {
    const closeRef = useRef(close);
    useLayoutEffect(() => { closeRef.current = close; });
    // An element that is gone takes its surface with it — checked after every
    // render of the layer, which follows every change to what is open.
    useLayoutEffect(() => {
        if (open && anchor !== null && !anchor.isConnected) closeRef.current();
    });
    useEffect(() => {
        if (!open || anchor === null || typeof IntersectionObserver === "undefined") return undefined;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.target === anchor && !entry.isIntersecting)) closeRef.current();
        });
        io.observe(anchor);
        return () => io.disconnect();
    }, [anchor, open]);
}

/**
 * The layer's surfaces — mount once, inside the canvas's controller.
 *
 * @param props - The anchor record, the `plan` recipe styles and the storage prefix
 * @returns The open surfaces (nothing when none is open)
 */
export function PlanOverlays({ anchors, styles, storageKey }: {
    anchors: PlanOverlayAnchors;
    styles: Styles;
    storageKey: string;
}) {
    const controller = usePlanController();
    const { popover, hover, tooltip } = usePlanSelector(selectOverlay);
    const closePopover = () => { if (popover !== null) controller.overlayIntent("popover", popover.ref, false); };
    const closeHover = () => { if (hover !== null) controller.overlayIntent("hover", hover.ref, false); };
    useAnchorWatch(popover !== null ? anchors.popover : null, popover !== null, closePopover);
    useAnchorWatch(hover !== null ? anchors.hover : null, hover !== null, closeHover);
    useAnchorWatch(tooltip !== null ? anchors.tooltip : null, tooltip !== null, () => controller.tooltipIntent(null));
    return (
        <>
            {popover !== null && (
                <Popover.Root
                    key={refKey(popover.ref)}
                    open
                    modal={false}
                    positioning={{ placement: "top", getAnchorElement: () => anchors.popover }}
                    // A click on its own element toggles it (the body's click
                    // handler) — that is not a click OUTSIDE.
                    persistentElements={[() => anchors.popover]}
                    onEscapeKeyDown={() => { anchors.returnFocus = true; }}
                    onOpenChange={(d) => {
                        if (d.open) return;
                        closePopover();
                        if (anchors.returnFocus) anchors.popover?.focus({ preventScroll: true });
                        anchors.returnFocus = false;
                    }}
                >
                    <Portal>
                        <Popover.Positioner>
                            <Popover.Content css={styles.elementOverlay} data-plan-overlay="popover">
                                <Popover.Body padding={0}>
                                    <PlanPartBoundary part="popover" resetKey={popover.body} styles={styles}>
                                        <EastChakraComponent value={popover.body} storageKey={`${storageKey}.popover`} />
                                    </PlanPartBoundary>
                                </Popover.Body>
                            </Popover.Content>
                        </Popover.Positioner>
                    </Portal>
                </Popover.Root>
            )}
            {hover !== null && (
                <HoverCard.Root
                    key={refKey(hover.ref)}
                    open
                    closeDelay={CLOSE_DELAY_MS}
                    positioning={{ placement: "top", getAnchorElement: () => anchors.hover }}
                    onOpenChange={(d) => { if (!d.open) closeHover(); }}
                >
                    <Portal>
                        <HoverCard.Positioner>
                            <HoverCard.Content css={styles.elementOverlay} data-plan-overlay="hover"
                                // The pointer made it into the card: keep it.
                                onPointerEnter={() => clearTimeout(anchors.hoverClose)}>
                                <PlanPartBoundary part="hover card" resetKey={hover.body} styles={styles}>
                                    <EastChakraComponent value={hover.body} storageKey={`${storageKey}.hover`} />
                                </PlanPartBoundary>
                            </HoverCard.Content>
                        </HoverCard.Positioner>
                    </Portal>
                </HoverCard.Root>
            )}
            {tooltip !== null && (
                <Tooltip.Root
                    key={tooltip.key}
                    open
                    positioning={{ placement: "top", getAnchorElement: () => anchors.tooltip }}
                    onOpenChange={(d) => { if (!d.open) controller.tooltipIntent(null); }}
                >
                    <Portal>
                        <Tooltip.Positioner>
                            <Tooltip.Content data-plan-overlay="tooltip">{tooltip.text}</Tooltip.Content>
                        </Tooltip.Positioner>
                    </Portal>
                </Tooltip.Root>
            )}
        </>
    );
}
