/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The slot autocomplete (#936, #1673) — the builder's frames around the one
 * picker: the shared `Chooser` over the open slot's offers (`SlotChooser`),
 * which draws its label, its search, the offers in their groups and its keys.
 * What a step card's slot opens in the query builder (`Query Editor Spec.md`
 * §4.5).
 *
 * - **In the builder's pane**: a popover placed by its slot
 *   ({@link placeAutocomplete}) — left-aligned with it and clamped inside the
 *   builder; below it, or above it when under 280px remain below and more is
 *   above; in the builder's own pixels when the builder is CSS-scaled. A press
 *   outside it and its slot closes it.
 * - **On a phone** (`Query Builder Phone Spec.md` QP33, QP34): a view over the
 *   whole builder — ← back, its title and what it is for at its head; the
 *   picker bare in its body, the slot's value now checked, and a short list
 *   of steps with no search; where the offers come from at its foot. Esc goes
 *   back, wherever the focus is.
 *
 * It is the `popover` recipe's chrome around the picker, with the
 * `queryAutocomplete` recipe's frame, or the `queryPhone` recipe's view; its
 * measured position is its one inline style.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { SlotChooser } from "./slot-chooser.js";
import type { SlotPopover } from "./use-query-editor.js";

type Styles = Record<string, SystemStyleObject>;

/** The room the popover keeps from the builder's edges, in its own pixels. */
const INSET = 8;
/** The gap between the slot and the popover. */
const GAP = 4;
/** Under this much room below its slot, the popover opens above it when more is there. */
const FLIP_BELOW = 280;

// ─── Placement ───────────────────────────────────────────────────────────────

/** A box as the viewport measures it — what `getBoundingClientRect` gives. */
export interface PlacementBox {
    /** Its left edge. */
    readonly left: number;
    /** Its top edge. */
    readonly top: number;
    /** Its width. */
    readonly width: number;
    /** Its height. */
    readonly height: number;
}

/** What {@link placeAutocomplete} places the popover by. */
export interface AutocompletePlacementInput {
    /** The slot's box, as the viewport measures it. */
    readonly anchor: PlacementBox;
    /** The builder's box, as the viewport measures it. */
    readonly bounds: PlacementBox;
    /** The popover's width, in the builder's own pixels (its `offsetWidth`). */
    readonly width: number;
    /** How much the builder is CSS-scaled: its measured width over its own (`offsetWidth`); 1 when it is not. */
    readonly scale: number;
}

/** The popover below its slot, in the builder's own pixels. */
export interface AutocompleteBelow {
    /** The side of its slot it opens on. */
    readonly side: "below";
    /** Its left edge, from the builder's. */
    readonly left: number;
    /** Its top edge, from the builder's. */
    readonly top: number;
    /** Its greatest height, to end inside the builder. */
    readonly maxHeight: number;
}

/** The popover above its slot, in the builder's own pixels: its bottom edge is held, so it grows upward. */
export interface AutocompleteAbove {
    /** The side of its slot it opens on. */
    readonly side: "above";
    /** Its left edge, from the builder's. */
    readonly left: number;
    /** Its bottom edge, from the builder's bottom edge. */
    readonly bottom: number;
    /** Its greatest height, to start inside the builder. */
    readonly maxHeight: number;
}

/** Where the popover goes, in the builder's own pixels. */
export type AutocompletePlacement = AutocompleteBelow | AutocompleteAbove;

/**
 * Where the slot autocomplete goes (`Query Editor Spec.md` §4.5): left-aligned
 * with its slot and clamped 8px inside the builder; 4px below the slot, or 4px
 * above it when under 280px remain below and more is above. A CSS-scaled
 * builder measures scaled, so every measure is divided by its scale into the
 * builder's own pixels, the ones its absolutely positioned popover is laid
 * out in.
 *
 * @param input - the slot's and the builder's boxes as measured, the popover's width and the builder's scale
 * @returns the side it opens on, its left edge and its top edge (below) or bottom edge (above), and its greatest height
 */
