/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraValueTree` — renderer for the editable value-driven tree
 * (#360).
 *
 * The factory materializes ANY East value into the fixed recursive node
 * IR (`ValueTree.Types.Node`); this renderer lists the expanded nodes as
 * flat rows through the shared ROW MODEL (`ValueTree.flatten` /
 * `ValueTree.flattenPaged` in `@elaraai/east-ui/internal`, #719 — the same
 * rows the terminal shows) and virtualizes them through the shared
 * {@link VirtualRows} frame (bounded when `style.height` / `maxHeight`
 * is set), with the expand-set and top visible row persisted per
 * `storageKey` — the Table discipline (#143).
 *
 * The surface is written for END USERS, not developers: struct field
 * names are humanized ("flowRate" → "Flow rate"), array elements carry
 * content-derived titles ("Press", not "[0]"), struct rows preview
 * their leaf values ("Press · 2.5 · Running"), options read "Not set"
 * with a Set/Clear affordance, and expanded collections end in an
 * "Add item" / "Add entry" ghost row. Editing is leaf-type-aware: leaves
 * mount the typed `forms/input` renderers (host-constructed decoded
 * payloads — the ClauseBuilder trick), booleans a Checkbox, variant tags
 * the shared Select. Every edit reports a typed path through the
 * payload's `onEdit` / `onInsert` / `onRemove` / `onTag` callbacks —
 * the host owns the data and re-materializes. Without callbacks the
 * tree is a read-only inspector. Arrow keys walk the rows (Right/Left
 * expand/collapse, Enter/Space toggle) with roving tab index.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Box, Skeleton, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight, faMinus, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { equalFor, some, none, variant, type ValueTypeOf } from "@elaraai/east";
import {
    ValueTree,
    flattenRows,
    flattenPaged,
    pageOfFlat,
    pagedFlatIndexOfRoot,
    flatIndexOfRoot,
    pagedRowAt,
    humanize,
    fmtLeaf,
    DEFAULT_OPEN_DEPTH,
    type RowModel,
    type ValueTreePagedRow,
    type ValueTreePaging,
} from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { usePersistedState } from "../../hooks/usePersistedState";
import { VirtualRows } from "../virtual-rows.js";
import { parseCssSize } from "../../style/parse-size.js";
import {
    EastChakraStringInput,
    EastChakraIntegerInput,
    EastChakraFloatInput,
    EastChakraDateTimeInput,
} from "../../forms/input/index.js";
import { EastChakraCheckbox } from "../../forms/checkbox/index.js";
import { EastChakraSelect } from "../../forms/select/index.js";

// The paging contract and its row shape live with the row model in
// `@elaraai/east-ui` (#719); re-exported here so `e3-ui-components`
// (`PagedDatasetPreview`, `DatasetPreview`) keeps importing them from the
// renderer package unchanged.
export type { ValueTreePagedRow, ValueTreePaging };

const valueTreeEqual = equalFor(ValueTree.Types.Root);

/** East ValueTree payload value type. */
export type ValueTreeValue = ValueTypeOf<typeof ValueTree.Types.Root>;

/** East ValueTree node value type. */
export type ValueTreeNodeValue = ValueTypeOf<typeof ValueTree.Types.Node>;

/** East ValueTree path step value type. */
export type ValueTreeStepValue = ValueTypeOf<typeof ValueTree.Types.Step>;

/** East ValueTree leaf value type. */
export type ValueTreeLeafValue = ValueTypeOf<typeof ValueTree.Types.Leaf>;

export interface EastChakraValueTreeProps {
    value: ValueTreeValue;
    storageKey: string;
    /** Remote paging for a collection root — see {@link ValueTreePaging}. */
    paging?: ValueTreePaging | undefined;
    /** Controlled jump for an inline (non-paged) collection root: on each
     *  change to a defined value, scrolls the given root row (index among
     *  the root's children) into view and highlights it until the value
     *  clears back to `undefined`. Paged trees take the jump through
     *  {@link ValueTreePaging.scrollToRow} instead (#520). */
    scrollToRow?: number | undefined;
}

type SlotStyles = Record<string, SystemStyleObject>;

/** Exact row height (px) — rows are fixed-height lines (the recipe pins
 *  `height`), so the virtualizer positions rows at exact multiples without
 *  per-row measurement (#533) and scroll math is exact. */
const ROW_H = 32;
/** Indent per depth level (px). */
const INDENT = 18;
/** Context rows kept above a jumped-to row. */
const JUMP_CONTEXT_ROWS = 2;

interface ValueTreePersisted {
    open: Record<string, boolean>;
    topRow: number;
    /** Collapse-all / expand-all override of the payload's `openDepth`
     *  (0 = everything collapsed; large = everything expanded). */
    baseDepth?: number;
}

/** Row callbacks decoded from the payload (undefined ⇒ read-only). */
interface TreeCallbacks {
    onEdit?: ((path: ValueTreeStepValue[], leaf: ValueTreeLeafValue) => unknown) | undefined;
    onInsert?: ((path: ValueTreeStepValue[]) => unknown) | undefined;
    onRemove?: ((path: ValueTreeStepValue[]) => unknown) | undefined;
    onTag?: ((path: ValueTreeStepValue[], tag: string) => unknown) | undefined;
}

/** Opt-in paged-mode debug logging (#497) — silent unless
 *  `localStorage['e3-paging-debug']` is set (and not 'off'). */
function pagedDebug(...args: unknown[]): void {
    try {
        if (typeof localStorage === "undefined") return;
        const flag = localStorage.getItem("e3-paging-debug");
        if (flag === null || flag === "off") return;
    } catch {
        return;
    }
    console.info("[e3-paging:tree]", ...args);
}

// Editors are the compact `xs` size — tree rows are dense lines, not
// standalone form fields.
const smInputStyle = some({ size: some(variant("xs", null)) });

/** Fabricate a decoded `Select` payload for the shared select renderer —
 *  the ClauseBuilder trick (decoded-value shape, JS callbacks). */
function tagSelectValue(tag: string, tags: string[], onChange: (t: string) => void): never {
    return {
        value: some(tag),
        items: tags.map(t => ({ value: t, label: humanize(t), disabled: none })),
        placeholder: none,
        multiple: none,
        disabled: none,
        onChange: some(onChange),
        onChangeMultiple: none,
        onOpenChange: none,
        style: smInputStyle,
    } as never;
}

function LeafEditor({ leaf, path, onEdit }: {
    leaf: ValueTreeLeafValue;
    path: ValueTreeStepValue[];
    onEdit: NonNullable<TreeCallbacks["onEdit"]>;
}): ReactNode {
    switch (leaf.type) {
        case "string":
            return <EastChakraStringInput value={{
                value: leaf.value,
                onChange: some((v: string) => { void onEdit(path, variant("string", v)); }),
                style: smInputStyle,
            } as never} />;
        case "integer":
            return <EastChakraIntegerInput value={{
                value: leaf.value,
                onChange: some((v: bigint) => { void onEdit(path, variant("integer", v)); }),
                style: smInputStyle,
            } as never} />;
        case "float":
            return <EastChakraFloatInput value={{
                value: leaf.value,
                onChange: some((v: number) => { void onEdit(path, variant("float", v)); }),
                style: smInputStyle,
            } as never} />;
        case "datetime":
            return <EastChakraDateTimeInput value={{
                value: leaf.value,
                onChange: some((v: Date) => { void onEdit(path, variant("datetime", v)); }),
                style: smInputStyle,
            } as never} />;
        case "boolean":
            return <EastChakraCheckbox value={{
                checked: leaf.value,
                onChange: some((v: boolean) => { void onEdit(path, variant("boolean", v)); }),
            } as never} />;
        default:
            return null;
    }
}

/** The add-entry affordance for dict append rows — the new key is entered
 *  in place (Enter commits as a trailing `key` step, Escape cancels). */
function DictAdd({ path, styles, onInsert }: {
    path: ValueTreeStepValue[];
    styles: SlotStyles;
    onInsert: NonNullable<TreeCallbacks["onInsert"]>;
}): ReactNode {
    const [keyText, setKeyText] = useState<string | undefined>(undefined);
    if (keyText === undefined) {
        return (
            <chakra.button type="button" css={styles["append"]} aria-label="Add entry"
                onClick={() => setKeyText("")}>
                <FontAwesomeIcon icon={faPlus} /> Add entry
            </chakra.button>
        );
    }
    return (
        <chakra.input
            css={styles["keyInput"]}
            autoFocus
            value={keyText}
            placeholder="name"
            aria-label="New entry key"
            onChange={(e) => setKeyText(e.target.value)}
            onBlur={() => setKeyText(undefined)}
            onKeyDown={(e) => {
                if (e.key === "Enter" && keyText !== "") {
                    void onInsert([...path, variant("key", keyText)]);
                    setKeyText(undefined);
                } else if (e.key === "Escape") {
                    setKeyText(undefined);
                }
            }}
        />
    );
}

function Row({ row, styles, cbs, tabbable, matched, onToggle, onKeyNav, onFocusRow }: {
    row: RowModel;
    styles: SlotStyles;
    cbs: TreeCallbacks;
    tabbable: boolean;
    /** Transient jump-target highlight (#520). */
    matched: boolean;
    onToggle: (id: string, expanded: boolean, deep?: boolean) => void;
    onKeyNav: (rowId: string, key: string) => boolean;
    onFocusRow: (rowId: string) => void;
}): ReactNode {
    const { onEdit, onInsert, onRemove, onTag } = cbs;
    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
        // Never hijack keys typed inside editors / selects on the row.
        if (e.target !== e.currentTarget) return;
        if (onKeyNav(row.id, e.key)) e.preventDefault();
    };
    // Append ghost row — the collection's add affordance, indented with
    // its children.
    if ((row.kind === "appendArray" || row.kind === "appendDict") && onInsert !== undefined) {
        return (
            <Box css={styles["row"]} data-part="row" data-row-id={row.id}
                role="treeitem" aria-level={row.depth + 1}
                tabIndex={tabbable ? 0 : -1}
                onKeyDown={handleKeyDown}
                onFocus={(e) => { if (e.target === e.currentTarget) onFocusRow(row.id); }}
                style={{ paddingLeft: `${12 + row.depth * INDENT}px` }}>
                <Box css={styles["twist"]} visibility="hidden" aria-hidden="true" />
                {row.kind === "appendArray" ? (
                    <chakra.button type="button" css={styles["append"]} aria-label={row.label}
                        onClick={() => { void onInsert([...row.path, variant("append", null)]); }}>
                        <FontAwesomeIcon icon={faPlus} /> {row.label}
                    </chakra.button>
                ) : (
                    <DictAdd path={row.path} styles={styles} onInsert={onInsert} />
                )}
            </Box>
        );
    }
    // The variant tag lives in the VALUE CELL: a select when editable,
    // plain text when read-only — same position either way (and a null
    // payload's redundant value is dropped).
    const tagText = row.variantCtl !== undefined && onTag === undefined
        ? <Box as="span" css={styles["summary"]}>{humanize(row.variantCtl.tag)}</Box>
        : null;
    const tagSelect = row.variantCtl !== undefined && onTag !== undefined
        ? (() => {
            const ctl = row.variantCtl;
            return (
                <Box css={styles["tagWrap"]}>
                    <EastChakraSelect
                        ariaLabel="Variant tag"
                        value={tagSelectValue(ctl.tag, ctl.tags, (t) => {
                            if (t !== ctl.tag) void onTag(ctl.path, t);
                        })}
                    />
                </Box>
            );
        })()
        : null;
    let valueCell: ReactNode;
    if (row.kind === "leaf" && row.leaf !== undefined) {
        valueCell = onEdit !== undefined && row.leaf.type !== "null"
            ? <LeafEditor leaf={row.leaf} path={row.path} onEdit={onEdit} />
            : ((tagText !== null || tagSelect !== null) && row.leaf.type === "null"
                ? null
                : <Box as="span" css={styles["valueText"]}>{fmtLeaf(row.leaf)}</Box>);
    } else if (row.kind === "opaque") {
        valueCell = <Box as="span" css={styles["opaque"]} title={row.opaque}>{row.opaque}</Box>;
    } else {
        valueCell = row.summary !== undefined && row.summary !== ""
            ? <Box as="span" css={styles["summary"]}>{row.summary}</Box>
            : null;
    }
    return (
        <Box
            css={styles["row"]}
            data-part="row"
            data-row-id={row.id}
            {...(matched && { "data-match": "" })}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-posinset={row.posinset}
            aria-setsize={row.setsize}
            aria-expanded={row.expandable ? row.expanded : undefined}
            tabIndex={tabbable ? 0 : -1}
            onKeyDown={handleKeyDown}
            onFocus={(e) => { if (e.target === e.currentTarget) onFocusRow(row.id); }}
            style={{ paddingLeft: `${12 + row.depth * INDENT}px` }}
        >
            {row.expandable ? (
                <chakra.button
                    type="button"
                    css={styles["twist"]}
                    tabIndex={-1}
                    aria-label={row.expanded ? "Collapse" : "Expand"}
                    title={row.expanded ? "Collapse (Alt: entire subtree)" : "Expand"}
                    onClick={(e) => onToggle(row.id, !row.expanded, e.altKey)}
                >
                    <FontAwesomeIcon icon={row.expanded ? faChevronDown : faChevronRight} />
                </chakra.button>
            ) : (
                <Box css={styles["twist"]} visibility="hidden" aria-hidden="true" />
            )}
            <Box as="span" css={styles["label"]} title={row.label}>{row.label}</Box>
            <Box css={styles["value"]} data-leaf={row.leaf?.type}>{tagText}{tagSelect}{valueCell}</Box>
            <Box css={styles["controls"]}>
                {row.optionCtl !== undefined && onTag !== undefined && (() => {
                    const ctl = row.optionCtl;
                    return ctl.isSome ? (
                        <chakra.button type="button" css={styles["ctl"]}
                            aria-label="Clear value"
                            onClick={() => { void onTag(ctl.path, "none"); }}>
                            <FontAwesomeIcon icon={faMinus} />
                        </chakra.button>
                    ) : (
                        <chakra.button type="button" css={styles["setBtn"]}
                            aria-label="Set value"
                            onClick={() => { void onTag(ctl.path, "some"); }}>
                            Set
                        </chakra.button>
                    );
                })()}
                {row.removable && onRemove !== undefined && (
                    <chakra.button type="button" css={styles["ctl"]} aria-label="Remove"
                        onClick={() => { void onRemove(row.ownPath); }}>
                        <FontAwesomeIcon icon={faXmark} />
                    </chakra.button>
                )}
            </Box>
        </Box>
    );
}

/**
 * Renders an East UI ValueTree value — the editable value-driven tree.
 *
 * @param props - component props
 * @param props.value - the decoded `ValueTree.Types.Root` payload
 * @param props.storageKey - persistence scope for the expand-set + scroll
 * @returns the ValueTree element
 */
export const EastChakraValueTree = memo(function EastChakraValueTree(
    { value, storageKey, paging, scrollToRow }: EastChakraValueTreeProps,
): ReactNode {
    const recipe = useSlotRecipe({ key: "valueTree" });
    const styles = recipe() as SlotStyles;

    const cbs = useMemo<TreeCallbacks>(() => ({
        onEdit: getSomeorUndefined(value.onEdit) as TreeCallbacks["onEdit"],
        onInsert: getSomeorUndefined(value.onInsert) as TreeCallbacks["onInsert"],
        onRemove: getSomeorUndefined(value.onRemove) as TreeCallbacks["onRemove"],
        onTag: getSomeorUndefined(value.onTag) as TreeCallbacks["onTag"],
    }), [value.onEdit, value.onInsert, value.onRemove, value.onTag]);

    const { state: persisted, setState: setPersisted } = usePersistedState<ValueTreePersisted>(
        storageKey, { open: {}, topRow: 0 },
    );

    const style = getSomeorUndefined(value.style);
    // Style fields are read defensively: host-constructed payloads (decoded
    // shapes built in TS) may predate a field.
    const styleOpenDepth = style !== undefined && style.openDepth !== undefined
        ? getSomeorUndefined(style.openDepth) : undefined;
    const showToolbar = (style !== undefined && style.toolbar !== undefined
        ? getSomeorUndefined(style.toolbar) : undefined) === true;
    // Collapse-all / expand-all override → payload openDepth → default.
    const openDepth = persisted.baseDepth
        ?? (styleOpenDepth !== undefined ? Number(styleOpenDepth) : DEFAULT_OPEN_DEPTH);

    const pagedFlat = useMemo(
        () => {
            if (paging === undefined) return undefined;
            const flat = flattenPaged(paging, persisted.open, openDepth);
            pagedDebug(`flatten: totalRows=${paging.totalRows} pageSize=${paging.pageSize} totalFlat=${flat.totalFlat} loaded=[${[...flat.pageModels.entries()].map(([p, m]) => `p${p}:${m.length}`).join(' ')}]`);
            return flat;
        },
        [paging, persisted.open, openDepth],
    );
    const rows = useMemo(
        () => (pagedFlat !== undefined
            ? pagedFlat.loadedRows
            : flattenRows(value.root, persisted.open, openDepth, cbs.onRemove !== undefined, cbs.onInsert !== undefined)),
        [pagedFlat, value.root, persisted.open, openDepth, cbs.onRemove, cbs.onInsert],
    );
    const rowCount = pagedFlat !== undefined ? pagedFlat.totalFlat : rows.length;

    const onToggle = useCallback((id: string, expanded: boolean, deep = false) => {
        setPersisted(prev => {
            if (!deep || expanded) {
                return { ...prev, open: { ...prev.open, [id]: expanded } };
            }
            // Deep collapse (Alt-click): close the row AND every currently
            // rendered descendant, so re-expanding shows a collapsed subtree.
            const open = { ...prev.open, [id]: false };
            const idx = rows.findIndex(r => r.id === id);
            if (idx >= 0) {
                const rootDepth = rows[idx]!.depth;
                for (let i = idx + 1; i < rows.length && rows[i]!.depth > rootDepth; i++) {
                    if (rows[i]!.expandable) open[rows[i]!.id] = false;
                }
            }
            return { ...prev, open };
        });
    }, [setPersisted, rows]);

    const collapseAll = useCallback(() => {
        setPersisted(prev => ({ ...prev, open: {}, baseDepth: 0 }));
    }, [setPersisted]);
    const expandAll = useCallback(() => {
        setPersisted(prev => ({ ...prev, open: {}, baseDepth: Number.MAX_SAFE_INTEGER }));
    }, [setPersisted]);

    // Roving tab index + arrow-key traversal (transient, not persisted).
    const rootElRef = useRef<HTMLDivElement | null>(null);
    const [focusId, setFocusId] = useState<string | undefined>(undefined);
    const onFocusRow = useCallback((rowId: string) => { setFocusId(rowId); }, []);
    const focusRowEl = useCallback((rowId: string) => {
        setFocusId(rowId);
        // Attribute-value escape (CSS.escape is missing in some DOM envs).
        const escaped = rowId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const el = rootElRef.current?.querySelector<HTMLElement>(
            `[data-row-id="${escaped}"]`);
        el?.focus();
    }, []);
    const onKeyNav = useCallback((rowId: string, key: string): boolean => {
        const idx = rows.findIndex(r => r.id === rowId);
        if (idx < 0) return false;
        const row = rows[idx]!;
        switch (key) {
            case "ArrowDown": {
                const next = rows[idx + 1];
                if (next !== undefined) focusRowEl(next.id);
                return true;
            }
            case "ArrowUp": {
                const prev = rows[idx - 1];
                if (prev !== undefined) focusRowEl(prev.id);
                return true;
            }
            case "ArrowRight": {
                if (row.expandable && !row.expanded) onToggle(row.id, true);
                else {
                    const next = rows[idx + 1];
                    if (next !== undefined) focusRowEl(next.id);
                }
                return true;
            }
            case "ArrowLeft": {
                if (row.expandable && row.expanded) onToggle(row.id, false);
                else if (row.parentId !== undefined) focusRowEl(row.parentId);
                return true;
            }
            case "Enter":
            case " ": {
                if (row.expandable) onToggle(row.id, !row.expanded);
                return true;
            }
            default:
                return false;
        }
    }, [rows, focusRowEl, onToggle]);

    // Scroll persistence — top visible ROW INDEX, never a pixel offset
    // (the Table rule: an index survives row-height changes; #143).
    const scrollElRef = useRef<HTMLDivElement | null>(null);
    const restoredRef = useRef(false);
    useLayoutEffect(() => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        const el = scrollElRef.current;
        if (el !== null && persisted.topRow > 0) el.scrollTop = persisted.topRow * ROW_H;
    }, [persisted.topRow]);

    // Paged mode: translate the visible flat window into a root-row range and
    // ask the host for it (the host dedupes). One page of margin each side so
    // scrolling never quite catches the placeholders.
    const requestVisibleRows = useCallback(() => {
        if (paging === undefined || pagedFlat === undefined || paging.totalRows === 0) return;
        const el = scrollElRef.current;
        const startFlat = el === null ? 0 : Math.max(0, Math.floor(el.scrollTop / ROW_H));
        const viewRows = el === null ? 60 : Math.ceil(el.clientHeight / ROW_H) + 1;
        const endFlat = Math.min(pagedFlat.totalFlat - 1, startFlat + viewRows);
        const firstPage = Math.max(0, pageOfFlat(pagedFlat.prefix, startFlat) - 1);
        const lastPage = Math.min(pagedFlat.pageCount - 1, pageOfFlat(pagedFlat.prefix, endFlat) + 1);
        pagedDebug(`visible: scrollTop=${el?.scrollTop ?? 'null'} clientH=${el?.clientHeight ?? 'null'} flat[${startFlat},${endFlat}] → pages ${firstPage}..${lastPage} → rows [${firstPage * paging.pageSize}, ${Math.min(paging.totalRows, (lastPage + 1) * paging.pageSize)})`);
        paging.onNeedRows(firstPage * paging.pageSize, Math.min(paging.totalRows, (lastPage + 1) * paging.pageSize));
    }, [paging, pagedFlat]);
    useLayoutEffect(() => {
        requestVisibleRows();
    }, [requestVisibleRows]);

    const onScroll = useCallback(() => {
        const el = scrollElRef.current;
        if (el === null) return;
        const topRow = Math.round(el.scrollTop / ROW_H);
        setPersisted(prev => (prev.topRow === topRow ? prev : { ...prev, topRow }));
        requestVisibleRows();
    }, [setPersisted, requestVisibleRows]);

    // Controlled jump (#520): on each change of the target root row, scroll
    // it into view (with a couple of context rows above), highlight it, and
    // request the destination window — an unloaded target self-loads
    // through the ordinary paging path. The highlight HOLDS until the host
    // clears the target (search cleared, dataset changed); page loads
    // re-running the effect no-op on the jumpedRef guard, and clearing
    // resets the guard so re-jumping the same row works.
    const jumpTarget = paging !== undefined ? paging.scrollToRow : scrollToRow;
    const [matchRow, setMatchRow] = useState<number | undefined>(undefined);
    const jumpedRef = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (jumpTarget === undefined) {
            if (jumpedRef.current !== undefined) {
                jumpedRef.current = undefined;
                setMatchRow(undefined);
            }
            return;
        }
        if (jumpTarget === jumpedRef.current) return;
        jumpedRef.current = jumpTarget;
        const flatIdx = pagedFlat !== undefined && paging !== undefined
            ? pagedFlatIndexOfRoot(pagedFlat, paging, jumpTarget)
            : flatIndexOfRoot(rows, jumpTarget);
        const el = scrollElRef.current;
        if (el !== null && flatIdx !== undefined) {
            el.scrollTop = Math.max(0, (flatIdx - JUMP_CONTEXT_ROWS) * ROW_H);
        }
        requestVisibleRows();
        setMatchRow(jumpTarget);
    }, [jumpTarget, pagedFlat, paging, rows, requestVisibleRows]);

    const height = style !== undefined ? getSomeorUndefined(style.height) : undefined;
    const maxHeight = style !== undefined ? getSomeorUndefined(style.maxHeight) : undefined;

    if (rowCount === 0) {
        return (
            <Box css={styles["root"]} role="tree">
                <Box css={styles["empty"]}>No values</Box>
            </Box>
        );
    }
    const tabbableId = focusId !== undefined && rows.some(r => r.id === focusId)
        ? focusId
        : rows[0]?.id;
    // The sized flex-column WRAPPER takes the component's bound and the frame
    // fills the remainder (`fillParent`) — otherwise a percentage / `fill`
    // height would resolve against the auto-height wrapper and silently unbind,
    // leaving every row rendered instead of the visible window.
    // `width: 100%`: the virtualized rows are absolutely positioned, so the
    // wrapper has NO intrinsic width — in a shrink-to-fit context (flex/grid
    // centering) it would collapse to the scrollbar gutter.
    const heightCss = parseCssSize(height);
    const maxHeightCss = parseCssSize(maxHeight);
    const frameFills = heightCss !== undefined || maxHeightCss !== undefined;
    // Sticky in bounded mode via the VirtualRows header slot.
    const toolbar = showToolbar ? (
        <Box css={styles["toolbar"]}>
            <chakra.button type="button" css={styles["toolbarBtn"]} onClick={collapseAll}>
                Collapse all
            </chakra.button>
            <chakra.button type="button" css={styles["toolbarBtn"]} onClick={expandAll}>
                Expand all
            </chakra.button>
        </Box>
    ) : undefined;
    return (
        <Box
            role="tree"
            aria-label="Value tree"
            ref={rootElRef}
            {...(frameFills && {
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                width: "100%",
                height: heightCss,
                maxHeight: maxHeightCss,
            })}
        >
            <VirtualRows
                height={frameFills ? undefined : height}
                maxHeight={frameFills ? undefined : maxHeight}
                fillParent={frameFills}
                header={toolbar}
                count={rowCount}
                estimateSize={() => ROW_H}
                measureRows={false}
                overscan={8}
                rootCss={styles["root"] as Record<string, unknown>}
                scrollElRef={scrollElRef}
                onScroll={onScroll}
                renderRow={(i) => {
                    let row: RowModel | undefined;
                    if (pagedFlat !== undefined && paging !== undefined) {
                        const at = pagedRowAt(pagedFlat, paging, i);
                        if (at.kind === "placeholder") {
                            // Unloaded rows render as whole-row skeletons —
                            // the same loading language as the Table.
                            return (
                                <Box css={styles["row"]} data-part="row" data-placeholder-row={at.globalRow}
                                    {...(at.globalRow === matchRow && { "data-match": "" })}
                                    role="treeitem" aria-level={1} aria-posinset={at.globalRow + 1}
                                    aria-setsize={paging.totalRows} aria-busy="true"
                                    style={{ paddingLeft: "12px" }}>
                                    <Box css={styles["twist"]} visibility="hidden" aria-hidden="true" />
                                    <Skeleton height="14px" flex="0 1 160px" />
                                    <Skeleton height="14px" flex="0 1 90px" opacity={0.6} />
                                </Box>
                            );
                        }
                        row = at.row;
                    } else {
                        row = rows[i];
                    }
                    if (row === undefined) return null;
                    return (
                        <Row key={row.id} row={row} styles={styles} cbs={cbs}
                            tabbable={row.id === tabbableId}
                            matched={matchRow !== undefined && row.depth === 0 && row.posinset - 1 === matchRow}
                            onToggle={onToggle} onKeyNav={onKeyNav} onFocusRow={onFocusRow} />
                    );
                }}
            />
        </Box>
    );
}, (prev, next) => valueTreeEqual(prev.value, next.value) && prev.storageKey === next.storageKey && prev.paging === next.paging && prev.scrollToRow === next.scrollToRow);
