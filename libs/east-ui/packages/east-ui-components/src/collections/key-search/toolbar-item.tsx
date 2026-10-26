/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The key search as one item of a builder's toolbar (#1193) — the Plan's and
 * the Sheet's, over a keyed paged source's `seek`. It has two forms, widest
 * first: the search box ({@link DatasetKeySearch}), then its icon, which opens
 * the same box in the design system's edit popover (`SliceEditPopover`) with
 * the focus in its input. A row short of room folds the box to its icon, as
 * the slice rail folds its narrowing to its own: the search stays in the row.
 *
 * The box is one, whatever form the item takes: the toolbar keeps it apart
 * from the item's forms (the item's `keep`, a portal into a container of its
 * own), and each form shows it where it places it — in the row, or in the
 * popover its icon opens — so its query, its matches and its pick stand as it
 * folds. A query lives in its box. While one stands the item keeps its form
 * while anything else in the row can fold (`foldsLast`): the row folds its
 * other items around it. Once nothing else can and the row still does not
 * fit, the box folds to its icon — its query and its pick shown in the popover
 * its icon opens — so the row always fits, a builder's history and Save in it
 * (ruled 26 Oct 2026, "Find folds"), and it unfolds no more while the query
 * stands. While its list of matches is open, as it is while a query is typed,
 * or its popover is, the item keeps its form whatever the width. A box that
 * folds away with the focus in it gives the focus to the icon it folded to.
 * Cleared, the item folds with the rest again.
 *
 * A host's key for its search (the Sheet's ⌘F) reaches it in either form
 * through {@link focusKeySearch} (#1221).
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Box, chakra, useRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import type { EastTypeValue } from "@elaraai/east";
import { DEFAULT_RANK, type ToolbarItem } from "../../toolbar/index.js";
import { SliceEditPopover } from "../../slice/edit/index.js";
import { coarseHitArea } from "../../style/hit-area.js";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { DatasetKeySearch, type DatasetKeyMatchRange, type DatasetKeyQuery, type DatasetKeySearchProps, type KeySearchJump } from "./index.js";

/** The icon a folded box opens from, in its toolbar item. */
const ICON = '[data-key-search="icon"]';

/**
 * Where the key search's box stands (see the module docs): the container it is rendered into, once, and the slots of
 * the item's forms it may stand in — the last one mounted holds it, and while none is mounted it stands in no place of
 * the page, all it holds kept.
 */
interface BoxStage {
    /** The container the box is rendered into. */
    readonly container: HTMLElement;
    /** A slot mounted: the box goes into it. */
    attach(slot: HTMLElement): void;
    /** A slot gone: the box goes back to the slot mounted before it, if one still is; gone holding the focus, the box gives it to the icon it folded to. */
    detach(slot: HTMLElement): void;
}

/** Makes a box's stage: its container, in no slot yet. */
function createBoxStage(): BoxStage {
    const container = document.createElement("div");
    container.setAttribute("data-key-search-box", "");
    const slots: HTMLElement[] = [];
    const place = () => {
        const slot = slots.at(-1);
        if (slot === undefined) container.remove();
        else if (container.parentElement !== slot) slot.appendChild(container);
    };
    return {
        container,
        attach: (slot) => {
            slots.push(slot);
            place();
        },
        detach: (slot) => {
            const at = slots.lastIndexOf(slot);
            if (at >= 0) slots.splice(at, 1);
            const doc = container.ownerDocument;
            const focused = container.contains(doc.activeElement);
            const item = slot.closest("[data-toolbar-item]");
            place();
            if (!focused || slots.length > 0 || item === null) return;
            // The box folded away holding the focus: the focus goes to the icon it folded to, once the toolbar has drawn
            // it — unless another element of the page has taken it since.
            queueMicrotask(() => {
                const active = doc.activeElement;
                const elsewhere = active !== null && active !== doc.body && active.isConnected && !container.contains(active);
                if (!item.isConnected || elsewhere) return;
                item.querySelector<HTMLElement>(ICON)?.focus({ preventScroll: true });
            });
        },
    };
}

/** A place the box stands in — the row's (`box`), or the popover's its icon opens (`popover`) — drawing no box of its own. */
function BoxSlot({ stage, where, css, slot }: {
    stage: BoxStage; where: "box" | "popover"; css: SystemStyleObject | undefined; slot?: MutableRefObject<HTMLDivElement | null> | undefined;
}) {
    const mounted = useRef<HTMLDivElement | null>(null);
    const ref = useCallback((el: HTMLDivElement | null) => {
        if (el !== null) {
            mounted.current = el;
            stage.attach(el);
        } else if (mounted.current !== null) {
            stage.detach(mounted.current);
            mounted.current = null;
        }
        if (slot !== undefined) slot.current = el;
    }, [stage, slot]);
    return <Box ref={ref} css={css} data-key-search={where} />;
}

/** What a key search reads and drives: a keyed source's `seek`, as its host wires it. */
export interface KeySearchSource {
    /** Keys the search: when it changes — the source moved to another
     *  revision, whose rows its matches no longer index, for a host that drops
     *  a query then — the box starts again, empty. */
    resetKey: string;
    /** Moves when the source moved to another snapshot, for a host that keeps
     *  a query then (#1199): the box asks the query it holds again, its text
     *  kept. */
    requery?: number | undefined;
    /** Moves when what the host says of the rows the box lists moves — the
     *  filters that hide a row, once the Sheet knows which: the box lists them
     *  again, its query, its count and its place kept. */
    relist?: number | undefined;
    /** Query used to list suggestions when opening an empty box; absent for sources that require typed input. */
    browseQuery?: DatasetKeyQuery | undefined;
    /** A source-specific explanation when a completed query finds nothing. */
    noMatchesText?: string | undefined;
    /** The key type typed input is parsed against. */
    keyType: EastTypeValue;
    /** Locates a query — `again`, one the box holds asked again as `requery` moved. */
    find: (query: DatasetKeyQuery, again?: boolean) => Promise<DatasetKeyMatchRange>;
    /** Labels rows `[row, row + limit)` for the box's popup, in row order. */
    listRange: DatasetKeySearchProps["onListRange"];
    /** Jumps the host to a match's row: a pick, whose match takes the keyboard as it lands (`usePickHandOff`), or a step. */
    jump: (row: number, how: KeySearchJump) => void;
    /** Drops the query and the host's jump. */
    clear: () => void;
}

/** Options of {@link useKeySearchToolbarItem}. */
export interface KeySearchToolbarOptions {
    /** Where the item sits in the row: at its start (the default), or in its end cluster. */
    side?: "start" | "end" | undefined;
    /** The rank of its fold step, from the box to its icon: {@link DEFAULT_RANK} when omitted. */
    rank?: number | undefined;
    /** The input's placeholder, icon's accessible name and popover's head — `Search Records` when omitted. */
    label?: string | undefined;
    /** Optional final form sharing the search popover with host controls.
     * Bundle this step with the step hiding those controls in the toolbar.
     * Given as a function, the controls take the popover's close: a control
     * that does what it is for and moves the focus away (a Sheet's view
     * picked, #1345) closes it, as a menu's item closes its menu. */
    compact?: { label: string; controls: ReactNode | ((close: () => void) => ReactNode) } | undefined;
}

/**
 * The key search as one item of a builder's toolbar — see the module docs.
 *
 * @param search - The keyed source's search, or `undefined` where the source cannot seek
 * @param options - The item's side, its fold step's rank and its words
 * @returns The item, keyed `seek` — `undefined` without a search
 */
export function useKeySearchToolbarItem(search: KeySearchSource | undefined, options: KeySearchToolbarOptions = {}): ToolbarItem | undefined {
    const chip = useRecipe({ key: "chip" });
    // The box's places draw no box of their own: the combobox recipe's slot for them.
    const styles = useSlotStyles("combobox", { size: "xs" });
    // The text typed, and the search it was typed into: a box keyed afresh starts empty.
    const [typed, setTyped] = useState<{ resetKey: string; text: string }>({ resetKey: "", text: "" });
    const [open, setOpen] = useState(false);
    // Where the box stands, whatever form the item takes: one box, its query, its matches and its pick kept as it folds.
    const [stage] = useState(createBoxStage);
    // The popover opens with the focus in its search box.
    const popoverSlot = useRef<HTMLDivElement | null>(null);
    const initialFocusEl = useCallback(() => popoverSlot.current?.querySelector<HTMLElement>("input") ?? null, []);
    // What is typed, kept with the search it was typed into — the same function while the search is, so the box,
    // drawn again with its builder's toolbar, draws nothing again for it (#1398, CL9).
    const resetKey = search?.resetKey ?? "";
    const onInputChange = useCallback((text: string) => setTyped({ resetKey, text }), [resetKey]);
    if (search === undefined) return undefined;
    const label = options.label ?? "Search Records";
    const active = typed.resetKey === search.resetKey && typed.text !== "";
    const box = (
        <DatasetKeySearch key={search.resetKey} label={options.label} keyType={search.keyType} onFind={search.find}
            browseQuery={search.browseQuery} noMatchesText={search.noMatchesText}
            onListRange={search.listRange} onJump={search.jump} onClear={search.clear} requery={search.requery} relist={search.relist}
            onInputChange={onInputChange} />
    );
    const popup = (heading: string, controls?: ReactNode | ((close: () => void) => ReactNode)) => (
        <SliceEditPopover open={open} onOpenChange={setOpen} label={heading} size="lg" initialFocusEl={initialFocusEl}
            trigger={
                // A 44px touch target on a coarse pointer (#346).
                <chakra.button type="button" css={[chip({ tone: active ? "brand" : "neutral", numeric: true }), coarseHitArea({ position: true })]}
                    aria-label={heading} data-key-search="icon" data-state={open ? "open" : "closed"}>
                    <FontAwesomeIcon icon={faMagnifyingGlass} data-chip-icon="" />
                    <FontAwesomeIcon icon={faCaretDown} data-chip-caret="" />
                </chakra.button>
            }>
            {typeof controls === "function" ? controls(() => setOpen(false)) : controls}
            <BoxSlot stage={stage} where="popover" css={styles.searchSlot} slot={popoverSlot} />
        </SliceEditPopover>
    );
    return {
        key: "seek",
        side: options.side,
        forms: [
            <BoxSlot stage={stage} where="box" css={styles.searchSlot} />,
            popup(label),
            ...(options.compact === undefined ? [] : [popup(options.compact.label, options.compact.controls)]),
        ],
        rank: options.rank ?? DEFAULT_RANK,
        // While a query stands the item keeps its form while anything else in the row can fold; once nothing else can,
        // the box folds to its icon, its query and its pick in the popover its icon opens (ruled 26 Oct 2026, "Find folds").
        foldsLast: active,
        // The one box, whatever form the item takes: its slots show it where they place it.
        keep: createPortal(box, stage.container),
    };
}

/**
 * Brings the focus to the key search a toolbar holds (#1221) — what a host's
 * key for its search does: its box's input, its text selected; or, folded to
 * its icon, the box in its popover, which it opens (the popover puts the focus
 * in the box), or focuses there when it is open.
 *
 * @param toolbar - The toolbar's element (a `BuilderFrame`'s `toolbarRef`)
 * @returns `false` when the toolbar holds no key search
 */
export function focusKeySearch(toolbar: HTMLElement | null): boolean {
    const item = toolbar?.querySelector('[data-toolbar-item="seek"]') ?? null;
    if (item === null) return false;
    const input = item.querySelector<HTMLInputElement>("input");
    if (input !== null) {
        input.focus();
        input.select();
        return true;
    }
    const icon = item.querySelector<HTMLElement>('[data-key-search="icon"]');
    if (icon === null) return false;
    if (icon.getAttribute("data-state") !== "open") {
        icon.click();
        return true;
    }
    // Open already: the box in the popover its trigger controls.
    const content = icon.closest('[data-part="trigger"]')?.getAttribute("aria-controls");
    if (content !== null && content !== undefined) document.getElementById(content)?.querySelector<HTMLInputElement>("input")?.focus();
    return true;
}
