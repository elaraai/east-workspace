/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's one toolbar (#936), as the shared `Toolbar`'s items
 * (`Query Editor Spec.md` §4.1), folding on one ladder as Studio's toolbars
 * do: the history item (#935), **Copy jq**, which shows its check for a
 * moment after it copies and folds to its icon,
 * **Save…** (the save popover's trigger), and **Run**, the one primary
 * button, its shortcut in a `Kbd`, which folds away first, and "Running" with
 * a spinner while a run goes.
 *
 * **Visual · jq** is the Query tab's own ({@link viewToolbarItem}): the `seg`
 * strip Studio's canvas holds Desktop · Tablet in, at the top of the tab's
 * body, where a Library's band holds its search box, folding to its icons.
 * The result's controls are the results' own, in their band (#938).
 *
 * @packageDocumentation
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Button, Kbd, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCode, faCopy, faDiagramProject, faPlay } from "@fortawesome/free-solid-svg-icons";
import type { ToolbarItem } from "@elaraai/east-ui-components";
import type { QueryWords } from "./model/words.js";
import { Tip, type Styles } from "./parts.js";

/** A view of the query: its steps, or its jq. */
export type QueryView = "visual" | "jq";

/**
 * The fold order of the builder's own items, lowest first, as Studio's
 * canvas ranks its own: Run's keys go first, then Copy jq folds to its icon.
 * The history item folds after them all, at its own rank.
 */
const RANK_RUN_KEYS = 10;
const RANK_COPY = 20;

/** Visual · jq's fold in the Query tab's band: to its icons. */
const RANK_VIEW = 40;

/** How long Copy jq shows its check. */
export const COPIED_MS = 1600;

/** What the builder's toolbar holds. */
export interface QueryToolbarOptions {
    /** The history item (#935). */
    readonly history: ToolbarItem;
    /** The text Copy jq copies: the program, or the jq as typed in the jq view. */
    readonly copyText: () => string;
    /** The save popover, its trigger the toolbar's Save…. */
    readonly save: ReactNode;
    /** Whether the save popover is open: its item keeps its form. */
    readonly saving: boolean;
    /** Whether a run goes. */
    readonly running: boolean;
    /** Runs the query. */
    readonly onRun: () => void;
    /** The words. */
    readonly words: QueryWords;
    /** The `queryBuilder` recipe's styles. */
    readonly styles: Styles;
}

/** Copy jq: the program to the clipboard, and its check for a moment. */
function CopyJq({ copyText, label, done, iconOnly, styles }: {
    copyText: () => string; label: string; done: string; iconOnly: boolean; styles: Styles;
}) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const copy = () => {
        const text = copyText();
        if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) void navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    };
    const words = copied ? done : label;
    return (
        <Tip label={iconOnly ? words : ""}>
            <Button size="sm" variant="ghost" css={styles.copy} data-copied={copied ? "" : undefined} data-query-copy=""
                aria-label={iconOnly ? words : undefined} onClick={copy}>
                <FontAwesomeIcon icon={copied ? faCheck : faCopy} />{!iconOnly && words}
            </Button>
        </Tip>
    );
}

/** What the Query tab's band holds: Visual · jq. */
export interface ViewItemOptions {
    /** The view shown. */
    readonly view: QueryView;
    /** Shows a view. */
    readonly onView: (view: QueryView) => void;
    /** The words. */
    readonly words: QueryWords;
    /** The `queryBuilder` recipe's styles. */
    readonly styles: Styles;
    /** The `seg` recipe's styles. */
    readonly seg: Styles;
}

/**
 * Visual · jq, an item of the Query tab's band (`Query Editor Spec.md` §4.2):
 * the `seg` strip, folding to its icons.
 *
 * @param options - The view, what picking one does, the words and the styles ({@link ViewItemOptions})
 * @returns The item
 */
export function viewToolbarItem(options: ViewItemOptions): ToolbarItem {
    const { view, onView, words, styles, seg } = options;
    const m = words.messages;
    const views = (iconsOnly: boolean) => (
        <Box css={seg.root} role="group" aria-label={m.viewLabel()} data-query-view={view}>
            {(["visual", "jq"] as const).map((v) => {
                const pressed = v === view;
                const label = m.view({ view: v });
                return (
                    <chakra.button key={v} type="button" css={seg.item} data-state={pressed ? "on" : "off"} aria-pressed={pressed}
                        {...(iconsOnly ? { "aria-label": label, title: label } : {})} onClick={() => onView(v)}>
                        <Box as="span" css={styles.viewIcon} aria-hidden><FontAwesomeIcon icon={v === "visual" ? faDiagramProject : faCode} /></Box>
                        {!iconsOnly && <span>{label}</span>}
                    </chakra.button>
                );
            })}
        </Box>
    );
    return { key: "view", side: "start", forms: [views(false), views(true)], rank: RANK_VIEW, version: view };
}

/**
 * The builder's toolbar items — see the module docs.
 *
 * @param options - The history item, the result's controls, the save popover, the run, and the words ({@link QueryToolbarOptions})
 * @returns The items, in their order along the row
 */
export function queryToolbarItems(options: QueryToolbarOptions): ToolbarItem[] {
    const { history, copyText, save, saving, running, onRun, words, styles } = options;
    const m = words.messages;
    const run = (keys: boolean) => (
        <Tip label={m.runTip()}>
            <Button size="sm" variant="solid" loading={running} loadingText={m.running()} data-query-run="" onClick={onRun}>
                <FontAwesomeIcon icon={faPlay} />{m.run()}{keys && <Kbd>{m.runKeys()}</Kbd>}
            </Button>
        </Tip>
    );
    const copy = (iconOnly: boolean) => (
        <CopyJq copyText={copyText} label={m.copyJq()} done={m.copied()} iconOnly={iconOnly} styles={styles} />
    );
    return [
        history,
        { key: "copy", side: "end", forms: [copy(false), copy(true)], rank: RANK_COPY },
        { key: "save", side: "end", forms: [save], held: saving },
        { key: "run", side: "end", forms: [run(true), run(false)], rank: RANK_RUN_KEYS, version: running },
    ];
}
