/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Chooser (#1322): a searchable, sectioned single-choice list — each option
 * with its line and its range, one that doesn't fit disabled with its reason —
 * driven by ↑↓ Enter Esc. A host lays it in a `SliceEditPopover` anchored
 * under a cell (`flush`), in a pane under a field (`surface="inline"`), or in a
 * body it frames itself (`surface="bare"`, #1673: no border, no foot, the
 * height the body leaves it down to its first three options); a short list
 * its host offers whole — a phone's steps — draws no search (`search={false}`).
 * Its sections and options are data, and the host runs the choice. It is the
 * one picker: the query builder's slots and a filter's condition rows draw it
 * too.
 *
 * - Search filters by each option's label and line (or its own `match`); a
 *   section left empty goes, and nothing left says `no match`. A host that
 *   filters the options itself — the query builder's, which offers what is
 *   typed as a value — gives the search's text and hears it change
 *   (`query`, `onQuery`), and the Chooser shows the options as given.
 * - ↑↓ cycle the options a choice can take — the current one and those that
 *   fit — Enter chooses the highlighted one, Esc closes; hovering one
 *   highlights it; typing puts the highlight back on the first. The highlight
 *   is held by the option's key, so a list given again as text is typed keeps
 *   it while the option is there. ⌘ or Ctrl Enter is the host's, never a
 *   choice; Tab chooses where the host asks. Told to take the focus
 *   (`autoFocus`), its search holds it by the end of the commit that draws
 *   it, so no key typed as its host draws it afresh is lost.
 * - Current wears a check, an option refused a × and its reason in the warning
 *   text; a disabled one (taken elsewhere) is only muted. An option's label is
 *   data in the mono face — an ID, a number — or words in the body face
 *   (`words`), and it may lead with its icon. Its label and its line are one
 *   line each, ended in an ellipsis where its host is too narrow for them —
 *   an inspector's pane — and each says its whole on hover; its range is
 *   never cut.
 *
 * It is a React part for renderers, as `BuilderFrame` is: no East component.
 *
 * @packageDocumentation
 */

import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faArrowDown, faArrowUp, faCheck, faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import { composingKey } from "../../editing/shortcuts.js";

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
    /** Its icon before its label: a Font Awesome solid icon (a step's, a saved query's). */
    icon?: IconProp | undefined;
    /** Its label reads as words — a field's name, a step — in the body face; an option's label is data by default. */
    words?: boolean | undefined;
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
    /**
     * Esc in the search box. In a popover the popover closes on Esc itself; this is for a Chooser laid in a pane. Given it,
     * the Chooser takes Esc itself and marks its root `data-escape-layer`, so a `BuilderFrame` overlay pane it lies in
     * leaves the key to it.
     */
    onClose?: (() => void) | undefined;
    /** Where it sits: in a popover (the default), laid in a pane with its own border, or bare in a body its host frames. */
    surface?: "popover" | "inline" | "bare";
    /** Whether the search box takes the focus as it mounts (a pane's; a popover gives it its own). */
    autoFocus?: boolean;
    /**
     * The search's text where the host filters the options itself: it gives the options for the text and is told each
     * change (`onQuery`), and the Chooser shows the options as given. Left out, the Chooser filters them.
     */
    query?: string | undefined;
    /** Told each change of the search's text, where the host filters the options. */
    onQuery?: ((text: string) => void) | undefined;
    /** The option highlighted as it opens, by its key; the first a choice can take when it is not one. */
    initialKey?: string | undefined;
    /** A label before the search, in the label voice: what the list is of (`FIELD`). */
    label?: string | undefined;
    /** Whether Tab chooses the highlighted option, as Enter does. */
    tabChooses?: boolean | undefined;
    /** What it says with nothing to offer; `no match` by default. */
    empty?: string | undefined;
    /** Where the options come from, said in its foot before the keys. */
    hint?: string | undefined;
    /** Whether it draws its search; a short list its host offers whole — a phone's steps (QP34) — has none. Drawn by default. */
    search?: boolean | undefined;
}

/** Whether a choice can take an option. */
const choosable = (o: ChooserOption): boolean => o.state === "enabled" || o.state === "current";

/** How many options a bare Chooser's list keeps in view, however little room its host's body leaves it. */
const FLOOR_OPTIONS = 3;

/**
 * The Chooser — a searchable, sectioned single-choice list (see the module docs).
 *
 * @param props - The sections and what a choice does
 * @returns The list, its search and its keys
 */
