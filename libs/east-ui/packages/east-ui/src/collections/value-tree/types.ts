/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ValueTree types — the editable value-driven tree (#360).
 *
 * A ValueTree materializes ANY East value into a fixed recursive node IR
 * at factory time (the renderer never sees the host type): structs,
 * arrays, dicts, options and variants become branch nodes; primitive
 * leaves carry their typed value for leaf-type-aware editing; everything
 * else (sets, blobs, vectors, matrices, refs, functions, beyond-depth
 * recursion) renders as a printed read-only `opaque` node.
 *
 * Edits report through typed callbacks over {@link ValueTreePathType}
 * paths — the host owns the data and reconciles (the Reactive
 * re-materialization pattern every collection uses).
 */

import {
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DateTimeType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    RecursiveType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

// ============================================================================
// Paths
// ============================================================================

/**
 * One step of a node path.
 *
 * @property append - Append a new element to the array at the path so far
 *   (terminal step of array `onInsert` paths; disambiguates an array
 *   append inside a dict from a dict key insert)
 * @property field - Struct field name
 * @property index - Array element index
 * @property key - Dict entry key text (an existing entry mid-path; the NEW
 *   key as the terminal step of dict `onInsert` paths). For string-keyed
 *   dicts this is the key itself; for every other key type it is the key's
 *   canonical East print (`East.print` / east's `printFor`), which the
 *   edit-appliers parse back to the key value — never the display label
 *   (labels can collide)
 * @property some - Descend into an option's `some` payload
 * @property tag - Descend into a variant's active payload
 */
export const ValueTreeStepType = VariantType({
    /** Append to the array at the path so far (terminal `onInsert` step) */
    append: NullType,
    /** Struct field name */
    field: StringType,
    /** Array element index */
    index: IntegerType,
    /** Dict entry key text — the key itself (string-keyed) or the key's
     *  canonical East print (every other key type) */
    key: StringType,
    /** Descend into an option's `some` payload */
    some: NullType,
    /** Descend into a variant's active payload */
    tag: NullType,
});

/**
 * Type representing one path step.
 */
export type ValueTreeStepType = typeof ValueTreeStepType;

/**
 * A node path — root-to-node steps.
 */
export const ValueTreePathType = ArrayType(ValueTreeStepType);

/**
 * Type representing a node path.
 */
export type ValueTreePathType = typeof ValueTreePathType;

// ============================================================================
// Leaves
// ============================================================================

/**
 * A primitive leaf value — both the node payload (current value) and the
 * `onEdit` payload (new value), so editors and edits share one shape.
 *
 * @property string - String leaf
 * @property integer - Integer leaf
 * @property float - Float leaf
 * @property boolean - Boolean leaf
 * @property datetime - DateTime leaf
 * @property null - Null leaf (display-only)
 */
export const ValueTreeLeafType = VariantType({
    /** String leaf */
    string: StringType,
    /** Integer leaf */
    integer: IntegerType,
    /** Float leaf */
    float: FloatType,
    /** Boolean leaf */
    boolean: BooleanType,
    /** DateTime leaf */
    datetime: DateTimeType,
    /** Null leaf (display-only) */
    null: NullType,
});

/**
 * Type representing a primitive leaf value.
 */
export type ValueTreeLeafType = typeof ValueTreeLeafType;

// ============================================================================
// Nodes
// ============================================================================

/**
 * The materialized value tree.
 *
 * @property struct - Named fields
 * @property array - Ordered elements (insert/remove targets)
 * @property dict - Keyed entries. Each entry carries its round-trippable
 *   `key` text (the key itself for string keys, the canonical East print
 *   otherwise — what `key` path steps echo back) and its display `label`
 *   (struct keys read as " · "-joined field labels; labels may collide,
 *   only `key` is identity). Entry VALUES are editable for every key
 *   type; `editable` gates entry insert/remove and is true only for
 *   string-keyed dicts (new keys are typed as text)
 * @property option - `some` payload or empty (toggled via `onTag` "some"/"none")
 * @property variant - Active tag + all tags (switched via `onTag`) + payload
 * @property leaf - Primitive value (edited via `onEdit`)
 * @property opaque - Summarized read-only value (sets, blobs, vectors,
 *   matrices, refs, functions, beyond-depth recursion)
 */
export const ValueTreeNodeType = RecursiveType(node => VariantType({
    /** Named fields */
    struct: StructType({
        fields: ArrayType(StructType({ name: StringType, node })),
    }),
    /** Ordered elements */
    array: StructType({
        items: ArrayType(node),
    }),
    /** Keyed entries (`key` = round-trippable step text, `label` = display;
     *  entry insert/remove only when string-keyed) */
    dict: StructType({
        entries: ArrayType(StructType({ key: StringType, label: StringType, node })),
        editable: BooleanType,
    }),
    /** `some` payload or empty */
    option: StructType({
        value: OptionType(node),
    }),
    /** Active tag + all tags + payload */
    variant: StructType({
        tag: StringType,
        tags: ArrayType(StringType),
        value: node,
    }),
    /** Primitive value */
    leaf: ValueTreeLeafType,
    /** Printed read-only value */
    opaque: StringType,
}));

/**
 * Type representing a materialized value-tree node.
 */
export type ValueTreeNodeType = typeof ValueTreeNodeType;

// ============================================================================
// Style
// ============================================================================

/**
 * Style configuration for the ValueTree container.
 *
 * @property height - Pinned height (CSS length; rows virtualize within)
 * @property maxHeight - Height cap (content-sized up to it, then scrolls)
 * @property openDepth - How many levels start expanded (rows deeper start
 *   collapsed; per-row toggles persist over this baseline). Default 1.
 * @property toolbar - Show the collapse-all / expand-all toolbar above the
 *   rows. Default off.
 */
export const ValueTreeStyleType = StructType({
    height: OptionType(StringType),
    maxHeight: OptionType(StringType),
    openDepth: OptionType(IntegerType),
    toolbar: OptionType(BooleanType),
});

/**
 * Type representing the ValueTree style structure.
 */
export type ValueTreeStyleType = typeof ValueTreeStyleType;

// ============================================================================
// Root payload
// ============================================================================

/**
 * The full ValueTree payload — the `component.ts` variant's struct; use
 * for `ValueTypeOf<typeof ValueTree.Types.Root>` in renderers and
 * assertions.
 *
 * Callback slots are ASYNC function types: handlers routinely write
 * State (an async platform effect), and a synchronous function is a
 * subtype of its async counterpart — so both fit.
 *
 * @property root - The materialized node tree
 * @property onEdit - Leaf edit callback (path + new leaf value)
 * @property onInsert - Append/insert callback (array/dict node path)
 * @property onRemove - Remove callback (element/entry path)
 * @property onTag - Variant tag switch / option toggle callback
 * @property style - Layout style
 */
export const ValueTreeRootType = StructType({
    root: ValueTreeNodeType,
    onEdit: OptionType(AsyncFunctionType([ValueTreePathType, ValueTreeLeafType], NullType)),
    onInsert: OptionType(AsyncFunctionType([ValueTreePathType], NullType)),
    onRemove: OptionType(AsyncFunctionType([ValueTreePathType], NullType)),
    onTag: OptionType(AsyncFunctionType([ValueTreePathType, StringType], NullType)),
    style: OptionType(ValueTreeStyleType),
});

/**
 * Type representing the full ValueTree payload.
 */
export type ValueTreeRootType = typeof ValueTreeRootType;
