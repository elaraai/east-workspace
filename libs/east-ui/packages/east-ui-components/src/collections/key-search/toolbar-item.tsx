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
 * A query lives in its box. While one is typed the item keeps its form, as it
 * does while its popover is open, so the box a user is typing in, or stepping
 * through the matches of, never folds from under them: the row folds its
 * other items around it. Cleared, the item folds with the rest again.
 *
 * A host's key for its search (the Sheet's ⌘F) reaches it in either form
 * through {@link focusKeySearch} (#1221).
 *
 * @packageDocumentation
 */

import { useCallback, useRef, useState } from "react";
import { Box, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import type { EastTypeValue } from "@elaraai/east";
import { DEFAULT_RANK, type ToolbarItem } from "../../toolbar/index.js";
import { SliceEditPopover } from "../../slice/edit/index.js";
import { coarseHitArea } from "../../style/hit-area.js";
import { DatasetKeySearch, type DatasetKeyMatchRange, type DatasetKeyQuery } from "./index.js";

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
    /** The key type typed input is parsed against. */
    keyType: EastTypeValue;
    /** Locates a query — `again`, one the box holds asked again as `requery` moved. */
    find: (query: DatasetKeyQuery, again?: boolean) => Promise<DatasetKeyMatchRange>;
    /** Labels rows `[row, row + limit)` for the box's popup, in row order. */
    listRange: (row: number, limit: number) => Promise<string[]>;
    /** Jumps the host to a match's row. */
    jump: (row: number) => void;
    /** Drops the query and the host's jump. */
    clear: () => void;
}

/** Options of {@link useKeySearchToolbarItem}. */
export interface KeySearchToolbarOptions {
    /** Where the item sits in the row: at its start (the default), or in its end cluster. */
    side?: "start" | "end" | undefined;
    /** The rank of its fold step, from the box to its icon: {@link DEFAULT_RANK} when omitted. */
    rank?: number | undefined;
    /** The icon's accessible name and the popover's head — `Search keys` when omitted. */
    label?: string | undefined;
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
    // The text typed, and the search it was typed into: a box keyed afresh starts empty.
    const [typed, setTyped] = useState<{ resetKey: string; text: string }>({ resetKey: "", text: "" });
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement | null>(null);
    // The popover opens with the focus in its search box.
    const initialFocusEl = useCallback(() => boxRef.current?.querySelector<HTMLElement>("input") ?? null, []);
    if (search === undefined) return undefined;
    const label = options.label ?? "Search keys";
    const active = typed.resetKey === search.resetKey && typed.text !== "";
    const box = (
        <DatasetKeySearch key={search.resetKey} keyType={search.keyType} onFind={search.find}
            onListRange={search.listRange} onJump={search.jump} onClear={search.clear} requery={search.requery}
            onInputChange={(text) => setTyped({ resetKey: search.resetKey, text })} />
    );
    return {
        key: "seek",
        side: options.side,
        forms: [
            box,
            <SliceEditPopover open={open} onOpenChange={setOpen} label={label} size="lg" initialFocusEl={initialFocusEl}
                trigger={
                    // A 44px touch target on a coarse pointer (#346).
                    <chakra.button type="button" css={[chip({ tone: active ? "brand" : "neutral", numeric: true }), coarseHitArea({ position: true })]}
                        aria-label={label} data-key-search="icon" data-state={open ? "open" : "closed"}>
                        <FontAwesomeIcon icon={faMagnifyingGlass} data-chip-icon="" />
                        <FontAwesomeIcon icon={faCaretDown} data-chip-caret="" />
                    </chakra.button>
                }>
                <Box ref={boxRef} data-key-search="popover">{box}</Box>
            </SliceEditPopover>,
        ],
        rank: options.rank ?? DEFAULT_RANK,
        held: active,
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
