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
 * Under width pressure the strip never scrolls: it measures itself (the
 * rail's ladder) and folds its trailing tabs — the active one always
 * kept — into a `+n` menu that switches to the tab picked. At its floor
 * (the whole-sheet tab, the active tab, `+n`, `+ TAB`) it reports whether
 * it still overflows through {@link SheetTabsFoldContext}, and the toolbar
 * climbs its own ladder.
 */

import { memo, useContext, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { foldTabs } from "./lens.js";
import { SheetTabsFoldContext } from "./fold-context.js";

type Styles = Record<string, Record<string, unknown>>;

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
    const { styles, views, wholeCount, active, dirty, hasQuery, renaming, renameVal } = props;
    const menuStyles = useSlotRecipe({ key: "menu" })() as unknown as Styles;
    const dragging = useRef<string | null>(null);
    const renameRef = useRef<HTMLInputElement | null>(null);
    const skipBlur = useRef(false);
    useEffect(() => {
        if (renaming !== null && renameRef.current !== null) {
            renameRef.current.focus();
            renameRef.current.select();
        }
    }, [renaming]);

    // The fold ladder: when the strip overflows its box, one more tab folds
    // into the `+n` menu — synchronously, before paint, until it fits. A
    // width change re-measures; growth resets to nothing folded once the
    // width has settled (the rail's rule, so a resize never strobes). At
    // the floor the strip reports instead, and the toolbar's ladder takes
    // over; its `measureKey` moves per rung, so the strip measures again.
    const fold = useContext(SheetTabsFoldContext);
    const stripRef = useRef<HTMLDivElement | null>(null);
    const [folded, setFolded] = useState(0);
    // Bumped by the resize observer, so the measurement below re-runs on every width change.
    const [tick, bump] = useState(0);
    const maxFold = views.length - (views.some((v) => v.id === active) ? 1 : 0);
    useLayoutEffect(() => {
        const el = stripRef.current;
        if (el === null) return;
        const overflowing = el.scrollWidth > el.clientWidth + 1;
        if (overflowing && folded < maxFold) { setFolded((f) => Math.min(f + 1, maxFold)); return; }
        fold?.onOverflow(overflowing);
    }, [folded, maxFold, tick, fold]);
    useLayoutEffect(() => {
        const el = stripRef.current;
        if (el === null || typeof ResizeObserver === "undefined") return;
        let width = el.clientWidth;
        let settle: number | undefined;
        const ro = new ResizeObserver(() => {
            if (el.clientWidth === width) return;
            const grew = el.clientWidth > width;
            width = el.clientWidth;
            bump((n) => n + 1);
            if (!grew) return;
            if (settle !== undefined) window.clearTimeout(settle);
            settle = window.setTimeout(() => { settle = undefined; setFolded(0); bump((n) => n + 1); }, 200);
        });
        ro.observe(el);
        return () => { ro.disconnect(); if (settle !== undefined) window.clearTimeout(settle); };
    }, []);
    // The views changed (a tab added, closed, renamed): measure again from
    // nothing folded. Not on mount — the measure above runs there anyway, and
    // a reset would cancel its first fold before it could re-measure.
    const signature = views.map((v) => `${v.id}:${v.name}`).join("|");
    const seenSignature = useRef(signature);
    useLayoutEffect(() => {
        if (seenSignature.current === signature) return;
        seenSignature.current = signature;
        setFolded(0);
        bump((n) => n + 1);
    }, [signature]);
    const { visible, hidden } = foldTabs(views, active, folded);

    const onDragOver = (e: DragEvent) => e.preventDefault();
    const dropAt = (to: number) => (e: DragEvent) => {
        e.preventDefault();
        const id = dragging.current;
        dragging.current = null;
        if (id !== null) props.onReorder(id, to);
    };
    const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); skipBlur.current = true; props.onRenameCommit(); }
        if (e.key === "Escape") { e.preventDefault(); skipBlur.current = true; props.onRenameCancel(); }
    };
    const onRenameBlur = () => {
        if (skipBlur.current) { skipBlur.current = false; return; }
        props.onRenameCommit();
    };
    return (
        <Box ref={stripRef} css={styles.tabs} data-slot="tabs" data-folded={hidden.length > 0 ? hidden.length : undefined} role="tablist">
            <Box
                as="span"
                css={styles.tab}
                data-slot="tab"
                data-tab="all"
                data-active={active === null ? "" : undefined}
                role="tab"
                aria-selected={active === null}
                title="Every row — the whole sheet"
                onMouseDown={(e: MouseEvent) => { if (e.button !== 0) return; e.preventDefault(); props.onSwitch(null); }}
                onDragOver={onDragOver}
                onDrop={dropAt(0)}
            >
                All
                <Box as="span" css={styles.tabCount} data-slot="tabCount">{wholeCount}</Box>
            </Box>
            {visible.map((v) => {
                const on = active === v.id;
                const i = views.findIndex((x) => x.id === v.id);
                if (renaming === v.id) {
                    return (
                        <Box key={v.id} as="span" css={styles.tab} data-slot="tab" data-tab={v.id} data-active="" data-renaming="">
                            <chakra.input
                                ref={renameRef}
                                css={styles.tabRename}
                                data-slot="tabRename"
                                value={renameVal}
                                aria-label="Rename tab"
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
                        as="span"
                        css={styles.tab}
                        data-slot="tab"
                        data-tab={v.id}
                        data-active={on ? "" : undefined}
                        data-dirty={on && dirty ? "" : undefined}
                        role="tab"
                        aria-selected={on}
                        title={v.title}
                        draggable
                        onMouseDown={(e: MouseEvent) => { if (e.button !== 0 || on) return; e.preventDefault(); props.onSwitch(v.id); }}
                        onAuxClick={(e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); props.onClose(v.id); } }}
                        onDoubleClick={(e: MouseEvent) => { e.preventDefault(); props.onRenameStart(v.id); }}
                        onDragStart={() => { dragging.current = v.id; }}
                        onDragOver={onDragOver}
                        onDrop={dropAt(i)}
                    >
                        <Box as="span" css={styles.tabLabel} data-slot="tabLabel">{v.name}</Box>
                        <Box as="span" css={styles.tabCount} data-slot="tabCount">{v.count}</Box>
                        {on && dirty && (
                            <Box as="span" css={styles.tabDot} data-slot="tabDot" title="Unsaved query — ⏎ updates this tab · esc reverts" />
                        )}
                        <Box
                            as="span"
                            css={styles.tabClose}
                            data-slot="tabClose"
                            role="button"
                            aria-label={`Close ${v.name}`}
                            title="Close tab"
                            onMouseDown={(e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); props.onClose(v.id); }}
                        >
                            <FontAwesomeIcon icon={faXmark} />
                        </Box>
                    </Box>
                );
            })}
            {hidden.length > 0 && (
                <ChakraMenu.Root positioning={{ placement: "bottom-start" }} onSelect={(d) => props.onSwitch(d.value)}>
                    <ChakraMenu.Trigger asChild>
                        <Box as="span" css={styles.tabMore} data-slot="tabMore" role="button" aria-label={`${hidden.length} more views`} title="More views">
                            {`+${hidden.length}`}
                            <FontAwesomeIcon icon={faChevronDown} style={{ fontSize: "8px", opacity: 0.7 }} />
                        </Box>
                    </ChakraMenu.Trigger>
                    <Portal>
                        <ChakraMenu.Positioner>
                            <ChakraMenu.Content>
                                {hidden.map((v) => (
                                    <ChakraMenu.Item key={v.id} value={v.id} title={v.title}>
                                        {v.name}
                                        <Box as="span" css={menuStyles.itemCommand}>{v.count}</Box>
                                    </ChakraMenu.Item>
                                ))}
                            </ChakraMenu.Content>
                        </ChakraMenu.Positioner>
                    </Portal>
                </ChakraMenu.Root>
            )}
            <Box
                as="span"
                css={styles.tabAdd}
                data-slot="tabAdd"
                role="button"
                aria-label="New tab from this view"
                title={hasQuery ? "New tab from this search — query, context and expanded bands, evaluated live" : "New tab — no filter yet; search inside it and ⏎ to scope it"}
                onMouseDown={(e: MouseEvent) => { if (e.button !== 0) return; e.preventDefault(); props.onCreate(); }}
                onDragOver={onDragOver}
                onDrop={dropAt(views.length)}
            >
                <FontAwesomeIcon icon={faPlus} style={{ fontSize: "8px" }} />
                <Box as="span" data-slot="tabAddLabel">tab</Box>
            </Box>
        </Box>
    );
});
