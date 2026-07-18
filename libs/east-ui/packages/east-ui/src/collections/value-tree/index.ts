/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ValueTree — the editable value-driven tree (#360).
 *
 * `ValueTree.Root(value, opts)` walks the STATIC East type of `value` at
 * authoring time and materializes it into the fixed recursive
 * {@link ValueTreeNodeType} IR — automatic tree formation from ANY East
 * type, leaf-type-aware editing, and compound/collection editing
 * (add/remove array rows and dict entries, variant tag switching,
 * option toggling) reported through typed path callbacks. The host owns
 * the data: apply the edit and let the Reactive re-materialization
 * refresh the tree (the same contract as every collection surface).
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type ValueTypeOf,
    ArrayType,
    East,
    Expr,
    FunctionType,
    NullType,
    StringType,
    StructType,
    some,
    none,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    ValueTreeStepType,
    ValueTreePathType,
    ValueTreeLeafType,
    ValueTreeNodeType,
    ValueTreeStyleType,
    ValueTreeRootType,
} from "./types.js";

export {
    ValueTreeStepType,
    ValueTreePathType,
    ValueTreeLeafType,
    ValueTreeNodeType,
    ValueTreeStyleType,
    ValueTreeRootType,
} from "./types.js";

/** Beyond this many unrollings of a RecursiveType the subtree prints as
 *  an `opaque` node (a lazy "expand further" is the #360 follow-up). */
const MAX_RECURSION_DEPTH = 6;

/** Total materializer expansions per tree — caps generated IR size for
 *  wide recursive types, where a pure depth limit still explodes
 *  (branching^depth). Exhausted subtrees print as `opaque`. */
const MAX_MATERIALIZED_NODES = 4096;

/** Authoring-time expansion state threaded through {@link nodeOf}. */
interface MaterializeState {
    /** Remaining expansion budget (decremented per nodeOf call). */
    budget: number;
}


/** The dict-entry element of a dict node. */
const DictEntryType = StructType({ key: StringType, node: ValueTreeNodeType });
/** The struct-field element of a struct node. */
const StructFieldType = StructType({ name: StringType, node: ValueTreeNodeType });

/** True when a Variant type is exactly the Option shape (`some` + `none`). */
function isOptionType(t: EastType): boolean {
    if (t.type !== "Variant") return false;
    const tags = Object.keys((t as { cases: Record<string, EastType> }).cases);
    return tags.length === 2 && tags.includes("some") && tags.includes("none");
}

/**
 * Materialize `v` (typed `t`) into a {@link ValueTreeNodeType} expression.
 * Recursion is over the STATIC type — the generated IR walks the value
 * eagerly (the `mapRows` discipline: expressions expand once per type
 * shape, user data flows through East collection ops).
 */
