/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The slot autocomplete (#936) — the popover a step card's slot opens in the
 * query builder (`Query Editor Spec.md` §4.5): its label and a filter, the
 * slot's offers in their groups, as #934's `slotItems` gives them, and a footer
 * naming where the offers come from and the keys.
 *
 * - **Keys**: ↓ and ↑ move over the offers that can be picked, wrapping; ⏎ —
 *   not with ⌘ or Ctrl, which run the query — or Tab picks the active offer;
 *   Esc closes. A click picks; a press outside it and its slot closes it.
 * - **Typing** filters: the host is told the text and gives the offers for
 *   it, and the first offer that can be picked becomes active.
 * - **Placement** ({@link placeAutocomplete}): left-aligned with its slot and
 *   clamped inside the builder; below the slot, or above it when under 280px
 *   remain below and more is above; in the builder's own pixels when the
 *   builder is CSS-scaled.
 *
 * It is the `popover` recipe's chrome around the `combobox` recipe's list,
 * with the `queryAutocomplete` recipe's parts; its measured position is its
 * one inline style.
 *
 * @packageDocumentation
 */

import {
    memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
    type ChangeEvent, type KeyboardEvent, type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Box, Portal, Tooltip, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { useValueSync } from "@elaraai/east-ui-components";
import type { SlotItem } from "./model/slots.js";

// An offer's icon is a Font Awesome solid name (e.g. "filter"); register the
// free-solid set so it resolves by name (idempotent — safe if already added).
library.add(fas);

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

// ─── The active offer ────────────────────────────────────────────────────────

/** The active offer: where it was, and which it was. */
interface Active {
    /** Its index in the offers it was made active in. */
    readonly index: number;
    /** Its group and label ({@link keyOf}). */
    readonly key: string;
}

/** An offer's identity across the lists the host recomputes: its group and its label. */
function keyOf(item: SlotItem): string {
    return `${item.group}\u0000${item.label}`;
}

/** Whether an offer is there and can be picked. */
function pickable(item: SlotItem | undefined): item is SlotItem {
    return item !== undefined && item.disabled !== true;
}

/** The offer at an index as the active one, when it can be picked. */
function activeAt(items: readonly SlotItem[], index: number): Active | undefined {
    const item = items[index];
    return pickable(item) ? { index, key: keyOf(item) } : undefined;
}

/**
 * The active offer's index in the offers shown: where it was when it is still
 * there, else where it moved to, else the first that can be picked; `-1` when
 * none can be.
 */
function indexOf(items: readonly SlotItem[], active: Active | undefined): number {
    if (active !== undefined) {
        const at = items[active.index];
        if (pickable(at) && keyOf(at) === active.key) return active.index;
        const moved = items.findIndex(item => pickable(item) && keyOf(item) === active.key);
        if (moved >= 0) return moved;
    }
    return items.findIndex(item => pickable(item));
}

/** The next offer that can be picked, moving down or up from one and wrapping; from none, the first or the last. */
function stepFrom(items: readonly SlotItem[], from: number, by: 1 | -1): number {
    const n = items.length;
    for (let k = 1; k <= n; k++) {
        const i = from < 0 ? (by > 0 ? k - 1 : n - k) : (((from + by * k) % n) + n) % n;
        if (pickable(items[i])) return i;
    }
    return -1;
}

/** A run of offers of one group, in the order they come, each with its index. */
interface Run {
    /** The group's heading. */
    readonly group: string;
    /** Its offers, each with its index in the list. */
    readonly offers: { readonly item: SlotItem; readonly index: number }[];
}

/** The offers in runs of one group: a group's heading starts each run, as the offers come. */
function runsOf(items: readonly SlotItem[]): Run[] {
    const runs: Run[] = [];
    items.forEach((item, index) => {
        const last = runs[runs.length - 1];
        if (last !== undefined && last.group === item.group) last.offers.push({ item, index });
        else runs.push({ group: item.group, offers: [{ item, index }] });
    });
    return runs;
}

/** The re-sync gate of the text the host gives: a change of text. */
function sameText(a: string, b: string): boolean {
    return a === b;
}

// ─── An offer ────────────────────────────────────────────────────────────────

/** Props of {@link AutocompleteOption}. */
interface AutocompleteOptionProps {
    /** The offer. */
    readonly item: SlotItem;
    /** Its index in the list. */
    readonly index: number;
    /** Its element's id, which the filter's `aria-activedescendant` names while it is active. */
    readonly id: string;
    /** Whether it is the active offer. */
    readonly active: boolean;
    /** The `combobox` recipe's styles. */
    readonly combobox: Styles;
    /** The `queryAutocomplete` recipe's styles. */
    readonly styles: Styles;
    /** Told it was clicked. */
    readonly onPick: (item: SlotItem) => void;
    /** Told the pointer moved over it. */
    readonly onHover: (index: number) => void;
}

/**
 * One offer: its icon, its label (as data when `mono`), its sub-line — its
 * detail, and its note in the warning tone — and its meta at its end. A
 * disabled offer is listed but never picked, and its note, the reason, is its
 * Tooltip.
 *
 * @param props - the offer, its place and state, the recipes' styles and the handlers
 * @returns the option
 */
function AutocompleteOption({ item, index, id, active, combobox, styles, onPick, onHover }: AutocompleteOptionProps) {
    const disabled = item.disabled === true;
    const note = disabled ? undefined : item.note;
    const option = (
        <Box
            id={id}
            role="option"
            aria-selected={active}
            aria-disabled={disabled ? true : undefined}
            data-highlighted={active ? "" : undefined}
            data-disabled={disabled ? "" : undefined}
            css={[combobox.item, styles.item]}
            onPointerMove={disabled ? undefined : () => onHover(index)}
            onClick={disabled ? undefined : () => onPick(item)}
        >
            {item.icon !== undefined && (
                <chakra.span css={styles.itemIcon}>
                    <FontAwesomeIcon icon={item.icon as IconName} />
                </chakra.span>
            )}
            <Box css={[combobox.itemText, styles.itemBody]}>
                <chakra.span css={styles.itemLabel} data-label="" data-mono={item.mono === true ? "" : undefined} data-typed={item.typed === true ? "" : undefined}>
                    {item.label}
                </chakra.span>
                {(item.detail !== undefined || note !== undefined) && (
                    <chakra.span css={styles.itemSub}>
                        {item.detail !== undefined && <span data-detail="">{item.detail}</span>}
                        {note !== undefined && <chakra.span css={styles.itemNote} data-note="">{note}</chakra.span>}
                    </chakra.span>
                )}
            </Box>
            {item.meta !== undefined && <chakra.span css={styles.itemMeta} data-meta="">{item.meta}</chakra.span>}
        </Box>
    );
    if (!disabled || item.note === undefined) return option;
    return (
        <Tooltip.Root ids={{ trigger: id }} openDelay={250} positioning={{ placement: "right" }}>
            <Tooltip.Trigger asChild>{option}</Tooltip.Trigger>
            <Portal>
                <Tooltip.Positioner>
                    <Tooltip.Content>{item.note}</Tooltip.Content>
                </Tooltip.Positioner>
            </Portal>
        </Tooltip.Root>
    );
}

// ─── The popover ─────────────────────────────────────────────────────────────

/** Props of {@link SlotAutocomplete}. */
export interface SlotAutocompleteProps {
    /** The slot's element: the popover hangs from it, and a press on it is the host's (it toggles the slot), not a press outside. */
    anchor: HTMLElement;
    /**
     * The builder's element: the popover is portaled into it and stays inside
     * it, absolutely positioned in its coordinates — so it is the popover's
     * containing block (positioned, or transformed).
     */
    bounds: HTMLElement;
    /** Its label — `FIELD` (#934's `slotLabel`). */
    label: string;
    /** The filter's placeholder (#934's `slotPlaceholder`). */
    placeholder: string;
    /** The footer's hint: where the offers come from (#934's `slotHint`). */
    hint: string;
    /** What it says with nothing to offer (#934's `slotEmpty`). */
    empty: string;
    /** The keys' hint, `↑↓ ⏎ esc` (#934's `slotKeys`). */
    keys: string;
    /**
     * The offers for the text typed — #934's `slotItems`, which the host
     * recomputes on each change of text. A new list for the same text (a
     * summary arrived) keeps the active offer, found by its group and label,
     * while it is still offered.
     */
    items: readonly SlotItem[];
    /** The text typed; a text the host sets, other than the one typed, replaces it. */
    text: string;
    /** Told each change of the text. */
    onText: (text: string) => void;
    /**
     * The offer active when it opens — #934's `activeItem`; `-1` when none can
     * be picked. Typing makes the first offer that can be picked active.
     */
    initialActive: number;
    /** Told the offer picked: ⏎, Tab or a click. */
    onPick: (item: SlotItem) => void;
    /** Told it closes: Esc, or a press outside it and its anchor. */
    onClose: () => void;
}

/**
 * The slot autocomplete — see the module docs. It opens with `initialActive`
 * active and its filter focused (without scrolling); the active offer stays in
 * view. While it is open it follows its slot as the page scrolls or resizes,
 * and when it closes with the focus in it, the focus returns to its slot.
 * Callbacks reach the host through `queueMicrotask`.
 *
 * @param props - its slot and builder, its words, the offers, the text typed, and the callbacks ({@link SlotAutocompleteProps})
 * @returns the popover, portaled into the builder
 */
export const SlotAutocomplete = memo(function SlotAutocomplete({
    anchor, bounds, label, placeholder, hint, empty, keys, items, text, onText, initialActive, onPick, onClose,
}: SlotAutocompleteProps) {
    const popoverRecipe = useSlotRecipe({ key: "popover" });
    const comboboxRecipe = useSlotRecipe({ key: "combobox" });
    const recipe = useSlotRecipe({ key: "queryAutocomplete" });
    const popover = useMemo(() => popoverRecipe() as Styles, [popoverRecipe]);
    const combobox = useMemo(() => comboboxRecipe() as Styles, [comboboxRecipe]);
    const styles = useMemo(() => recipe() as Styles, [recipe]);

    const ids = useId();
    const inputId = `${ids}-input`;
    const labelId = `${ids}-label`;
    const listId = `${ids}-list`;
    const optionId = useCallback((index: number): string => `${ids}-option-${index}`, [ids]);

    // ── The text typed, and the active offer ────────────────────────────
    // The filter's own text, told to the host; a text the host sets instead
    // of the one typed replaces it, and the first offer becomes active.
    const [typed, setTyped] = useState(text);
    const [active, setActive] = useState<Active | undefined>(() => activeAt(items, initialActive));
    useValueSync(text, sameText, () => {
        if (text === typed) return;
        setTyped(text);
        setActive(undefined);
    });
    const activeIndex = indexOf(items, active);

    // ── The elements ────────────────────────────────────────────────────
    const rootRef = useRef<HTMLDivElement | null>(null);
    const setRoot = useCallback((element: HTMLDivElement | null) => {
        rootRef.current = element;
    }, []);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const anchorRef = useRef(anchor);
    useLayoutEffect(() => {
        anchorRef.current = anchor;
    }, [anchor]);

    // ── Placement: on open, and as the page scrolls or the builder resizes ─
    const [place, setPlace] = useState<AutocompletePlacement | undefined>(undefined);
    const measure = useCallback(() => {
        const root = rootRef.current;
        if (root === null) return;
        const box = bounds.getBoundingClientRect();
        const scale = bounds.offsetWidth > 0 && box.width > 0 ? box.width / bounds.offsetWidth : 1;
        const next = placeAutocomplete({ anchor: anchor.getBoundingClientRect(), bounds: box, width: root.offsetWidth, scale });
        setPlace(prev => (prev !== undefined && samePlace(prev, next) ? prev : next));
    }, [anchor, bounds]);
    useLayoutEffect(() => {
        measure();
        const view = bounds.ownerDocument.defaultView;
        view?.addEventListener("scroll", measure, true);
        view?.addEventListener("resize", measure);
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => measure()) : undefined;
        observer?.observe(bounds);
        return () => {
            view?.removeEventListener("scroll", measure, true);
            view?.removeEventListener("resize", measure);
            observer?.disconnect();
        };
    }, [measure, bounds]);
    const placed = place !== undefined;

    // ── Focus: the filter on open; the slot again on close ──────────────
    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);
    useLayoutEffect(() => () => {
        // Closing with the focus inside — a pick, Esc — hands it back to the
        // slot; a press outside has already moved it.
        const root = rootRef.current;
        if (root !== null && root.contains(root.ownerDocument.activeElement)) anchorRef.current.focus({ preventScroll: true });
    }, []);

    // ── The active offer stays in view, once the popover is placed ──────
    useLayoutEffect(() => {
        if (!placed) return;
        const option = listRef.current?.querySelector<HTMLElement>("[data-highlighted]");
        if (option != null && typeof option.scrollIntoView === "function") option.scrollIntoView({ block: "nearest" });
    }, [placed, activeIndex, items]);

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

    // ── Handlers ────────────────────────────────────────────────────────
    const pick = useCallback((item: SlotItem | undefined) => {
        if (!pickable(item)) return;
        queueMicrotask(() => onPick(item));
    }, [onPick]);
    const onHover = useCallback((index: number) => {
        if (index !== activeIndex) setActive(activeAt(items, index));
    }, [activeIndex, items]);
    const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        const next = event.target.value;
        setTyped(next);
        setActive(undefined);
        queueMicrotask(() => onText(next));
    }, [onText]);
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return;
        switch (event.key) {
            case "ArrowDown":
            case "ArrowUp":
                event.preventDefault();
                setActive(activeAt(items, stepFrom(items, activeIndex, event.key === "ArrowDown" ? 1 : -1)));
                return;
            case "Enter":
                // ⌘⏎ and Ctrl ⏎ run the query: the builder's, not a pick.
                if (event.metaKey || event.ctrlKey) return;
                event.preventDefault();
                pick(items[activeIndex]);
                return;
            case "Tab":
                event.preventDefault();
                pick(items[activeIndex]);
                return;
            case "Escape":
                event.preventDefault();
                queueMicrotask(() => onClose());
                return;
            default:
                return;
        }
    }, [items, activeIndex, pick, onClose]);
    const onMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
        // A press on an offer, a heading or the footer keeps the filter focused.
        if (event.target !== inputRef.current) event.preventDefault();
    }, []);

    // ── The popover ─────────────────────────────────────────────────────
    const runs = useMemo(() => runsOf(items), [items]);
    const position = place === undefined ? undefined
        : place.side === "below" ? { left: place.left, top: place.top, maxHeight: place.maxHeight }
        : { left: place.left, bottom: place.bottom, maxHeight: place.maxHeight };
    return createPortal(
        <Box
            ref={setRoot}
            css={[popover.content, styles.root]}
            data-query-autocomplete=""
            data-side={place?.side}
            style={position}
            onMouseDown={onMouseDown}
        >
            <Box css={[popover.header, styles.header]}>
                <chakra.label id={labelId} htmlFor={inputId} css={[popover.title, styles.label]}>{label}</chakra.label>
                <chakra.input
                    ref={inputRef}
                    id={inputId}
                    type="text"
                    role="combobox"
                    aria-expanded={true}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={placeholder}
                    value={typed}
                    css={combobox.input}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                />
            </Box>
            <Box ref={listRef} css={[popover.body, styles.body]}>
                <Box role="listbox" id={listId} aria-labelledby={labelId} css={[combobox.list, styles.list]}>
                    {runs.map((run, r) => {
                        const headingId = `${ids}-group-${r}`;
                        return (
                            <Box key={`${r}:${run.group}`} role="group" aria-labelledby={run.group === "" ? undefined : headingId} css={combobox.itemGroup}>
                                {run.group !== "" && <Box id={headingId} role="presentation" css={combobox.itemGroupLabel}>{run.group}</Box>}
                                {run.offers.map(({ item, index }) => (
                                    <AutocompleteOption
                                        key={`${index}:${keyOf(item)}`}
                                        item={item}
                                        index={index}
                                        id={optionId(index)}
                                        active={index === activeIndex}
                                        combobox={combobox}
                                        styles={styles}
                                        onPick={pick}
                                        onHover={onHover}
                                    />
                                ))}
                            </Box>
                        );
                    })}
                </Box>
                {items.length === 0 && <Box css={[combobox.empty, styles.empty]} data-empty="">{empty}</Box>}
            </Box>
            <Box css={[popover.footer, styles.footer]}>
                <span data-hint="">{hint}</span>
                <span data-keys="">{keys}</span>
            </Box>
        </Box>,
        bounds,
    );
});