export const Chooser = memo(function Chooser({
    sections, placeholder, onChoose, onClose, surface = "popover", autoFocus, query, onQuery, initialKey, label, tabChooses = false, empty, hint, search = true,
}: ChooserProps) {
    const styles = useSlotRecipe({ key: "chooser" })({ surface });
    const listId = useId();
    const hosted = onQuery !== undefined;
    const [own, setOwn] = useState("");
    const text = hosted ? query ?? "" : own;
    // The highlighted option, by its key: `undefined` puts it on the first a choice can take.
    const [highlight, setHighlight] = useState<string | undefined>(initialKey);
    const inputRef = useRef<HTMLInputElement | null>(null);
    // Its search takes the focus in the commit that draws it, before the page hears another key: a host draws it afresh
    // as its offers arrive (the query builder's, by its key), the search that held the focus gone with the old one — and
    // a key pressed before the focus was given again, a digit of a number or its Enter, went to the page and was lost.
    useLayoutEffect(() => { if (autoFocus === true) inputRef.current?.focus({ preventScroll: true }); }, [autoFocus]);
    // The sections the search leaves — a host's own, as given — and the options a choice can take in order.
    const shown = useMemo(() => {
        if (hosted) return sections.filter((s) => s.options.length > 0);
        const q = text.trim().toLowerCase();
        const hit = (o: ChooserOption) => q === "" || (o.match ?? `${o.label} ${o.line ?? ""}`).toLowerCase().includes(q);
        return sections.map((s) => ({ label: s.label, options: s.options.filter(hit) })).filter((s) => s.options.length > 0);
    }, [sections, text, hosted]);
    const enabled = useMemo(() => shown.flatMap((s) => s.options.filter(choosable)), [shown]);
    const held = highlight === undefined ? -1 : enabled.findIndex((o) => o.key === highlight);
    const at = enabled.length === 0 ? -1 : held >= 0 ? held : 0;
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
        // A key that is an input method's — the Enter that confirms a conversion — chooses nothing.
        if (composingKey(event)) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const n = enabled.length;
            if (n > 0) setHighlight(enabled[((at < 0 ? 0 : at) + (event.key === "ArrowDown" ? 1 : n - 1)) % n]!.key);
        } else if (event.key === "Enter" || (event.key === "Tab" && tabChooses)) {
            // ⌘ or Ctrl Enter is the host's: a query builder runs its query on it.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            if (active !== undefined) onChoose(active.key);
        } else if (event.key === "Escape" && onClose !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        }
    };
    const type = (next: string) => {
        if (hosted) onQuery(next);
        else setOwn(next);
        setHighlight(undefined);
    };
    return (
        // Given `onClose`, it takes Esc itself, and says so: a frame's overlay pane it is laid in leaves the key to it.
        <Box css={styles.root} data-chooser="" data-surface={surface} data-escape-layer={onClose !== undefined ? "" : undefined}
            style={surface === "bare" ? { "--chooser-floor": Math.min(FLOOR_OPTIONS, shown.reduce((n, s) => n + s.options.length, 0)) } as CSSProperties : undefined}>
            {search && (
                <Box css={styles.search}>
                    {label !== undefined && <Box as="span" css={styles.searchLabel} data-chooser-label="">{label}</Box>}
                    <chakra.label css={styles.searchBox}>
                        <Box as="span" css={styles.searchIcon}><FontAwesomeIcon icon={faMagnifyingGlass} /></Box>
                        <chakra.input ref={inputRef} css={styles.searchInput} type="search" role="combobox" aria-expanded="true"
                            aria-autocomplete="list" aria-controls={listId} aria-activedescendant={active !== undefined ? optionId(active.key) : undefined}
                            autoComplete="off" spellCheck={false}
                            value={text} placeholder={placeholder} aria-label={label ?? placeholder}
                            onChange={(event) => type(event.currentTarget.value)} onKeyDown={onKeyDown} />
                    </chakra.label>
                </Box>
            )}
            <Box ref={listRef} css={styles.list} id={listId} role="listbox" aria-label={label ?? placeholder}>
                {shown.map((section, s) => (
                    <Box key={`${s}:${section.label}`} role="group" aria-label={section.label === "" ? undefined : section.label}>
                        {section.label !== "" && <Box css={styles.section} aria-hidden="true">{section.label}</Box>}
                        {section.options.map((o) => {
                            const can = choosable(o);
                            const index = can ? enabled.indexOf(o) : -1;
                            return (
                                <chakra.button key={o.key} type="button" tabIndex={-1} css={styles.option} id={optionId(o.key)}
                                    role="option" aria-selected={o.state === "current"} aria-disabled={!can} disabled={!can}
                                    data-state={o.state === "enabled" ? undefined : o.state} data-warn={o.warn === true ? "" : undefined}
                                    data-icon={o.icon !== undefined ? "" : undefined}
                                    data-highlighted={index >= 0 && index === at ? "" : undefined}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseEnter={() => { if (index >= 0 && index !== at) setHighlight(o.key); }}
                                    onClick={() => { if (can) onChoose(o.key); }}>
                                    <Box as="span" css={styles.mark}>
                                        {o.state === "current" && <FontAwesomeIcon icon={faCheck} aria-label="Current" />}
                                        {o.state === "refused" && <FontAwesomeIcon icon={faXmark} aria-label="Doesn't fit" />}
                                    </Box>
                                    {o.icon !== undefined && <Box as="span" css={styles.icon} aria-hidden="true" data-option-icon=""><FontAwesomeIcon icon={o.icon} /></Box>}
                                    <Box as="span" css={styles.text}>
                                        <Box as="span" css={styles.label} data-option-label="" data-words={o.words === true ? "" : undefined} title={o.label}>{o.label}</Box>
                                        {o.line !== undefined && <Box as="span" css={styles.line} data-option-line="" title={o.line}>{o.line}</Box>}
                                    </Box>
                                    <Box as="span" css={styles.range} data-option-range="">{o.range}</Box>
                                </chakra.button>
                            );
                        })}
                    </Box>
                ))}
                {shown.length === 0 && <Box css={styles.empty}>{empty ?? "no match"}</Box>}
            </Box>
            {surface !== "bare" && (
                <Box css={styles.foot} aria-hidden="true">
                    {hint !== undefined && <span data-chooser-hint="">{hint}</span>}
                    <FontAwesomeIcon icon={faArrowUp} /><FontAwesomeIcon icon={faArrowDown} />
                    <span>move · Enter chooses · Esc closes</span>
                </Box>
            )}
        </Box>
    );
});