export function placeAutocomplete({ anchor, bounds, width, scale }: AutocompletePlacementInput): AutocompletePlacement {
    const k = scale > 0 && Number.isFinite(scale) ? scale : 1;
    const outerWidth = bounds.width / k;
    const outerHeight = bounds.height / k;
    const left = Math.max(INSET, Math.min(outerWidth - width - INSET, (anchor.left - bounds.left) / k));
    const below = (anchor.top + anchor.height - bounds.top) / k + GAP;
    const above = (anchor.top - bounds.top) / k - GAP;
    const roomBelow = outerHeight - below;
    if (roomBelow < FLIP_BELOW && above > roomBelow) {
        return { side: "above", left, bottom: outerHeight - above, maxHeight: Math.max(0, above - INSET) };
    }
    return { side: "below", left, top: below, maxHeight: Math.max(0, roomBelow - INSET) };
}

/** Whether two placements put the popover in the same place. */
function samePlace(a: AutocompletePlacement, b: AutocompletePlacement): boolean {
    if (a.left !== b.left || a.maxHeight !== b.maxHeight) return false;
    return a.side === "below" ? b.side === "below" && a.top === b.top : b.side === "above" && a.bottom === b.bottom;
}

// ─── The frames ──────────────────────────────────────────────────────────────

/** Props of {@link SlotAutocomplete}. */
export interface SlotAutocompleteProps {
    /**
     * The open slot's offers, its words and what it is told, as the editor gives them (`SlotPopover`) — with a phone's own
     * words and offers in their place where it gives them. Its slot's element is where the popover hangs from, and a press
     * on it is the host's (it toggles the slot), not a press outside.
     */
    popover: SlotPopover;
    /**
     * The builder's element: the popover is portaled into it and stays inside
     * it, absolutely positioned in its coordinates — so it is the popover's
     * containing block (positioned, or transformed).
     */
    bounds: HTMLElement;
    /**
     * A phone's frame's overlay slot: drawn there, a view over the whole builder (`Query Builder Phone Spec.md` QP33) —
     * ← back and its label at its head, the picker bare in its body, where the offers come from at its foot — placed
     * nowhere and floating over nothing. Esc goes back, wherever the focus is.
     */
    view?: HTMLElement | null | undefined;
    /** The name of the view's ←. */
    backLabel?: string | undefined;
    /** What it is for, beside the view's title: `Step 1 · condition 2`. */
    context?: string | undefined;
    /** Whether the picker draws its search; a view of a short list of steps (QP34) does not. Drawn by default. */
    search?: boolean | undefined;
}

/**
 * The slot autocomplete — see the module docs. It opens with the slot's offer
 * active and its search focused (without scrolling); a choice or an Esc hands
 * the focus back to its slot. While it is open in the builder's pane it
 * follows its slot as the page scrolls or resizes. A close the frame hears
 * reaches the host through `queueMicrotask`.
 *
 * @param props - the open slot's offers and words, the builder, and on a phone its view ({@link SlotAutocompleteProps})
 * @returns the popover, portaled into the builder, or the view, into the phone's overlay slot
 */
