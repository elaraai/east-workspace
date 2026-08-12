/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraValueTree` — renderer for the editable value-driven tree
 * (#360).
 *
 * The factory materializes ANY East value into the fixed recursive node
 * IR (`ValueTree.Types.Node`); this renderer flattens the expanded nodes
 * into flat rows and virtualizes them through the shared
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
import { ValueTree } from "@elaraai/east-ui/internal";
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

const valueTreeEqual = equalFor(ValueTree.Types.Root);

/** East ValueTree payload value type. */
export type ValueTreeValue = ValueTypeOf<typeof ValueTree.Types.Root>;

/** East ValueTree node value type. */
export type ValueTreeNodeValue = ValueTypeOf<typeof ValueTree.Types.Node>;

/** East ValueTree path step value type. */
export type ValueTreeStepValue = ValueTypeOf<typeof ValueTree.Types.Step>;

/** East ValueTree leaf value type. */
export type ValueTreeLeafValue = ValueTypeOf<typeof ValueTree.Types.Leaf>;

/** One pageable root row supplied by a paging host: its materialized node,
 *  the row's own path step (global index / dict key), and optionally a
 *  display label (derived from content when omitted). */
export interface ValueTreePagedRow {
    node: ValueTreeNodeValue;
    step: ValueTreeStepValue;
    label?: string | undefined;
}

/**
 * Remote-paging contract for a collection-rooted tree.
 *
 * When set, the tree's root rows come from `pages` instead of the payload's
 * root node: the virtualizer spans all `totalRows` (the scrollbar covers the
 * whole collection), unloaded rows render as placeholders, and scrolling
 * requests the windows that come into view via `onNeedRows`. Loaded rows
 * expand and edit exactly like ordinary rows — their path steps are global,
 * so edit callbacks stay correct. The host owns fetching and deduping;
 * replace the `pages` map (new identity) as pages arrive.
 */
export interface ValueTreePaging {
    /** Total root rows in the full collection. */
    totalRows: number;
    /** Rows per page — keys of `pages` are `floor(row / pageSize)`. */
    pageSize: number;
    /** Loaded pages by page index (the final page may be shorter). */
    pages: ReadonlyMap<number, readonly ValueTreePagedRow[]>;
    /** Requests loading of the pages covering rows `[startRow, endRow)`. */
    onNeedRows: (startRow: number, endRow: number) => void;
    /** Controlled jump: on each change to a defined value, the tree scrolls
     *  this global root row into view, highlights it, and requests the
     *  destination window through {@link onNeedRows} — so an unloaded
     *  target self-loads. The highlight holds until this clears back to
     *  `undefined` (#520). */
    scrollToRow?: number | undefined;
}

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
/** Rows at depth < this start expanded when the payload sets no
 *  `style.openDepth` (per-row toggles and the toolbar override it). */
const DEFAULT_OPEN_DEPTH = 1;
/** Indent per depth level (px). */
const INDENT = 18;
/** Context rows kept above a jumped-to row. */
const JUMP_CONTEXT_ROWS = 2;
/** Leaf preview parts a struct row surfaces. */
const PREVIEW_PARTS = 3;

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

interface RowModel {
    id: string;
    parentId: string | undefined;
    depth: number;
    label: string;
    kind: "leaf" | "opaque" | "struct" | "array" | "dict" | "emptyOption" | "appendArray" | "appendDict";
    leaf: ValueTreeLeafValue | undefined;
    opaque: string | undefined;
    /** Muted value-cell text for branches (preview / counts / "Not set"). */
    summary: string | undefined;
    /** Path to the resolved node — the edit / insert target. */
    path: ValueTreeStepValue[];
    /** Path of the row's own binding step — the remove target. */
    ownPath: ValueTreeStepValue[];
    variantCtl: { path: ValueTreeStepValue[]; tag: string; tags: string[] } | undefined;
    optionCtl: { path: ValueTreeStepValue[]; isSome: boolean } | undefined;
    removable: boolean;
    expandable: boolean;
    expanded: boolean;
    /** 1-based position among rendered siblings (aria-posinset). */
    posinset: number;
    /** Rendered sibling count (aria-setsize). */
    setsize: number;
}

function pathKey(steps: ValueTreeStepValue[]): string {
    let out = "";
    for (const s of steps) {
        if (s.type === "field") out += `.${s.value}`;
        else if (s.type === "index") out += `[${s.value}]`;
        else if (s.type === "key") out += `{${s.value}}`;
        else if (s.type === "some") out += "?";
        else out += "!";
    }
    return out === "" ? "$" : out;
}

/** "flowRate" / "flow_rate" → "Flow rate" — end-user field labels.
 *  Dict keys are user data and stay verbatim. */
function humanize(name: string): string {
    const spaced = name
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .trim();
    if (spaced === "") return name;
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

interface ResolvedNode {
    kind: RowModel["kind"];
    leaf: ValueTreeLeafValue | undefined;
    opaque: string | undefined;
    node: ValueTreeNodeValue;
    path: ValueTreeStepValue[];
    variantCtl: RowModel["variantCtl"];
    optionCtl: RowModel["optionCtl"];
}

/** Collapses option / variant wrappers into row controls, leaving the
 *  content node the row displays (or `emptyOption` for a none). */
function resolveNode(raw: ValueTreeNodeValue, rawPath: ValueTreeStepValue[]): ResolvedNode {
    let node = raw;
    let path = rawPath;
    let variantCtl: RowModel["variantCtl"];
    let optionCtl: RowModel["optionCtl"];
    for (;;) {
        if (node.type === "option") {
            const inner = getSomeorUndefined(node.value.value);
            if (optionCtl === undefined) optionCtl = { path, isSome: inner !== undefined };
            if (inner === undefined) {
                return { kind: "emptyOption", leaf: undefined, opaque: undefined, node, path, variantCtl, optionCtl };
            }
            path = [...path, variant("some", null)];
            node = inner;
            continue;
        }
        if (node.type === "variant") {
            if (variantCtl === undefined) {
                variantCtl = { path, tag: node.value.tag, tags: [...node.value.tags] };
            }
            path = [...path, variant("tag", null)];
            node = node.value.value;
            continue;
        }
        break;
    }
    const kind: RowModel["kind"] =
        node.type === "leaf" ? "leaf"
        : node.type === "opaque" ? "opaque"
        : node.type === "struct" ? "struct"
        : node.type === "array" ? "array"
        : "dict";
    return {
        kind,
        leaf: node.type === "leaf" ? node.value : undefined,
        opaque: node.type === "opaque" ? node.value : undefined,
        node, path, variantCtl, optionCtl,
    };
}

/** Unwraps option/variant wrappers to the content node (display only). */
function contentOf(node: ValueTreeNodeValue): ValueTreeNodeValue {
    for (;;) {
        if (node.type === "option") {
            const inner = getSomeorUndefined(node.value.value);
            if (inner === undefined) return node;
            node = inner;
            continue;
        }
        if (node.type === "variant") {
            node = node.value.value;
            continue;
        }
        return node;
    }
}

function fmtLeaf(leaf: ValueTreeLeafValue): string {
    switch (leaf.type) {
        case "string": return leaf.value;
        case "integer": return String(leaf.value);
        case "float": return String(leaf.value);
        case "boolean": return leaf.value ? "true" : "false";
        case "datetime": return leaf.value.toISOString().replace("T", " ").slice(0, 19);
        default: return "—";
    }
}

/** One short preview token for a struct field's value, or undefined. */
function previewPart(node: ValueTreeNodeValue): string | undefined {
    for (;;) {
        if (node.type === "option") {
            const inner = getSomeorUndefined(node.value.value);
            if (inner === undefined) return undefined;
            node = inner;
            continue;
        }
        break;
    }
    if (node.type === "variant") return humanize(node.value.tag);
    if (node.type === "leaf") {
        if (node.value.type === "null") return undefined;
        const text = fmtLeaf(node.value);
        return text === "" ? undefined : text;
    }
    return undefined;
}

/** The muted value-cell text for a resolved branch node. */
function summaryOf(node: ValueTreeNodeValue): string {
    if (node.type === "struct") {
        const parts: string[] = [];
        for (const f of node.value.fields) {
            const part = previewPart(f.node);
            if (part !== undefined) parts.push(part);
            if (parts.length >= PREVIEW_PARTS) break;
        }
        if (parts.length > 0) return parts.join(" · ");
        const n = node.value.fields.length;
        return n === 0 ? "Empty" : n === 1 ? "1 field" : `${n} fields`;
    }
    if (node.type === "array") {
        const n = node.value.items.length;
        return n === 0 ? "Empty" : n === 1 ? "1 item" : `${n} items`;
    }
    if (node.type === "dict") {
        const n = node.value.entries.length;
        return n === 0 ? "Empty" : n === 1 ? "1 entry" : `${n} entries`;
    }
    return "";
}

/** A content-derived title for an array element — its first non-empty
 *  string leaf (fields searched in order), else "Item N". */
function itemTitle(node: ValueTreeNodeValue, index: number): string {
    const content = contentOf(node);
    if (content.type === "struct") {
        for (const f of content.value.fields) {
            const c = contentOf(f.node);
            if (c.type === "leaf" && c.value.type === "string" && c.value.value !== "") {
                return c.value.value;
            }
        }
    }
    return `Item ${index + 1}`;
}

interface ChildEntry {
    label: string;
    node: ValueTreeNodeValue;
    step: ValueTreeStepValue;
}

function childrenOf(node: ValueTreeNodeValue): ChildEntry[] {
    if (node.type === "struct") {
        return node.value.fields.map(f => ({ label: humanize(f.name), node: f.node, step: variant("field", f.name) }));
    }
    if (node.type === "array") {
        return node.value.items.map((n, i) => ({ label: itemTitle(n, i), node: n, step: variant("index", BigInt(i)) }));
    }
    if (node.type === "dict") {
        // `label` is display, `key` the round-trippable step text; the
        // fallback covers host-constructed node shapes that predate `label`.
        return node.value.entries.map(e => ({
            label: (e as { label?: string }).label ?? e.key,
            node: e.node,
            step: variant("key", e.key),
        }));
    }
    return [];
}

/** Shared flatten context: expansion state, edit capabilities, output. */
interface FlattenCtx {
    open: Record<string, boolean>;
    /** Rows at depth < this start expanded (per-row `open` overrides). */
    openDepth: number;
    canRemove: boolean;
    canInsert: boolean;
    rows: RowModel[];
}

function appendRowModel(
    parentId: string | undefined,
    containerPath: ValueTreeStepValue[],
    kind: "appendArray" | "appendDict",
    depth: number,
    posinset: number,
    setsize: number,
): RowModel {
    return {
        id: `${parentId ?? "$"}/$append`,
        parentId, depth,
        label: kind === "appendArray" ? "Add item" : "Add entry",
        kind,
        leaf: undefined, opaque: undefined, summary: undefined,
        path: containerPath, ownPath: containerPath,
        variantCtl: undefined, optionCtl: undefined,
        removable: false, expandable: false, expanded: false,
        posinset, setsize,
    };
}

/** Flattens one node's visible subtree, depth-first, into `ctx.rows`. */
function visitNode(
    ctx: FlattenCtx,
    label: string,
    raw: ValueTreeNodeValue,
    rawPath: ValueTreeStepValue[],
    parentId: string | undefined,
    depth: number,
    removable: boolean,
    posinset: number,
    setsize: number,
): void {
    const r = resolveNode(raw, rawPath);
    const id = pathKey(rawPath);
    const kids = childrenOf(r.node);
    const insertable = ctx.canInsert && (
        r.kind === "array" ||
        (r.kind === "dict" && r.node.type === "dict" && r.node.value.editable)
    );
    const expandable = kids.length > 0 || insertable;
    const expanded = expandable && (ctx.open[id] ?? depth < ctx.openDepth);
    let summary = r.kind === "emptyOption" ? "Not set"
        : (r.kind === "struct" || r.kind === "array" || r.kind === "dict") ? summaryOf(r.node)
        : undefined;
    // A content-derived item title already IS the first preview part —
    // don't repeat it beside itself.
    if (summary !== undefined && summary !== label && summary.startsWith(`${label} · `)) {
        summary = summary.slice(label.length + 3);
    } else if (summary === label) {
        summary = undefined;
    }
    ctx.rows.push({
        id, parentId, depth, label,
        kind: r.kind, leaf: r.leaf, opaque: r.opaque, summary,
        path: r.path, ownPath: rawPath,
        variantCtl: r.variantCtl, optionCtl: r.optionCtl,
        removable, expandable, expanded,
        posinset, setsize,
    });
    if (expanded) {
        const kidsRemovable = ctx.canRemove && (
            r.kind === "array" ||
            (r.kind === "dict" && r.node.type === "dict" && r.node.value.editable)
        );
        const total = kids.length + (insertable ? 1 : 0);
        kids.forEach((k, i) => {
            visitNode(ctx, k.label, k.node, [...r.path, k.step], id, depth + 1, kidsRemovable, i + 1, total);
        });
        if (insertable) {
            ctx.rows.push(appendRowModel(
                id, r.path,
                r.kind === "array" ? "appendArray" : "appendDict",
                depth + 1, total, total,
            ));
        }
    }
}

/** Flattens the visible (expanded) rows of the tree, depth-first.
 *  Expanded editable collections end in an append ghost row. */
function flattenRows(
    root: ValueTreeNodeValue,
    open: Record<string, boolean>,
    openDepth: number,
    canRemove: boolean,
    canInsert: boolean,
): RowModel[] {
    const ctx: FlattenCtx = { open, openDepth, canRemove, canInsert, rows: [] };
    const visit = (
        label: string,
        raw: ValueTreeNodeValue,
        rawPath: ValueTreeStepValue[],
        parentId: string | undefined,
        depth: number,
        removable: boolean,
        posinset: number,
        setsize: number,
    ): void => visitNode(ctx, label, raw, rawPath, parentId, depth, removable, posinset, setsize);
    const rows = ctx.rows;
    const appendRow = (
        parentId: string | undefined,
        containerPath: ValueTreeStepValue[],
        kind: "appendArray" | "appendDict",
        depth: number,
        posinset: number,
        setsize: number,
    ): RowModel => appendRowModel(parentId, containerPath, kind, depth, posinset, setsize);
    // A compound root lists its children directly (no synthetic top row);
    // anything else is a single row. A root collection appends a trailing
    // add ghost row.
    if (root.type === "struct" || root.type === "array" || root.type === "dict") {
        const rootInsertable = canInsert && (
            root.type === "array" || (root.type === "dict" && root.value.editable)
        );
        const kidsRemovable = canRemove && (
            root.type === "array" || (root.type === "dict" && root.value.editable)
        );
        const kids = childrenOf(root);
        const total = kids.length + (rootInsertable ? 1 : 0);
        kids.forEach((k, i) => {
            visit(k.label, k.node, [k.step], undefined, 0, kidsRemovable, i + 1, total);
        });
        if (rootInsertable) {
            rows.push(appendRow(
                undefined, [],
                root.type === "array" ? "appendArray" : "appendDict",
                0, total, total,
            ));
        }
    } else {
        visit("Value", root, [], undefined, 0, false, 1, 1);
    }
    return rows;
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

/** Paged-mode flat structure: per-page flattened row models, prefix sums
 *  mapping virtual indexes to pages, and the loaded rows in order for
 *  keyboard traversal. Unloaded root rows contribute one placeholder row
 *  each, so the virtualizer's extent always spans the whole collection. */
interface PagedFlat {
    totalFlat: number;
    /** `prefix[p]` = flat rows before page `p` (length `pageCount + 1`). */
    prefix: number[];
    pageModels: Map<number, RowModel[]>;
    loadedRows: RowModel[];
    pageCount: number;
    /** Root rows page `p` covers (the final page may be shorter). */
    rootRowsInPage: (p: number) => number;
}

function flattenPaged(
    paging: ValueTreePaging,
    open: Record<string, boolean>,
    openDepth: number,
): PagedFlat {
    const { totalRows, pageSize, pages } = paging;
    const pageCount = Math.max(0, Math.ceil(totalRows / pageSize));
    const rootRowsInPage = (p: number): number =>
        Math.max(0, Math.min(pageSize, totalRows - p * pageSize));
    const pageModels = new Map<number, RowModel[]>();
    const loadedRows: RowModel[] = [];
    const prefix: number[] = new Array(pageCount + 1);
    prefix[0] = 0;
    for (let p = 0; p < pageCount; p++) {
        const loaded = pages.get(p);
        if (loaded === undefined) {
            prefix[p + 1] = prefix[p]! + rootRowsInPage(p);
            continue;
        }
        // Paged roots are read-only at the row level (no append ghost, no
        // row removal) — leaf edits inside a loaded row still work through
        // the ordinary callbacks, with global path steps.
        const ctx: FlattenCtx = { open, openDepth, canRemove: false, canInsert: false, rows: [] };
        loaded.forEach((r, i) => {
            const globalRow = p * pageSize + i;
            const label = r.label ?? itemTitle(r.node, globalRow);
            visitNode(ctx, label, r.node, [r.step], undefined, 0, false, globalRow + 1, totalRows);
        });
        pageModels.set(p, ctx.rows);
        loadedRows.push(...ctx.rows);
        prefix[p + 1] = prefix[p]! + ctx.rows.length;
    }
    return { totalFlat: prefix[pageCount] ?? 0, prefix, pageModels, loadedRows, pageCount, rootRowsInPage };
}

/** Binary-searches the page whose flat range contains `flatIdx`. */
function pageOfFlat(prefix: number[], flatIdx: number): number {
    let lo = 0, hi = prefix.length - 2;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (prefix[mid + 1]! <= flatIdx) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** Flat index of global root row `globalRow`: through the loaded page's
 *  flattened models when present (expanded children shift later rows),
 *  else the one-placeholder-per-root arithmetic. */
function pagedFlatIndexOfRoot(flat: PagedFlat, paging: ValueTreePaging, globalRow: number): number | undefined {
    if (paging.totalRows === 0) return undefined;
    const clamped = Math.max(0, Math.min(paging.totalRows - 1, globalRow));
    const p = Math.floor(clamped / paging.pageSize);
    const base = flat.prefix[p];
    if (base === undefined) return undefined;
    const offsetInPage = clamped - p * paging.pageSize;
    const models = flat.pageModels.get(p);
    if (models === undefined) return base + offsetInPage;
    let roots = 0;
    for (let i = 0; i < models.length; i++) {
        if (models[i]!.depth === 0) {
            if (roots === offsetInPage) return base + i;
            roots++;
        }
    }
    return undefined;
}

/** Flat index of the `rootRow`-th depth-0 row of an inline tree. */
function flatIndexOfRoot(rows: RowModel[], rootRow: number): number | undefined {
    let roots = 0;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i]!.depth === 0) {
            if (roots === rootRow) return i;
            roots++;
        }
    }
    return undefined;
}

/** Resolves a paged virtual row: a loaded model, or the global root index
 *  of a placeholder. */
function pagedRowAt(flat: PagedFlat, paging: ValueTreePaging, flatIdx: number):
    | { kind: "model"; row: RowModel }
    | { kind: "placeholder"; globalRow: number } {
    const p = pageOfFlat(flat.prefix, flatIdx);
    const offsetInPage = flatIdx - flat.prefix[p]!;
    const models = flat.pageModels.get(p);
    if (models !== undefined) {
        return { kind: "model", row: models[offsetInPage]! };
    }
    return { kind: "placeholder", globalRow: p * paging.pageSize + offsetInPage };
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
