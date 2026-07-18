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
 * Editing is leaf-type-aware: leaves mount the typed `forms/input`
 * renderers (host-constructed decoded payloads — the ClauseBuilder
 * trick), booleans a Checkbox, variant tags the shared Select; arrays
 * and string-keyed dicts get add / remove controls and options a
 * set / clear toggle. Every edit reports a typed path through the
 * payload's `onEdit` / `onInsert` / `onRemove` / `onTag` callbacks —
 * the host owns the data and re-materializes. Without callbacks the
 * tree is a read-only inspector.
 */

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight, faMinus, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { equalFor, some, variant, none, type ValueTypeOf } from "@elaraai/east";
import { ValueTree } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { usePersistedState } from "../../hooks/usePersistedState";
import { VirtualRows } from "../virtual-rows.js";
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

export interface EastChakraValueTreeProps {
    value: ValueTreeValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;

/** Estimated row height (px) — sm editors measure a little taller; the
 *  virtualizer corrects per row, this also scales scroll persistence. */
const ROW_H = 32;
/** Rows at depth < this start expanded (overridable, persisted). */
const DEFAULT_OPEN_DEPTH = 2;
/** Indent per depth level (px). */
const INDENT = 18;

interface ValueTreePersisted {
    open: Record<string, boolean>;
    topRow: number;
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
    depth: number;
    label: string;
    kind: "leaf" | "opaque" | "struct" | "array" | "dict" | "emptyOption" | "appendArray" | "appendDict";
    leaf: ValueTreeLeafValue | undefined;
    opaque: string | undefined;
    childCount: number;
    /** Path to the resolved node — the edit / insert target. */
    path: ValueTreeStepValue[];
    /** Path of the row's own binding step — the remove target. */
    ownPath: ValueTreeStepValue[];
    variantCtl: { path: ValueTreeStepValue[]; tag: string; tags: string[] } | undefined;
    optionCtl: { path: ValueTreeStepValue[]; isSome: boolean } | undefined;
    removable: boolean;
    expandable: boolean;
    expanded: boolean;
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

interface ChildEntry {
    label: string;
    node: ValueTreeNodeValue;
    step: ValueTreeStepValue;
}

function childrenOf(node: ValueTreeNodeValue): ChildEntry[] {
    if (node.type === "struct") {
        return node.value.fields.map(f => ({ label: f.name, node: f.node, step: variant("field", f.name) }));
    }
    if (node.type === "array") {
        return node.value.items.map((n, i) => ({ label: `[${i}]`, node: n, step: variant("index", BigInt(i)) }));
    }
    if (node.type === "dict") {
        return node.value.entries.map(e => ({ label: e.key, node: e.node, step: variant("key", e.key) }));
    }
    return [];
}

/** Flattens the visible (expanded) rows of the tree, depth-first. */
function flattenRows(
    root: ValueTreeNodeValue,
    open: Record<string, boolean>,
    canRemove: boolean,
    canInsert: boolean,
): RowModel[] {
    const rows: RowModel[] = [];
    const visit = (
        label: string,
        raw: ValueTreeNodeValue,
        rawPath: ValueTreeStepValue[],
        depth: number,
        removable: boolean,
    ): void => {
        const r = resolveNode(raw, rawPath);
        const id = pathKey(rawPath);
        const kids = childrenOf(r.node);
        const expandable = kids.length > 0;
        const expanded = expandable && (open[id] ?? depth < DEFAULT_OPEN_DEPTH);
        rows.push({
            id, depth, label,
            kind: r.kind, leaf: r.leaf, opaque: r.opaque,
            childCount: kids.length,
            path: r.path, ownPath: rawPath,
            variantCtl: r.variantCtl, optionCtl: r.optionCtl,
            removable, expandable, expanded,
        });
        if (expanded) {
            const kidsRemovable = canRemove && (r.kind === "array" || r.kind === "dict");
            for (const k of kids) {
                visit(k.label, k.node, [...r.path, k.step], depth + 1, kidsRemovable);
            }
        }
    };
    // A compound root lists its children directly (no synthetic top row);
    // anything else is a single row. A root collection has no own row to
    // carry the add control, so it appends a trailing add row instead.
    if (root.type === "struct" || root.type === "array" || root.type === "dict") {
        const kidsRemovable = canRemove && (root.type === "array" || root.type === "dict");
        for (const k of childrenOf(root)) {
            visit(k.label, k.node, [k.step], 0, kidsRemovable);
        }
        if (canInsert && (root.type === "array" || root.type === "dict")) {
            rows.push({
                id: "$append", depth: 0,
                label: root.type === "array" ? "Add item" : "Add entry",
                kind: root.type === "array" ? "appendArray" : "appendDict",
                leaf: undefined, opaque: undefined, childCount: 0,
                path: [], ownPath: [],
                variantCtl: undefined, optionCtl: undefined,
                removable: false, expandable: false, expanded: false,
            });
        }
    } else {
        visit("value", root, [], 0, false);
    }
    return rows;
}

function fmtLeaf(leaf: ValueTreeLeafValue): string {
    switch (leaf.type) {
        case "string": return leaf.value;
        case "integer": return String(leaf.value);
        case "float": return String(leaf.value);
        case "boolean": return leaf.value ? "true" : "false";
        case "datetime": return leaf.value.toISOString().replace("T", " ").slice(0, 19);
        default: return "null";
    }
}

const smInputStyle = some({ size: some(variant("sm", null)) });

/** Fabricate a decoded `Select` payload for the shared select renderer —
 *  the ClauseBuilder trick (decoded-value shape, JS callbacks). */
function tagSelectValue(tag: string, tags: string[], onChange: (t: string) => void): never {
    return {
        value: some(tag),
        items: tags.map(t => ({ value: t, label: t, disabled: none })),
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

/** The inline add-entry control for dict rows — the new key is entered in
 *  place (Enter commits as a trailing `key` step, Escape cancels). */
function DictAdd({ path, styles, onInsert }: {
    path: ValueTreeStepValue[];
    styles: SlotStyles;
    onInsert: NonNullable<TreeCallbacks["onInsert"]>;
}): ReactNode {
    const [keyText, setKeyText] = useState<string | undefined>(undefined);
    if (keyText === undefined) {
        return (
            <chakra.button type="button" css={styles["ctl"]} aria-label="Add entry"
                onClick={() => setKeyText("")}>
                <FontAwesomeIcon icon={faPlus} />
            </chakra.button>
        );
    }
    return (
        <chakra.input
            css={styles["keyInput"]}
            autoFocus
            value={keyText}
            placeholder="key"
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

function Row({ row, styles, cbs, onToggle }: {
    row: RowModel;
    styles: SlotStyles;
    cbs: TreeCallbacks;
    onToggle: (id: string, expanded: boolean) => void;
}): ReactNode {
    const { onEdit, onInsert, onRemove, onTag } = cbs;
    // Trailing add row for a ROOT collection (it has no own row to carry
    // the add control).
    if ((row.kind === "appendArray" || row.kind === "appendDict") && onInsert !== undefined) {
        return (
            <Box css={styles["row"]} data-part="row" data-row-id={row.id}
                style={{ paddingLeft: `${12 + row.depth * INDENT}px` }}>
            <Box css={styles["twist"]} visibility="hidden" aria-hidden="true" />
                {row.kind === "appendArray" ? (
                    <chakra.button type="button" css={styles["append"]} aria-label={row.label}
                        onClick={() => { void onInsert(row.path); }}>
                        <FontAwesomeIcon icon={faPlus} /> {row.label}
                    </chakra.button>
                ) : (
                    <Box css={styles["append"]}>
                        <FontAwesomeIcon icon={faPlus} /> {row.label}
                        <DictAdd path={row.path} styles={styles} onInsert={onInsert} />
                    </Box>
                )}
            </Box>
        );
    }
    // Read-only variants have no tag select — surface the active tag as
    // text (and drop a null payload's redundant "null").
    const tagText = row.variantCtl !== undefined && onTag === undefined
        ? <Box as="span" css={styles["summary"]}>{row.variantCtl.tag}</Box>
        : null;
    let valueCell: ReactNode;
    if (row.kind === "leaf" && row.leaf !== undefined) {
        valueCell = onEdit !== undefined && row.leaf.type !== "null"
            ? <LeafEditor leaf={row.leaf} path={row.path} onEdit={onEdit} />
            : (tagText !== null && row.leaf.type === "null"
                ? null
                : <Box as="span" css={styles["valueText"]}>{fmtLeaf(row.leaf)}</Box>);
    } else if (row.kind === "opaque") {
        valueCell = <Box as="span" css={styles["opaque"]} title={row.opaque}>{row.opaque}</Box>;
    } else if (row.kind === "emptyOption") {
        valueCell = <Box as="span" css={styles["summary"]}>—</Box>;
    } else {
        const noun = row.kind === "struct" ? "fields" : row.kind === "array" ? "items" : "entries";
        valueCell = <Box as="span" css={styles["summary"]}>{row.childCount} {noun}</Box>;
    }
    return (
        <Box
            css={styles["row"]}
            data-part="row"
            data-row-id={row.id}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.expandable ? row.expanded : undefined}
            style={{ paddingLeft: `${12 + row.depth * INDENT}px` }}
        >
            {row.expandable ? (
                <chakra.button
                    type="button"
                    css={styles["twist"]}
                    aria-label={row.expanded ? "Collapse" : "Expand"}
                    onClick={() => onToggle(row.id, !row.expanded)}
                >
                    <FontAwesomeIcon icon={row.expanded ? faChevronDown : faChevronRight} />
                </chakra.button>
            ) : (
                <Box css={styles["twist"]} visibility="hidden" aria-hidden="true" />
            )}
            <Box as="span" css={styles["label"]} title={row.label}>{row.label}</Box>
            <Box css={styles["value"]}>{tagText}{valueCell}</Box>
            <Box css={styles["controls"]}>
                {row.variantCtl !== undefined && onTag !== undefined && (() => {
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
                })()}
                {row.optionCtl !== undefined && onTag !== undefined && (() => {
                    const ctl = row.optionCtl;
                    return (
                        <chakra.button type="button" css={styles["ctl"]}
                            aria-label={ctl.isSome ? "Clear value" : "Set value"}
                            onClick={() => { void onTag(ctl.path, ctl.isSome ? "none" : "some"); }}>
                            <FontAwesomeIcon icon={ctl.isSome ? faMinus : faPlus} />
                        </chakra.button>
                    );
                })()}
                {row.kind === "array" && onInsert !== undefined && (
                    <chakra.button type="button" css={styles["ctl"]} aria-label="Add item"
                        onClick={() => { void onInsert(row.path); }}>
                        <FontAwesomeIcon icon={faPlus} />
                    </chakra.button>
                )}
                {row.kind === "dict" && onInsert !== undefined && (
                    <DictAdd path={row.path} styles={styles} onInsert={onInsert} />
                )}
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
    { value, storageKey }: EastChakraValueTreeProps,
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
    const rows = useMemo(
        () => flattenRows(value.root, persisted.open, cbs.onRemove !== undefined, cbs.onInsert !== undefined),
        [value.root, persisted.open, cbs.onRemove, cbs.onInsert],
    );

    const onToggle = useCallback((id: string, expanded: boolean) => {
        setPersisted(prev => ({ ...prev, open: { ...prev.open, [id]: expanded } }));
    }, [setPersisted]);

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
    const onScroll = useCallback(() => {
        const el = scrollElRef.current;
        if (el === null) return;
        const topRow = Math.round(el.scrollTop / ROW_H);
        setPersisted(prev => (prev.topRow === topRow ? prev : { ...prev, topRow }));
    }, [setPersisted]);

    const style = getSomeorUndefined(value.style);
    const height = style !== undefined ? getSomeorUndefined(style.height) : undefined;
    const maxHeight = style !== undefined ? getSomeorUndefined(style.maxHeight) : undefined;

    if (rows.length === 0) {
        return (
            <Box css={styles["root"]} role="tree">
                <Box css={styles["empty"]}>No values</Box>
            </Box>
        );
    }
    return (
        <Box role="tree" aria-label="Value tree">
            <VirtualRows
                height={height}
                maxHeight={maxHeight}
                count={rows.length}
                estimateSize={() => ROW_H}
                overscan={8}
                rootCss={styles["root"] as Record<string, unknown>}
                scrollElRef={scrollElRef}
                onScroll={onScroll}
                renderRow={(i) => {
                    const row = rows[i];
                    if (row === undefined) return null;
                    return <Row key={row.id} row={row} styles={styles} cbs={cbs} onToggle={onToggle} />;
                }}
            />
        </Box>
    );
}, (prev, next) => valueTreeEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
