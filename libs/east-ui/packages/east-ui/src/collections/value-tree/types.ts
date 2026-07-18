/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * ValueTree types — the editable value-driven tree (#360).
 *
 * A ValueTree materializes ANY East value into a fixed recursive node IR
 * at factory time (the renderer never sees the host type): structs,
 * arrays, string-keyed dicts, options and variants become branch nodes;
 * primitive leaves carry their typed value for leaf-type-aware editing;
 * everything else (sets, blobs, vectors, matrices, refs, functions,
 * beyond-depth recursion) renders as a printed read-only `opaque` node.
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
 * @property key - Dict entry key (an existing entry mid-path; the NEW key
 *   as the terminal step of dict `onInsert` paths)
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
    /** Dict entry key */
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
 * @property dict - Keyed entries; `editable` is true only for
 *   string-keyed dicts (other key types are browsable read-only — their
 *   printed keys cannot round-trip through path steps)
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
    /** Keyed entries (editable only when string-keyed) */
    dict: StructType({
        entries: ArrayType(StructType({ key: StringType, node })),
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
 */
export const ValueTreeStyleType = StructType({
    height: OptionType(StringType),
    maxHeight: OptionType(StringType),
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