export const SlotAutocomplete = memo(function SlotAutocomplete({ popover, bounds, view, backLabel, context, search }: SlotAutocompleteProps) {
    const phoneStyles = useSlotStyles("queryPhone");
    const popoverRecipe = useSlotRecipe({ key: "popover" });
    const recipe = useSlotRecipe({ key: "queryAutocomplete" });
    const chrome = popoverRecipe() as Styles;
    const styles = recipe() as Styles;
    const isView = view !== undefined && view !== null;
    const anchor = popover.slot.anchor;
    const onClose = popover.onClose;
    const labelId = useId();

    const rootRef = useRef<HTMLDivElement | null>(null);
    const setRoot = useCallback((element: HTMLDivElement | null) => {
        rootRef.current = element;
    }, []);
    const anchorRef = useRef(anchor);
    useLayoutEffect(() => {
        anchorRef.current = anchor;
    }, [anchor]);
    // Closing with the focus inside — a view's ←, its Esc — hands it back to the slot; a choice has handed it back already,
    // and a press outside has moved it.
    useLayoutEffect(() => () => {
        const root = rootRef.current;
        if (root !== null && root.contains(root.ownerDocument.activeElement)) anchorRef.current.focus({ preventScroll: true });
    }, []);

    // ── Placement: on open, and as the page scrolls or the builder resizes ─
    const [place, setPlace] = useState<AutocompletePlacement | undefined>(undefined);
    const measure = useCallback(() => {
        const root = rootRef.current;
        if (root === null || isView) return;
        const box = bounds.getBoundingClientRect();
        const scale = bounds.offsetWidth > 0 && box.width > 0 ? box.width / bounds.offsetWidth : 1;
        const next = placeAutocomplete({ anchor: anchor.getBoundingClientRect(), bounds: box, width: root.offsetWidth, scale });
        setPlace(prev => (prev !== undefined && samePlace(prev, next) ? prev : next));
    }, [anchor, bounds, isView]);
    useLayoutEffect(() => {
        measure();
        const win = bounds.ownerDocument.defaultView;
        win?.addEventListener("scroll", measure, true);
        win?.addEventListener("resize", measure);
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => measure()) : undefined;
        observer?.observe(bounds);
        return () => {
            win?.removeEventListener("scroll", measure, true);
            win?.removeEventListener("resize", measure);
            observer?.disconnect();
        };
    }, [measure, bounds]);
    // Placed, its height is the room its side leaves it: the highlighted option stays in view in the list that room keeps.
    useLayoutEffect(() => {
        if (place === undefined) return;
        const option = rootRef.current?.querySelector<HTMLElement>("[data-highlighted]");
        if (option != null && typeof option.scrollIntoView === "function") option.scrollIntoView({ block: "nearest" });
    }, [place]);

    // ── A view hears Esc wherever the focus is, ahead of the pane it lies over ─
    useEffect(() => {
        if (!isView) return undefined;
        const onEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            queueMicrotask(() => onClose());
        };
        document.addEventListener("keydown", onEscape, true);
        return () => document.removeEventListener("keydown", onEscape, true);
    }, [isView, onClose]);

    // ── A press outside it and its slot closes it ───────────────────────
    useEffect(() => {
        const doc = anchor.ownerDocument;
        const onPointerDown = (event: PointerEvent): void => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (rootRef.current?.contains(target) === true || anchor.contains(target)) return;
            queueMicrotask(() => onClose());
        };
        doc.addEventListener("pointerdown", onPointerDown, true);
        return () => doc.removeEventListener("pointerdown", onPointerDown, true);
    }, [anchor, onClose]);

    // A press on its heads, its foot or its edge keeps the search focused.
    const onMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    }, []);

    if (isView) {
        return createPortal(
            <Box ref={setRoot} css={phoneStyles.view} data-query-autocomplete="" data-query-view-picker="" role="dialog" aria-labelledby={labelId}>
                <Box css={phoneStyles.viewHead}>
                    <chakra.button type="button" css={phoneStyles.viewBack} aria-label={backLabel} onClick={() => onClose()}><FontAwesomeIcon icon={faArrowLeft} aria-hidden /></chakra.button>
                    <Box as="span" id={labelId} css={phoneStyles.viewTitle}>{popover.label}</Box>
                    {context !== undefined && <Box as="span" css={phoneStyles.viewContext}>{context}</Box>}
                </Box>
                <Box css={phoneStyles.viewList}>
                    <SlotChooser popover={popover} surface="bare" search={search} checked titled />
                </Box>
                <Box css={phoneStyles.viewFoot}><span data-hint="">{popover.hint}</span></Box>
            </Box>,
            view,
        );
    }
    const position = place === undefined ? undefined
        : place.side === "below" ? { left: place.left, top: place.top, maxHeight: place.maxHeight }
        : { left: place.left, bottom: place.bottom, maxHeight: place.maxHeight };
    return createPortal(
        <Box ref={setRoot} css={[chrome.content, styles.root]} data-query-autocomplete="" data-side={place?.side} style={position} onMouseDown={onMouseDown}>
            <SlotChooser popover={popover} surface="popover" search={search} />
        </Box>,
        bounds,
    );
});
