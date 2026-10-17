/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Chooser (#1322): a searchable, sectioned single-choice list — each option
 * with its line and its range, one that doesn't fit disabled with its reason —
 * driven by ↑↓ Enter Esc. A host lays it in a `SliceEditPopover` anchored
 * under a cell (`flush`), or in a pane under a field (`surface="inline"`); its
 * sections and options are data, and the host runs the choice.
 *
 * - Search filters by each option's label and line (or its own `match`); a
 *   section left empty goes, and nothing left says `no match`.
 * - ↑↓ cycle the options a choice can take — the current one and those that
 *   fit — Enter chooses the highlighted one, Esc closes; hovering one
 *   highlights it; typing puts the highlight back on the first.
 * - Current wears a check, an option refused a × and its reason in the warning
 *   text; a disabled one (taken elsewhere) is only muted.
 *
 * It is a React part for renderers, as `BuilderFrame` is: no East component.
 *
 * @packageDocumentation
 */

import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faArrowUp, faCheck, faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";

/**
 * How an option can be chosen.
 *
 * - `enabled`: it can be chosen.
 * - `current`: what the cell holds now, checked; choosing it changes nothing.
 * - `refused`: it doesn't fit — a × and its reason.
 * - `disabled`: it can't be chosen for another reason (taken elsewhere) — muted.
 */
export type ChooserOptionState = "enabled" | "current" | "refused" | "disabled";

/** One option. */
export interface ChooserOption {
    /** Its identity, what a choice hands back. */
    key: string;
    /** Its name (`K-203`, `LD-2231`). */
    label: string;
    /** Its line: its reason, or what it is (`3 d spare to Wed 19 · leaves 31 m³ · takes 20–40`). */
    line?: string | undefined;
    /** Its range, at the end (`20–40 m³`, `21 m³`). */
    range?: string | undefined;
    /** How it can be chosen. */
    state: ChooserOptionState;
    /** Its line in the warning text while it can still be chosen (an overdue event). */
    warn?: boolean | undefined;
    /** What the search reads; its label and line by default. */
    match?: string | undefined;
}

/** One section: its head, and its options in order. */
export interface ChooserSection {
    /** Its head (`Gaps that fit`, `Doesn't fit`). */
    label: string;
    /** Its options. */
    options: readonly ChooserOption[];
}

/** The Chooser's props. */
export interface ChooserProps {
    /** The sections, in order. */
    sections: readonly ChooserSection[];
    /** The search box's placeholder and name (`Find a resource`). */
    placeholder: string;
    /** An option chosen: its key. */
    onChoose: (key: string) => void;
    /** Esc in the search box. In a popover the popover closes on Esc itself; this is for a Chooser laid in a pane. */
    onClose?: (() => void) | undefined;
    /** Where it sits: in a popover (the default), or laid in a pane with its own border. */
    surface?: "popover" | "inline";
    /** Whether the search box takes the focus as it mounts (a pane's; a popover gives it its own). */
    autoFocus?: boolean;
}

/** Whether a choice can take an option. */
const choosable = (o: ChooserOption): boolean => o.state === "enabled" || o.state === "current";

/**
 * The Chooser — a searchable, sectioned single-choice list (see the module docs).
 *
 * @param props - The sections and what a choice does
 * @returns The list, its search and its keys
 */
export const Chooser = memo(function Chooser({ sections, placeholder, onChoose, onClose, surface = "popover", autoFocus }: ChooserProps) {
    const styles = useSlotRecipe({ key: "chooser" })({ surface });
    const listId = useId();
    const [query, setQuery] = useState("");
    const [highlight, setHighlight] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => { if (autoFocus === true) inputRef.current?.focus({ preventScroll: true }); }, [autoFocus]);
    // The sections the search leaves, and the options a choice can take in order.
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        const hit = (o: ChooserOption) => q === "" || (o.match ?? `${o.label} ${o.line ?? ""}`).toLowerCase().includes(q);
        return sections.map((s) => ({ label: s.label, options: s.options.filter(hit) })).filter((s) => s.options.length > 0);
    }, [sections, query]);
    const enabled = useMemo(() => shown.flatMap((s) => s.options.filter(choosable)), [shown]);
    const at = enabled.length === 0 ? -1 : Math.min(highlight, enabled.length - 1);
    const active = at >= 0 ? enabled[at] : undefined;
    const optionId = (key: string) => `${listId}-${key}`;
    // The highlighted option stays in view as the keys move it.
    const listRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (active === undefined) return;
        const el = listRef.current?.ownerDocument.getElementById(optionId(active.key));
        el?.scrollIntoView?.({ block: "nearest" });
    });
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const n = enabled.length;
            if (n > 0) setHighlight(((at < 0 ? 0 : at) + (event.key === "ArrowDown" ? 1 : n - 1)) % n);
        } else if (event.key === "Enter") {
            event.preventDefault();
            if (active !== undefined) onChoose(active.key);
        } else if (event.key === "Escape" && onClose !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        }
    };
    return (
        <Box css={styles.root} data-chooser="">
            <Box css={styles.search}>
                <chakra.label css={styles.searchBox}>
                    <Box as="span" css={styles.searchIcon}><FontAwesomeIcon icon={faMagnifyingGlass} /></Box>
                    <chakra.input ref={inputRef} css={styles.searchInput} type="search" role="combobox" aria-expanded="true"
                        aria-autocomplete="list" aria-controls={listId} aria-activedescendant={active !== undefined ? optionId(active.key) : undefined}
                        value={query} placeholder={placeholder} aria-label={placeholder}
                        onChange={(event) => { setQuery(event.currentTarget.value); setHighlight(0); }} onKeyDown={onKeyDown} />
                </chakra.label>
            </Box>
            <Box ref={listRef} css={styles.list} id={listId} role="listbox" aria-label={placeholder}>
                {shown.map((section) => (
                    <Box key={section.label} role="group" aria-label={section.label}>
                        <Box css={styles.section} aria-hidden="true">{section.label}</Box>
                        {section.options.map((o) => {
                            const can = choosable(o);
                            const index = can ? enabled.indexOf(o) : -1;
                            return (
                                <chakra.button key={o.key} type="button" tabIndex={-1} css={styles.option} id={optionId(o.key)}
                                    role="option" aria-selected={o.state === "current"} aria-disabled={!can} disabled={!can}
                                    data-state={o.state === "enabled" ? undefined : o.state} data-warn={o.warn === true ? "" : undefined}
                                    data-highlighted={index >= 0 && index === at ? "" : undefined}
                                    onMouseEnter={() => { if (index >= 0 && index !== at) setHighlight(index); }}
                                    onClick={() => { if (can) onChoose(o.key); }}>
                                    <Box as="span" css={styles.mark}>
                                        {o.state === "current" && <FontAwesomeIcon icon={faCheck} aria-label="Current" />}
                                        {o.state === "refused" && <FontAwesomeIcon icon={faXmark} aria-label="Doesn't fit" />}
                                    </Box>
                                    <Box as="span" css={styles.text}>
                                        <Box as="span" css={styles.label}>{o.label}</Box>
                                        {o.line !== undefined && <Box as="span" css={styles.line}>{o.line}</Box>}
                                    </Box>
                                    <Box as="span" css={styles.range}>{o.range}</Box>
                                </chakra.button>
                            );
                        })}
                    </Box>
                ))}
                {shown.length === 0 && <Box css={styles.empty}>no match</Box>}
            </Box>
            <Box css={styles.foot} aria-hidden="true">
                <FontAwesomeIcon icon={faArrowUp} /><FontAwesomeIcon icon={faArrowDown} />
                <span>move · Enter chooses · Esc closes</span>
            </Box>
        </Box>
    );
});