function nodeOf(t: EastType, v: Expr, depth: number, state: MaterializeState): ExprType<ValueTreeNodeType> {
    state.budget -= 1;
    if (depth > MAX_RECURSION_DEPTH || state.budget <= 0) {
        return East.value(variant("opaque", East.print(v)), ValueTreeNodeType);
    }
    switch (t.type) {
        case "Null":
            return East.value(variant("leaf", variant("null", null)), ValueTreeNodeType);
        case "Boolean":
            return East.value(variant("leaf", variant("boolean", v)), ValueTreeNodeType);
        case "Integer":
            return East.value(variant("leaf", variant("integer", v)), ValueTreeNodeType);
        case "Float":
            return East.value(variant("leaf", variant("float", v)), ValueTreeNodeType);
        case "String":
            return East.value(variant("leaf", variant("string", v)), ValueTreeNodeType);
        case "DateTime":
            return East.value(variant("leaf", variant("datetime", v)), ValueTreeNodeType);
        case "Struct": {
            const fields = (t as { fields: Record<string, EastType> }).fields;
            const fieldNodes = Object.entries(fields).map(([name, ft]) => ({
                name,
                node: nodeOf(ft, (v as unknown as Record<string, Expr>)[name] as Expr, depth, state),
            }));
            return East.value(variant("struct", {
                fields: East.value(fieldNodes, ArrayType(StructFieldType)),
            }), ValueTreeNodeType);
        }
        case "Array": {
            const elem = (t as { value: EastType }).value;
            const fn = East.function([elem], ValueTreeNodeType,
                (_$, x) => nodeOf(elem, x as unknown as Expr, depth, state));
            const items = (v as unknown as { map: (cb: (b: unknown, x: Expr) => unknown) => Expr })
                .map((_$, x) => fn(x as never));
            return East.value(variant("array", { items }), ValueTreeNodeType);
        }
        case "Dict": {
            const { key, value } = t as { key: EastType; value: EastType };
            if (key.type !== "String") {
                return East.value(variant("opaque", East.print(v)), ValueTreeNodeType);
            }
            const fn = East.function([value, key], DictEntryType, (_$, x, k) => ({
                key: k as unknown as ExprType<StringType>,
                node: nodeOf(value, x as unknown as Expr, depth, state),
            }));
            const entries = (v as unknown as { toArray: (cb: (b: unknown, x: Expr, k: Expr) => unknown) => Expr })
                .toArray((_$, x, k) => fn(x as never, k as never));
            return East.value(variant("dict", { entries }), ValueTreeNodeType);
        }
        case "Variant": {
            const cases = (t as { cases: Record<string, EastType> }).cases;
            const tags = Object.keys(cases);
            if (isOptionType(t)) {
                const someType = cases["some"]!;
                return (v as unknown as { match: (h: unknown) => Expr }).match({
                    some: (_$: unknown, payload: Expr) => East.value(variant("option", {
                        value: some(nodeOf(someType, payload, depth, state)),
                    }), ValueTreeNodeType),
                    none: () => East.value(variant("option", {
                        value: none,
                    }), ValueTreeNodeType),
                }) as ExprType<ValueTreeNodeType>;
            }
            const handlers: Record<string, unknown> = {};
            for (const tag of tags) {
                handlers[tag] = (_$: unknown, payload: Expr) => East.value(variant("variant", {
                    tag,
                    tags: East.value(tags, ArrayType(StringType)),
                    value: nodeOf(cases[tag]!, payload, depth, state),
                }), ValueTreeNodeType);
            }
            return (v as unknown as { match: (h: unknown) => Expr })
                .match(handlers) as ExprType<ValueTreeNodeType>;
        }
        case "Recursive":
            // A recursive-typed expression only exposes unwrap()/wrap —
            // unwrap to the inner node type before descending.
            return nodeOf(
                (t as { node: EastType }).node,
                (v as unknown as { unwrap: () => Expr }).unwrap(),
                depth + 1,
                state,
            );
        default:
            // Sets, blobs, vectors, matrices, refs, functions — printed.
            return East.value(variant("opaque", East.print(v)), ValueTreeNodeType);
    }
}

// ============================================================================
// Options
// ============================================================================

/**
 * Options for {@link ValueTree.Root}.
 *
 * @property onEdit - Leaf edit callback: the node path + the new leaf value
 * @property onInsert - Append/insert callback for an array or dict node's
 *   path (dict inserts carry the new key as a final `key` step); the host
 *   appends a default element (see `ValueTree.zero`)
 * @property onRemove - Remove callback with the element/entry path
 * @property onTag - Variant tag switch (and option toggle: "some"/"none")
 *   with the node path and the new tag
 * @property style - Layout style (height / maxHeight)
 */
