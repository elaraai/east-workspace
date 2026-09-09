/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ValueTree ROW MODEL — renderer-agnostic row math over the materialized
 * node tree (#719).
 *
 * A `ValueTreeNodeValue` is a tree; every renderer shows it as a flat list of
 * one-line rows: the expanded nodes depth-first, each with an end-user label
 * (`humanize`d struct fields, content-derived array item titles, dict keys
 * verbatim), a muted summary for branches (`Press · 2.5 · Running`,
 * `3 items`, `Not set`), the typed path an edit reports, and the option /
 * variant controls collapsed into the row. `flattenRows` produces that list
 * for an inline value; `flattenPaged` produces it page by page for a
 * collection root whose rows arrive in windows, with one placeholder row per
 * unloaded root so the extent always spans the whole collection.
 *
 * This module has no DOM and no React: the browser renderer
 * (`east-ui-components`) and the terminal (`e3-ui-cli`) both consume it, so a
 * value reads identically in each — same labels, same summaries, same
 * `pathKey` identities, same expand semantics.
 *
 * @packageDocumentation
 */

import { some, variant } from "@elaraai/east";
import type { ValueTreeLeafValue, ValueTreeNodeValue, ValueTreeStepValue } from "./materialize.js";

/** Rows at depth < this start expanded when the host sets no `openDepth`
 *  (per-row toggles and the toolbar override it). */
export const DEFAULT_OPEN_DEPTH = 1;

/** Leaf preview parts a struct row's summary surfaces. */
export const PREVIEW_PARTS = 3;

/**
 * The kind of a flattened row.
 *
 * @remarks
 * `leaf` / `opaque` / `struct` / `array` / `dict` mirror the resolved node
 * kind (option and variant wrappers are collapsed into the row's controls);
 * `emptyOption` is a `none` option; `appendArray` / `appendDict` are the
 * "Add item" / "Add entry" ghost rows an expanded editable collection ends
 * in.
 */
export type RowKind = "leaf" | "opaque" | "struct" | "array" | "dict" | "emptyOption" | "appendArray" | "appendDict";

/**
 * One flattened row of a ValueTree.
 *
 * @property id - Stable row identity: the {@link pathKey} of the row's own
 *   (raw) path; append rows use `<parent>/$append`
 * @property parentId - The id of the row this row is nested under
 * @property depth - Nesting depth (0 = a root row)
 * @property label - End-user label (humanized field, item title, dict key)
 * @property kind - The row kind ({@link RowKind})
 * @property leaf - The primitive leaf value for `leaf` rows
 * @property opaque - The printed summary for `opaque` rows
 * @property summary - Muted value-cell text for branches (preview / counts / "Not set")
 * @property path - Path to the RESOLVED node — the edit / insert target
 * @property ownPath - Path of the row's own binding step — the remove target
 * @property variantCtl - Variant tag control (path, active tag, all tags), if the row wraps a variant
 * @property optionCtl - Option control (path, whether set), if the row wraps an option
 * @property removable - Whether the row may be removed from its container
 * @property expandable - Whether the row has children (or an append ghost)
 * @property expanded - Whether the row's children are currently listed
 * @property posinset - 1-based position among rendered siblings (aria-posinset)
 * @property setsize - Rendered sibling count (aria-setsize)
 */
export interface RowModel {
    id: string;
    parentId: string | undefined;
    depth: number;
    label: string;
    kind: RowKind;
    leaf: ValueTreeLeafValue | undefined;
    opaque: string | undefined;
    summary: string | undefined;
    path: ValueTreeStepValue[];
    ownPath: ValueTreeStepValue[];
    variantCtl: { path: ValueTreeStepValue[]; tag: string; tags: string[] } | undefined;
    optionCtl: { path: ValueTreeStepValue[]; isSome: boolean } | undefined;
    removable: boolean;
    expandable: boolean;
    expanded: boolean;
    posinset: number;
    setsize: number;
}

/**
 * One child of a compound node: its display label, its node and the path
 * step that binds it.
 *
 * @property label - Display label
 * @property node - The child node
 * @property step - The path step from the parent to this child
 */
export interface ChildEntry {
    label: string;
    node: ValueTreeNodeValue;
    step: ValueTreeStepValue;
}

/**
 * Shared flatten context: expansion state, edit capabilities, output.
 *
 * @property open - Per-row expansion overrides keyed by row id
 * @property openDepth - Rows at depth < this start expanded (per-row `open` overrides)
 * @property canRemove - Whether the host can remove elements / entries
 * @property canInsert - Whether the host can append elements / entries
 * @property rows - The output rows, appended in order
 */
export interface FlattenCtx {
    open: Record<string, boolean>;
    openDepth: number;
    canRemove: boolean;
    canInsert: boolean;
    rows: RowModel[];
}

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
 * root node: the extent spans all `totalRows` (a scrollbar covers the whole
 * collection), unloaded rows render as placeholders, and scrolling requests
 * the windows that come into view via `onNeedRows`. Loaded rows expand and
 * edit exactly like ordinary rows — their path steps are global, so edit
 * callbacks stay correct. The host owns fetching and deduping; replace the
 * `pages` map (new identity) as pages arrive.
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
    /** Controlled jump (browser renderer): on each change to a defined value
     *  the tree scrolls this global root row into view, highlights it, and
     *  requests the destination window through {@link onNeedRows}. The
     *  highlight holds until this clears back to `undefined` (#520). Kept
     *  optional so hosts without a controlled jump omit it. */
    scrollToRow?: number | undefined;
}

