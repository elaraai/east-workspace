/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The view tabs (B§8, `Sheet Spec.md` §5 row 17): the pinned whole-sheet
 * tab with the planned count, one tab per saved view with its live match
 * count, the dirty dot when the slice's narrowing has drifted from the
 * active view's, × (hover neg) and middle-click to close, double-click to
 * rename, drag to reorder, and `+ TAB` to snapshot the current view. The
 * tabs are chrome over the machine: every gesture is an event, every
 * change to the views leaves as `emit.views`.
 *
 * The tabs are a WAI-ARIA tablist (#860), one tab stop on the active tab:
 * ← / → move between the tabs and Home / End to the first and last, Enter
 * or Space switches to the one focused, Delete closes it and F2 renames it —
 * and a rename or a close by the keyboard leaves the focus on a tab. `+n`
 * and `+ TAB` are buttons beside the tablist; a tab's × is the pointer's,
 * and Delete is the keyboard's.
 *
 * Under width pressure the strip never scrolls. The toolbar folds it, as
 * forms of its one ladder (#952): its trailing tabs fold — the active one
 * always kept — into a `+n` menu that switches to the tab picked; then, as
 * the row needs, the strip drops its `+ TAB` label and the whole-sheet
 * count, caps its names, and closes up; last (#1221), it folds into one
 * chip — the open view's tab with a caret — whose menu holds every view,
 * `+ TAB` and the open view's close ({@link SheetTabsFold}). Renaming and
 * reordering wait for a row with room for the tabs.
 */

import { memo, useEffect, useLayoutEffect, useRef, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { foldTabs } from "./lens.js";
import { useSheetWords } from "./words.js";

type Styles = Record<string, Record<string, unknown>>;

/** The whole-sheet tab's key among the tabs. */
const ALL = "all";

/** The folded strip's menu items (#1221): a view's value is its id after this prefix, so none is taken for another item. */
const MENU_VIEW = "view:";
/** The menu's `+ TAB`. */
const MENU_NEW = "+new";
/** The menu's close of the open view. */
const MENU_CLOSE = "+close";

/** The strip's form, as the toolbar folds it (#952). */
export interface SheetTabsFold {
    /** How many trailing tabs fold into the `+n` menu — the active tab never does. */
    folded: number;
    /** Past its fold, how far the strip closes up: `compact` drops the
     *  `+ TAB` label and the whole-sheet count, `capped` caps the tab names
     *  at 72px as well, `closed` closes the gaps and drops every count; and
     *  `menu` (#1221) folds it into one chip, the open view's, whose menu
     *  holds every view, `+ TAB` and the open view's close. */
    strip?: "compact" | "capped" | "closed" | "menu" | undefined;
}

/** One tab's facts. */
export interface SheetTabView {
    id: string;
    name: string;
    /** Rows the view's narrowing matches, live. */
    count: number;
    /** The hover title — the query, the context, the gestures. */
    title: string;
}

export interface SheetTabsProps {
    styles: Styles;
    views: readonly SheetTabView[];
    /** The pinned whole-sheet tab's count — the planned rows. */
    wholeCount: number;
    /** The active view's id; `null` = the whole sheet. */
    active: string | null;
    /** The active view's narrowing differs from the slice's. */
    dirty: boolean;
    /** Whether a query is set — the `+ TAB` title. */
    hasQuery: boolean;
    renaming: string | null;
    renameVal: string;
    /** The element the tabs switch — the sheet's grid (`aria-controls`). */
    panelId?: string | undefined;
    /** The strip's form, as the toolbar folds it — nothing folded by default. */
    fold?: SheetTabsFold | undefined;
    onSwitch: (id: string | null) => void;
    onCreate: () => void;
    onClose: (id: string) => void;
    onRenameStart: (id: string) => void;
    onRenameChange: (val: string) => void;
    onRenameCommit: () => void;
    onRenameCancel: () => void;
    onReorder: (id: string, to: number) => void;
}

/** Renders the tab strip. */
export const SheetTabs = memo(function SheetTabs(props: SheetTabsProps) {
    const { styles, views, wholeCount, active, dirty, hasQuery, renaming, renameVal, panelId, fold } = props;
    const menuStyles = useSlotRecipe({ key: "menu" })() as unknown as Styles;
    // The tabs' words and counts, in the app's locale (#850, #861).
    const words = useSheetWords();
    const { m } = words;
    const dragging = useRef<string | null>(null);
    const renameRef = useRef<HTMLInputElement | null>(null);
    const skipBlur = useRef(false);
    useEffect(() => {
        if (renaming !== null && renameRef.current !== null) {
            renameRef.current.focus();
            renameRef.current.select();
        }
    }, [renaming]);

    // The fold the toolbar chose: the trailing tabs in the `+n` menu (#952).
    const { visible, hidden } = foldTabs(views, active, fold?.folded ?? 0);

    // The tablist's keys (#860). The tabs in order, the whole sheet first; the
    // one tab stop is the active tab.
    const tabEls = useRef(new Map<string, HTMLElement>());
    const tabRef = (key: string) => (el: HTMLElement | null) => {
        if (el !== null) tabEls.current.set(key, el);
        else tabEls.current.delete(key);
    };
    const order = [ALL, ...visible.map((v) => v.id)];
    const current = active ?? ALL;
    // A tab the focus goes to once the tabs have drawn — after a rename or a
    // close by the keyboard; the whole-sheet tab when that one is gone.
    const focusNext = useRef<string | undefined>(undefined);
    useLayoutEffect(() => {
        const key = focusNext.current;
        if (key === undefined || renaming !== null) return;
        focusNext.current = undefined;
        (tabEls.current.get(key) ?? tabEls.current.get(ALL))?.focus();
    });
    const onTabKey = (key: string) => (e: KeyboardEvent<HTMLElement>) => {
        const i = order.indexOf(key);
        const n = order.length;
        let to: string | undefined;
        switch (e.key) {
            case "ArrowRight": to = order[(i + 1) % n]; break;
            case "ArrowLeft": to = order[(i - 1 + n) % n]; break;
            case "Home": to = order[0]; break;
            case "End": to = order[n - 1]; break;
            case "Enter":
            case " ":
                if (key !== current) props.onSwitch(key === ALL ? null : key);
                break;
            case "Delete":
                if (key === ALL) return;
                focusNext.current = order[i + 1] ?? order[i - 1];
                props.onClose(key);
                break;
            case "F2":
                if (key === ALL) return;
                props.onRenameStart(key);
                break;
            default:
                return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (to !== undefined) tabEls.current.get(to)?.focus();
    };

    const onDragOver = (e: DragEvent) => e.preventDefault();
    const dropAt = (to: number) => (e: DragEvent) => {
        e.preventDefault();
        const id = dragging.current;
        dragging.current = null;
        if (id !== null) props.onReorder(id, to);
    };
    const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        // Ended by the keyboard, the focus goes back to the tab.
        if (e.key === "Enter") { e.preventDefault(); skipBlur.current = true; focusNext.current = renaming ?? undefined; props.onRenameCommit(); }
        if (e.key === "Escape") { e.preventDefault(); skipBlur.current = true; focusNext.current = renaming ?? undefined; props.onRenameCancel(); }
    };
    const onRenameBlur = () => {
        if (skipBlur.current) { skipBlur.current = false; return; }
        props.onRenameCommit();
    };

    // Folded into one chip (#1221): the open view's tab and a caret, its menu
    // every view, `+ TAB` and the open view's close.
    if (fold?.strip === "menu") {
        const open = active === null ? undefined : views.find((v) => v.id === active);
        const name = open?.name ?? m.tabAll();
        return (
            <Box css={styles.tabs} data-slot="tabs" data-strip="menu">
                <ChakraMenu.Root positioning={{ placement: "bottom-start" }} onSelect={(d) => {
                    if (d.value === MENU_NEW) props.onCreate();
                    else if (d.value === MENU_CLOSE) { if (active !== null) props.onClose(active); }
                    else props.onSwitch(d.value.startsWith(MENU_VIEW) ? d.value.slice(MENU_VIEW.length) : null);
                }}>
                    <ChakraMenu.Trigger asChild>
                        <chakra.button type="button" css={styles.tabMenu} data-slot="tabMenu" data-tab={active ?? ALL}
                            aria-label={m.tabMenuName({ name })} title={m.tabMenuTitle()}>
                            <Box as="span" css={styles.tabLabel} data-slot="tabLabel">{name}</Box>
                            {open !== undefined && dirty && <Box as="span" css={styles.tabDot} data-slot="tabDot" title={m.tabDirty()} />}
                            <FontAwesomeIcon icon={faChevronDown} data-slot="tabMenuCaret" />
                        </chakra.button>
                    </ChakraMenu.Trigger>
                    <Portal>
                        <ChakraMenu.Positioner>
                            <ChakraMenu.Content>
                                <ChakraMenu.Item value={ALL} title={m.tabAllTitle()}>
                                    {m.tabAll()}
                                    <Box as="span" css={menuStyles.itemCommand}>{words.number(wholeCount)}</Box>
                                </ChakraMenu.Item>
                                {views.map((v) => (
                                    <ChakraMenu.Item key={v.id} value={`${MENU_VIEW}${v.id}`} title={v.title}>
                                        {v.name}
                                        <Box as="span" css={menuStyles.itemCommand}>{words.number(v.count)}</Box>
                                    </ChakraMenu.Item>
                                ))}
                                <ChakraMenu.Separator />
                                <ChakraMenu.Item value={MENU_NEW} title={m.tabAddTitle({ query: hasQuery })}>{m.tabAddName()}</ChakraMenu.Item>
                                {open !== undefined && <ChakraMenu.Item value={MENU_CLOSE}>{m.tabCloseView({ name: open.name })}</ChakraMenu.Item>}
                            </ChakraMenu.Content>
                        </ChakraMenu.Positioner>
                    </Portal>
                </ChakraMenu.Root>
            </Box>
        );
    }

    return (
        <Box css={styles.tabs} data-slot="tabs" data-folded={hidden.length > 0 ? hidden.length : undefined} data-strip={fold?.strip}>
            <Box css={styles.tabList} data-slot="tabList" role="tablist" aria-label={m.tabList()}>
                <Box
                    ref={tabRef(ALL)}
                    as="span"
                    css={styles.tab}
                    data-slot="tab"
                    data-tab="all"
                    data-active={active === null ? "" : undefined}
                    role="tab"
                    aria-selected={active === null}
                    aria-controls={panelId}
                    tabIndex={current === ALL ? 0 : -1}
                    title={m.tabAllTitle()}
                    onMouseDown={(e: MouseEvent) => { if (e.button !== 0) return; e.preventDefault(); props.onSwitch(null); }}
                    onKeyDown={onTabKey(ALL)}
                    onDragOver={onDragOver}
                    onDrop={dropAt(0)}
                >
                    {m.tabAll()}
                    <Box as="span" css={styles.tabCount} data-slot="tabCount">{words.number(wholeCount)}</Box>
                </Box>
                {visible.map((v) => {
                    const on = active === v.id;
                    const i = views.findIndex((x) => x.id === v.id);
                    if (renaming === v.id) {
                        return (
                            <Box key={v.id} as="span" css={styles.tab} data-slot="tab" data-tab={v.id} data-active="" data-renaming="" role="tab" aria-selected={on}>
                                <chakra.input
                                    ref={renameRef}
                                    css={styles.tabRename}
                                    data-slot="tabRename"
                                    value={renameVal}
                                    aria-label={m.tabRename()}
                                    onChange={(e) => props.onRenameChange(e.target.value)}
                                    onKeyDown={onRenameKey}
                                    onBlur={onRenameBlur}
                                />
                            </Box>
                        );
                    }
                    return (
                        <Box
                            key={v.id}
                            ref={tabRef(v.id)}
                            as="span"
                            css={styles.tab}
                            data-slot="tab"
                            data-tab={v.id}
                            data-active={on ? "" : undefined}
                            data-dirty={on && dirty ? "" : undefined}
                            role="tab"
                            aria-selected={on}
                            aria-controls={panelId}
                            tabIndex={current === v.id ? 0 : -1}
                            title={v.title}
                            draggable
                            onMouseDown={(e: MouseEvent) => { if (e.button !== 0 || on) return; e.preventDefault(); props.onSwitch(v.id); }}
                            onKeyDown={onTabKey(v.id)}
                            onAuxClick={(e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); props.onClose(v.id); } }}
                            onDoubleClick={(e: MouseEvent) => { e.preventDefault(); props.onRenameStart(v.id); }}
                            onDragStart={() => { dragging.current = v.id; }}
                            onDragOver={onDragOver}
                            onDrop={dropAt(i)}
                        >
                            <Box as="span" css={styles.tabLabel} data-slot="tabLabel">{v.name}</Box>
                            <Box as="span" css={styles.tabCount} data-slot="tabCount">{words.number(v.count)}</Box>
                            {on && dirty && (
                                <Box as="span" css={styles.tabDot} data-slot="tabDot" title={m.tabDirty()} />
                            )}
                            {/* The pointer's close; the keyboard's is Delete on the tab. */}
                            <Box
                                as="span"
                                css={styles.tabClose}
                                data-slot="tabClose"
                                aria-hidden="true"
                                title={m.tabClose()}
                                onMouseDown={(e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); props.onClose(v.id); }}
                            >
                                <FontAwesomeIcon icon={faXmark} />
                            </Box>
                        </Box>
                    );
                })}
            </Box>
            {hidden.length > 0 && (
                <ChakraMenu.Root positioning={{ placement: "bottom-start" }} onSelect={(d) => props.onSwitch(d.value)}>
                    <ChakraMenu.Trigger asChild>
                        <chakra.button type="button" css={styles.tabMore} data-slot="tabMore"
                            aria-label={m.tabMoreName({ n: hidden.length, count: words.number(hidden.length) })} title={m.tabMoreTitle()}>
                            {m.tabMore({ n: hidden.length, count: words.number(hidden.length) })}
                            <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: "8px", opacity: 0.7 }} />
                        </chakra.button>
                    </ChakraMenu.Trigger>
                    <Portal>
                        <ChakraMenu.Positioner>
                            <ChakraMenu.Content>
                                {hidden.map((v) => (
                                    <ChakraMenu.Item key={v.id} value={v.id} title={v.title}>
                                        {v.name}
                                        <Box as="span" css={menuStyles.itemCommand}>{words.number(v.count)}</Box>
                                    </ChakraMenu.Item>
                                ))}
                            </ChakraMenu.Content>
                        </ChakraMenu.Positioner>
                    </Portal>
                </ChakraMenu.Root>
            )}
            <chakra.button
                type="button"
                css={styles.tabAdd}
                data-slot="tabAdd"
                aria-label={m.tabAddName()}
                title={m.tabAddTitle({ query: hasQuery })}
                onMouseDown={(e: MouseEvent) => { if (e.button !== 0) return; e.preventDefault(); props.onCreate(); }}
                // Enter or Space on the focused button: a click with no pointer behind it.
                onClick={(e: MouseEvent) => { if (e.detail === 0) props.onCreate(); }}
                onDragOver={onDragOver}
                onDrop={dropAt(views.length)}
            >
                <FontAwesomeIcon icon={faPlus} style={{ fontSize: "8px" }} />
                <Box as="span" data-slot="tabAddLabel">{m.tabAdd()}</Box>
            </chakra.button>
        </Box>
    );
});
