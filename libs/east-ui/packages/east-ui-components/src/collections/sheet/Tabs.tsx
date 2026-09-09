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
 */

import { memo, useEffect, useRef, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";

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
    const dragging = useRef<string | null>(null);
    const renameRef = useRef<HTMLInputElement | null>(null);
    const skipBlur = useRef(false);
    useEffect(() => {
        if (renaming !== null && renameRef.current !== null) {
            renameRef.current.focus();
            renameRef.current.select();
        }
    }, [renaming]);
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
        <Box css={styles.tabs} data-slot="tabs" role="tablist">
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
            {views.map((v, i) => {
                const on = active === v.id;
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
                        {v.name}
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
                tab
            </Box>
        </Box>
    );
});