/**
 * Paged-mode flat structure: per-page flattened row models, prefix sums
 * mapping flat indexes to pages, and the loaded rows in order for keyboard
 * traversal. Unloaded root rows contribute one placeholder row each, so
 * the extent always spans the whole collection.
 *
 * @property totalFlat - Total flat rows (loaded models + placeholders)
 * @property prefix - `prefix[p]` = flat rows before page `p` (length `pageCount + 1`)
 * @property pageModels - Flattened rows of each loaded page
 * @property loadedRows - Every loaded row in flat order
 * @property pageCount - Number of pages in the collection
 * @property rootRowsInPage - Root rows page `p` covers (the final page may be shorter)
 */
export interface PagedFlat {
    totalFlat: number;
    prefix: number[];
    pageModels: Map<number, RowModel[]>;
    loadedRows: RowModel[];
    pageCount: number;
    rootRowsInPage: (p: number) => number;
}

/**
 * The stable text identity of a node path — the row id.
 *
 * @param steps - The path steps
 * @returns `.field`, `[index]`, `{key}`, `?` (some) and `!` (tag) joined; `$` for the root
 */
export function pathKey(steps: ValueTreeStepValue[]): string {
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

/**
 * "flowRate" / "flow_rate" → "Flow rate" — end-user field labels. Dict keys
 * are user data and stay verbatim.
 *
 * @param name - A struct field name
 * @returns The humanized label
 */
export function humanize(name: string): string {
    const spaced = name
        .replace(/[_-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .trim();
    if (spaced === "") return name;
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** The payload of an option node's value, or undefined for `none`. */
function optionInner(node: ValueTreeNodeValue & { type: "option" }): ValueTreeNodeValue | undefined {
    const v = node.value.value;
    return v.type === "some" ? v.value : undefined;
}

/**
 * A node with its option / variant wrappers collapsed into row controls.
 *
 * @property kind - The row kind of the content node
 * @property leaf - The leaf value, for leaves
 * @property opaque - The printed summary, for opaque nodes
 * @property node - The content node the row displays
 * @property path - The path to the content node
 * @property variantCtl - The outermost variant wrapper's control
 * @property optionCtl - The outermost option wrapper's control
 */
export interface ResolvedNode {
    kind: RowKind;
    leaf: ValueTreeLeafValue | undefined;
    opaque: string | undefined;
    node: ValueTreeNodeValue;
    path: ValueTreeStepValue[];
    variantCtl: RowModel["variantCtl"];
    optionCtl: RowModel["optionCtl"];
}

/**
 * Collapses option / variant wrappers into row controls, leaving the content
 * node the row displays (or `emptyOption` for a none).
 *
 * @param raw - The node as materialized
 * @param rawPath - The path to `raw`
 * @returns The resolved node
 */
export function resolveNode(raw: ValueTreeNodeValue, rawPath: ValueTreeStepValue[]): ResolvedNode {
    let node = raw;
    let path = rawPath;
    let variantCtl: RowModel["variantCtl"];
    let optionCtl: RowModel["optionCtl"];
    for (;;) {
        if (node.type === "option") {
            const inner = optionInner(node);
            if (optionCtl === undefined) optionCtl = { path, isSome: inner !== undefined };
            if (inner === undefined) {
                return { kind: "emptyOption", leaf: undefined, opaque: undefined, node, path, variantCtl, optionCtl };
            }
            path = [...path, some(null)];
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
    const kind: RowKind =
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

/**
 * Unwraps option / variant wrappers to the content node (display only).
 *
 * @param node - A node
 * @returns The innermost non-wrapper node (a `none` option stays as is)
 */
export function contentOf(node: ValueTreeNodeValue): ValueTreeNodeValue {
    for (;;) {
        if (node.type === "option") {
            const inner = optionInner(node);
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

/**
 * Formats a leaf for display.
 *
 * @param leaf - The leaf value
 * @returns Strings verbatim, numbers as printed, booleans as `true` / `false`,
 *   datetimes as `YYYY-MM-DD HH:MM:SS`, null as `—`
 */
export function fmtLeaf(leaf: ValueTreeLeafValue): string {
    switch (leaf.type) {
        case "string": return leaf.value;
        case "integer": return String(leaf.value);
        case "float": return String(leaf.value);
        case "boolean": return leaf.value ? "true" : "false";
        case "datetime": return leaf.value.toISOString().replace("T", " ").slice(0, 19);
        default: return "—";
    }
}

/**
 * One short preview token for a struct field's value, or undefined.
 *
 * @param node - The field's node
 * @returns The token (a variant's humanized tag, a non-empty leaf's text), or undefined
 */
export function previewPart(node: ValueTreeNodeValue): string | undefined {
    for (;;) {
        if (node.type === "option") {
            const inner = optionInner(node);
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

/**
 * The muted value-cell text for a resolved branch node.
 *
 * @param node - A resolved struct / array / dict node
 * @returns A ` · `-joined preview of the first leaf parts for structs (else
 *   `N fields`), `N items` for arrays, `N entries` for dicts, `Empty` when empty
 */
export function summaryOf(node: ValueTreeNodeValue): string {
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

/**
 * A content-derived title for an array element — its first non-empty string
 * leaf (fields searched in order), else "Item N".
 *
 * @param node - The element node
 * @param index - The element's 0-based index
 * @returns The title
 */
export function itemTitle(node: ValueTreeNodeValue, index: number): string {
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

/**
 * The children of a compound node with their labels and binding steps.
 *
 * @param node - A struct / array / dict node (anything else has no children)
 * @returns The child entries in display order
 */
export function childrenOf(node: ValueTreeNodeValue): ChildEntry[] {
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

/**
 * The "Add item" / "Add entry" ghost row an expanded editable collection
 * ends in.
 *
 * @param parentId - The collection row's id (undefined for a root collection)
 * @param containerPath - The collection's path — the insert target
 * @param kind - Array or dict append
 * @param depth - The ghost row's depth
 * @param posinset - Its 1-based sibling position
 * @param setsize - The sibling count
 * @returns The ghost row
 */
export function appendRowModel(
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

/**
 * Flattens one node's visible subtree, depth-first, into `ctx.rows`.
 *
 * @param ctx - The flatten context (expansion state, capabilities, output)
 * @param label - The row's label
 * @param raw - The node as materialized
 * @param rawPath - The path to `raw` (the row's own path)
 * @param parentId - The parent row's id
 * @param depth - The row's depth
 * @param removable - Whether the row may be removed from its container
 * @param posinset - Its 1-based sibling position
 * @param setsize - The sibling count
 */
export function visitNode(
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

/**
 * Flattens the visible (expanded) rows of an inline tree, depth-first. A
 * compound root lists its children directly (no synthetic top row); anything
 * else is a single `Value` row. Expanded editable collections end in an
 * append ghost row.
 *
 * @param root - The materialized root node
 * @param open - Per-row expansion overrides keyed by row id
 * @param openDepth - Rows at depth < this start expanded
 * @param canRemove - Whether the host can remove elements / entries
 * @param canInsert - Whether the host can append elements / entries
 * @returns The visible rows in order
 */
export function flattenRows(
    root: ValueTreeNodeValue,
    open: Record<string, boolean>,
    openDepth: number,
    canRemove: boolean,
    canInsert: boolean,
): RowModel[] {
    const ctx: FlattenCtx = { open, openDepth, canRemove, canInsert, rows: [] };
    const rows = ctx.rows;
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
            visitNode(ctx, k.label, k.node, [k.step], undefined, 0, kidsRemovable, i + 1, total);
        });
        if (rootInsertable) {
            rows.push(appendRowModel(
                undefined, [],
                root.type === "array" ? "appendArray" : "appendDict",
                0, total, total,
            ));
        }
    } else {
        visitNode(ctx, "Value", root, [], undefined, 0, false, 1, 1);
    }
    return rows;
}

/**
 * Flattens the loaded pages of a paged collection root. Paged roots are
 * read-only at the row level (no append ghost, no row removal) — leaf edits
 * inside a loaded row still work through the ordinary callbacks, with global
 * path steps.
 *
 * @param paging - The paging contract (totals, page size, loaded pages)
 * @param open - Per-row expansion overrides keyed by row id
 * @param openDepth - Rows at depth < this start expanded
 * @returns The paged flat structure
 */
export function flattenPaged(
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
    const prefix: number[] = new Array<number>(pageCount + 1);
    prefix[0] = 0;
    for (let p = 0; p < pageCount; p++) {
        const loaded = pages.get(p);
        if (loaded === undefined) {
            prefix[p + 1] = prefix[p]! + rootRowsInPage(p);
            continue;
        }
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

/**
 * Binary-searches the page whose flat range contains `flatIdx`.
 *
 * @param prefix - The prefix sums from {@link flattenPaged}
 * @param flatIdx - A flat row index
 * @returns The page index
 */
export function pageOfFlat(prefix: number[], flatIdx: number): number {
    let lo = 0, hi = prefix.length - 2;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (prefix[mid + 1]! <= flatIdx) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Flat index of global root row `globalRow`: through the loaded page's
 * flattened models when present (expanded children shift later rows), else
 * the one-placeholder-per-root arithmetic.
 *
 * @param flat - The paged flat structure
 * @param paging - The paging contract
 * @param globalRow - A global root row (clamped to the collection)
 * @returns The flat index, or undefined for an empty collection
 */
export function pagedFlatIndexOfRoot(flat: PagedFlat, paging: ValueTreePaging, globalRow: number): number | undefined {
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

/**
 * Flat index of the `rootRow`-th depth-0 row of an inline tree.
 *
 * @param rows - The flattened rows
 * @param rootRow - A 0-based root row ordinal
 * @returns The flat index, or undefined when there are fewer roots
 */
export function flatIndexOfRoot(rows: RowModel[], rootRow: number): number | undefined {
    let roots = 0;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i]!.depth === 0) {
            if (roots === rootRow) return i;
            roots++;
        }
    }
    return undefined;
}

/**
 * Resolves a paged flat row: a loaded model, or the global root index of a
 * placeholder.
 *
 * @param flat - The paged flat structure
 * @param paging - The paging contract
 * @param flatIdx - A flat row index
 * @returns The row model, or the placeholder's global root row
 */
export function pagedRowAt(flat: PagedFlat, paging: ValueTreePaging, flatIdx: number):
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

/**
 * Drops loaded pages far from the window `[firstPage, lastPage]`, keeping
 * the window itself and then the nearest pages up to the retention cap.
 * Returns the SAME map (no re-render) while under the cap.
 *
 * @typeParam T - The page payload
 * @param pages - The loaded pages by index
 * @param firstPage - First page of the visible window
 * @param lastPage - Last page of the visible window
 * @param max - Retention cap
 * @returns The retained pages (the input map when nothing was dropped)
 */
export function pruneRetainedPages<T>(
    pages: ReadonlyMap<number, T>,
    firstPage: number,
    lastPage: number,
    max: number,
): ReadonlyMap<number, T> {
    if (pages.size <= max) return pages;
    const distance = (p: number): number => (p < firstPage ? firstPage - p : p > lastPage ? p - lastPage : 0);
    const keep = [...pages.keys()].sort((a, b) => distance(a) - distance(b) || a - b).slice(0, max);
    const kept = new Map<number, T>();
    for (const p of keep.sort((a, b) => a - b)) {
        kept.set(p, pages.get(p)!);
    }
    return kept;
}