export interface ValueTreeOptions {
    /** Leaf edit callback: node path + new leaf value */
    onEdit?: SubtypeExprOrValue<FunctionType<[ValueTreePathType, ValueTreeLeafType], NullType>>;
    /** Append/insert callback for an array/dict node's path */
    onInsert?: SubtypeExprOrValue<FunctionType<[ValueTreePathType], NullType>>;
    /** Remove callback with the element/entry path */
    onRemove?: SubtypeExprOrValue<FunctionType<[ValueTreePathType], NullType>>;
    /** Variant tag switch / option toggle callback */
    onTag?: SubtypeExprOrValue<FunctionType<[ValueTreePathType, StringType], NullType>>;
    /** Layout style (height / maxHeight) */
    style?: {
        /** Pinned height (CSS length; rows virtualize within) */
        height?: SubtypeExprOrValue<StringType>;
        /** Height cap (content-sized up to it, then scrolls) */
        maxHeight?: SubtypeExprOrValue<StringType>;
    };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a ValueTree — the editable tree of any East value.
 *
 * @typeParam T - The value's East type (captured statically)
 * @param value - The value to materialize (any East type)
 * @param options - Edit callbacks + style ({@link ValueTreeOptions})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East, DictType, StringType, StructType, FloatType } from "@elaraai/east";
 * import { ValueTree, UIComponentType } from "@elaraai/east-ui";
 *
 * const ConfigType = DictType(StringType, StructType({ rate: FloatType, label: StringType }));
 * const view = East.function([ConfigType], UIComponentType, (_$, config) =>
 *     ValueTree.Root(config),
 * );
 * ```
 */
function createValueTree<T extends EastType>(
    value: SubtypeExprOrValue<T> | Expr,
    options?: ValueTreeOptions,
): ExprType<UIComponentType> {
    const v = East.value(value as never) as Expr;
    const t = Expr.type(v) as EastType;
    const root = nodeOf(t, v, 0, { budget: MAX_MATERIALIZED_NODES });
    const style = options?.style;
    return East.value(variant("ValueTree", {
        root,
        onEdit: options?.onEdit !== undefined ? some(options.onEdit) : none,
        onInsert: options?.onInsert !== undefined ? some(options.onInsert) : none,
        onRemove: options?.onRemove !== undefined ? some(options.onRemove) : none,
        onTag: options?.onTag !== undefined ? some(options.onTag) : none,
        style: style !== undefined ? some(East.value({
            height: style.height !== undefined ? some(style.height) : none,
            maxHeight: style.maxHeight !== undefined ? some(style.maxHeight) : none,
        }, ValueTreeStyleType)) : none,
    }), UIComponentType);
}

/**
 * A host-side zero value for any East type — the companion for
 * `onInsert` handlers appending a default element.
 *
 * @param t - The East type to zero
 * @returns The TypeScript `ValueTypeOf` zero value
 */
function zeroValue<T extends EastType>(t: T): ValueTypeOf<T> {
    switch (t.type) {
        case "Null": return null as ValueTypeOf<T>;
        case "Boolean": return false as ValueTypeOf<T>;
        case "Integer": return 0n as ValueTypeOf<T>;
        case "Float": return 0 as ValueTypeOf<T>;
        case "String": return "" as ValueTypeOf<T>;
        case "DateTime": return new Date(0) as ValueTypeOf<T>;
        case "Blob": return new Uint8Array() as ValueTypeOf<T>;
        case "Array": return [] as ValueTypeOf<T>;
        case "Set": return new Set() as ValueTypeOf<T>;
        case "Dict": return new Map() as ValueTypeOf<T>;
        case "Struct": {
            const fields = (t as unknown as { fields: Record<string, EastType> }).fields;
            const out: Record<string, unknown> = {};
            for (const [name, ft] of Object.entries(fields)) out[name] = zeroValue(ft);
            return out as ValueTypeOf<T>;
        }
        case "Variant": {
            const cases = (t as unknown as { cases: Record<string, EastType> }).cases;
            if (isOptionType(t)) return none as ValueTypeOf<T>;
            const [tag, caseType] = Object.entries(cases)[0]!;
            return variant(tag, zeroValue(caseType)) as ValueTypeOf<T>;
        }
        case "Recursive":
            return zeroValue((t as unknown as { node: EastType }).node) as ValueTypeOf<T>;
        default:
            throw new Error(`ValueTree.zero: no zero value for East type '${t.type}'`);
    }
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * ValueTree component namespace.
 *
 * @remarks
 * `ValueTree.Root(value, options)` materializes any East value into the
 * editable tree; `ValueTree.zero(Type)` builds the host-side default
 * element for `onInsert` handlers.
 */
export const ValueTree = {
    /**
     * Creates a ValueTree — the editable tree of any East value.
     *
     * @param value - The value to materialize (any East type)
     * @param options - Edit callbacks + style ({@link ValueTreeOptions})
     * @returns An East expression of `UIComponentType`
     */
    Root: createValueTree,
    /** Host-side zero value for any East type (for `onInsert` handlers). */
    zero: zeroValue,
    Types: {
        /** The full ValueTree payload. */
        Root: ValueTreeRootType,
        /** The materialized node tree. */
        Node: ValueTreeNodeType,
        /** A node path. */
        Path: ValueTreePathType,
        /** One path step. */
        Step: ValueTreeStepType,
        /** A primitive leaf value / leaf edit. */
        Leaf: ValueTreeLeafType,
        /** Container style. */
        Style: ValueTreeStyleType,
    },
} as const;
