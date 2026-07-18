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
 * option toggling).
 *
 * Two edit surfaces, one contract:
 *
 * - **Value handlers** (the default): `onUpdate` receives the whole
 *   value with the edit applied; `at: [ValueTree.at(Type, p => …, fn)]`
 *   scopes receive just the rebuilt SUBTREE at their path. Every edit
 *   dispatches to the deepest scope whose path prefixes the edit path
 *   and bubbles up to `onUpdate` when no scope matches. The rebuild is
 *   an authoring-time macro over the static type — hosts never
 *   hand-apply paths.
 * - **Path callbacks** (the escape hatch): `onEdit` / `onInsert` /
 *   `onRemove` / `onTag` receive the raw typed path and payload for
 *   hosts that own a finer-grained store. A raw callback overrides the
 *   generated handler for its event.
 *
 * The host owns the data either way: write the new value and let the
 * Reactive re-materialization refresh the tree (the same contract as
 * every collection surface).
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type ValueTypeOf,
    ArrayType,
    type AsyncFunctionType,
    type DictType,
    East,
    Expr,
    FunctionType,
    NullType,
    RecursiveExpr,
    type RecursiveType,
    StringType,
    StructType,
    type VariantType,
    defaultValue,
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

/** Expansion budget for each generated edit-application wrapper —
 *  the rebuild macro mirrors the materializer's recursion, so it gets
 *  the same cap; exhausted subtrees pass through unchanged (the
 *  materializer shows them as read-only `opaque` anyway). */
const MAX_REBUILD_NODES = 4096;

/** Longest opaque summary before the printed value is clamped. */
const MAX_OPAQUE_PRINT = 80n;

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

/** Clamps a printed value for opaque summaries (large collections would
 *  otherwise dump their whole print into a single row). */
const clampPrint = East.function([StringType], StringType, (_$, p) =>
    p.length().greater(MAX_OPAQUE_PRINT).ifElse(
        () => p.substring(0n, MAX_OPAQUE_PRINT).concat("…"),
        () => p,
    ));

/** Kind-aware opaque summary — "Set · 12 items" beats an unbounded print. */
function opaqueSummary(t: EastType, v: Expr): ExprType<StringType> {
    switch (t.type) {
        case "Set":
            return East.str`Set · ${(v as unknown as { size: () => Expr }).size()} items` as ExprType<StringType>;
        case "Blob":
            return East.str`Blob · ${(v as unknown as { size: () => Expr }).size()} bytes` as ExprType<StringType>;
        case "Vector":
            return East.str`Vector · ${(v as unknown as { length: () => Expr }).length()} values` as ExprType<StringType>;
        case "Matrix": {
            const m = v as unknown as { rows: () => Expr; cols: () => Expr };
            return East.str`Matrix · ${m.rows()}×${m.cols()}` as ExprType<StringType>;
        }
        case "Ref":
            return East.str`Ref · ${clampPrint(East.print((v as unknown as { get: () => Expr }).get()))}` as ExprType<StringType>;
        case "Function":
        case "AsyncFunction":
            return East.value("Function", StringType);
        default:
            return clampPrint(East.print(v));
    }
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
        return East.value(variant("opaque", clampPrint(East.print(v))), ValueTreeNodeType);
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
            const editable = key.type === "String";
            const fn = East.function([value, key], DictEntryType, (_$, x, k) => ({
                key: editable
                    ? (k as unknown as ExprType<StringType>)
                    : East.print(k),
                node: nodeOf(value, x as unknown as Expr, depth, state),
            }));
            const entries = (v as unknown as { toArray: (cb: (b: unknown, x: Expr, k: Expr) => unknown) => Expr })
                .toArray((_$, x, k) => fn(x as never, k as never));
            return East.value(variant("dict", { entries, editable }), ValueTreeNodeType);
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
            // Sets, blobs, vectors, matrices, refs, functions — summarized.
            return East.value(variant("opaque", opaqueSummary(t, v)), ValueTreeNodeType);
    }
}

// ============================================================================
// Edit application (the rebuild macro)
// ============================================================================

/** Loosely-typed expression views the rebuild macro walks through — the
 *  STATIC East type drives which members are touched, so the casts are
 *  shape-only (the same discipline as {@link nodeOf}). */
interface PathView {
    size: () => { equals: (n: bigint) => BoolView; greaterEqual: (n: bigint) => BoolView };
    get: (i: bigint) => StepView;
}
interface StepView {
    hasTag: (tag: string) => BoolView;
    unwrap: (tag: string) => Expr;
}
interface BoolView {
    ifElse: (a: () => unknown, b: () => unknown) => Expr;
    and: (f: () => unknown) => BoolView;
}

/** One structural edit, host-discriminated (each generated wrapper
 *  expands the macro for exactly one op kind). */
type RebuildOp =
    | { kind: "edit"; leaf: ExprType<ValueTreeLeafType> }
    | { kind: "insert" }
    | { kind: "remove" }
    | { kind: "tag"; tag: ExprType<StringType> };

/** Authoring-time expansion state for one rebuild wrapper. */
interface RebuildState {
    budget: number;
}

/** Leaf case tag of {@link ValueTreeLeafType} for a primitive type. */
function leafTag(t: EastType): "string" | "integer" | "float" | "boolean" | "datetime" | undefined {
    switch (t.type) {
        case "String": return "string";
        case "Integer": return "integer";
        case "Float": return "float";
        case "Boolean": return "boolean";
        case "DateTime": return "datetime";
        default: return undefined;
    }
}

/** Zero value as an East expression, or undefined where no zero exists
 *  (functions, matrices) — the corresponding insert/tag branch then
 *  passes the value through unchanged. */
function tryZeroExpr(t: EastType): Expr | undefined {
    try {
        return East.value(zeroValue(t as never), t) as unknown as Expr;
    } catch {
        return undefined;
    }
}

/**
 * Rebuild `v` (typed `t`) with `op` applied at `path` — the write-side
 * mirror of {@link nodeOf}. Expands per static type shape; `si` is the
 * number of path steps already consumed (static: one per nesting level),
 * `depth` counts RecursiveType unrollings against the same cap as the
 * materializer (edits cannot originate beyond what materialized).
 *
 * Op semantics at the addressed node:
 * - `edit`: the path ends AT a primitive leaf — its typed payload replaces it.
 * - `insert`: the path ends with `append` (array) or the NEW `key` (dict).
 * - `remove`: the path ends with the element `index` / entry `key`.
 * - `tag`: the path ends AT an option (tag "some"/"none") or variant node;
 *   the payload becomes the target case's zero value.
 */
function rebuild(
    t: EastType,
    v: Expr,
    path: Expr,
    si: number,
    depth: number,
    state: RebuildState,
    op: RebuildOp,
): Expr {
    state.budget -= 1;
    if (depth > MAX_RECURSION_DEPTH || state.budget <= 0) {
        return v;
    }
    const p = path as unknown as PathView;
    const step = () => p.get(BigInt(si));
    const atEnd = (n: number) => p.size().equals(BigInt(n));

    switch (t.type) {
        case "Null":
            return v;
        case "Boolean":
        case "Integer":
        case "Float":
        case "String":
        case "DateTime": {
            if (op.kind !== "edit") return v;
            const tag = leafTag(t)!;
            return (op.leaf as unknown as StepView).unwrap(tag);
        }
        case "Struct": {
            const fields = Object.entries((t as { fields: Record<string, EastType> }).fields);
            if (fields.length === 0) return v;
            const vs = v as unknown as Record<string, Expr>;
            let chain: Expr = v;
            for (const [name, ft] of [...fields].reverse()) {
                const rebuiltFields: Record<string, Expr> = {};
                for (const [n] of fields) {
                    rebuiltFields[n] = n === name
                        ? rebuild(ft, vs[n] as Expr, path, si + 1, depth, state, op)
                        : vs[n] as Expr;
                }
                const prev = chain;
                chain = step().hasTag("field")
                    .and(() => (step().unwrap("field") as unknown as { equals: (s: string) => BoolView }).equals(name))
                    .ifElse(() => East.value(rebuiltFields, t), () => prev);
            }
            return chain;
        }
        case "Array": {
            const elem = (t as { value: EastType }).value;
            const av = v as unknown as {
                map: (cb: (b: unknown, x: Expr, i: Expr) => unknown) => Expr;
                filter: (cb: (b: unknown, x: Expr, i: Expr) => unknown) => Expr;
                concat: (x: unknown) => Expr;
            };
            const descend = (): Expr => av.map((_$, x, i) =>
                (i as unknown as { equals: (o: Expr) => BoolView }).equals(step().unwrap("index"))
                    .ifElse(
                        () => rebuild(elem, x, path, si + 1, depth, state, op),
                        () => x,
                    ));
            if (op.kind === "insert") {
                const zero = tryZeroExpr(elem);
                if (zero === undefined) return descend();
                return atEnd(si + 1)
                    .and(() => step().hasTag("append"))
                    .ifElse(
                        () => av.concat(East.value([zero], ArrayType(elem))),
                        descend,
                    );
            }
            if (op.kind === "remove") {
                return atEnd(si + 1).ifElse(
                    () => av.filter((_$, _x, i) =>
                        (i as unknown as { notEquals: (o: Expr) => Expr }).notEquals(step().unwrap("index"))),
                    descend,
                );
            }
            return descend();
        }
        case "Dict": {
            const { key: kt, value: vt } = t as { key: EastType; value: EastType };
            if (kt.type !== "String") return v;
            const dv = v as unknown as {
                map: (cb: (b: unknown, x: Expr, k: Expr) => unknown) => Expr;
            };
            const descend = (): Expr => dv.map((_$, val, k) =>
                (k as unknown as { equals: (o: Expr) => BoolView }).equals(step().unwrap("key"))
                    .ifElse(
                        () => rebuild(vt, val, path, si + 1, depth, state, op),
                        () => val,
                    ));
            if (op.kind === "insert") {
                const zero = tryZeroExpr(vt);
                if (zero === undefined) return descend();
                // Tail-return style (no `$.return`): these run inside the
                // ASYNC generated wrappers, where a Return's control-flow
                // exception would escape the sync call boundary.
                const insertFn = East.function([t, StringType], t, ($, d, k) => {
                    const next = $.let((d as unknown as { copy: () => Expr }).copy());
                    $((next as unknown as { insertOrUpdate: (k: Expr, x: Expr) => Expr })
                        .insertOrUpdate(k as unknown as Expr, zero));
                    return next as never;
                });
                return atEnd(si + 1)
                    .and(() => step().hasTag("key"))
                    .ifElse(
                        () => insertFn(v as never, step().unwrap("key") as never),
                        descend,
                    );
            }
            if (op.kind === "remove") {
                const removeFn = East.function([t, StringType], t, ($, d, k) => {
                    const next = $.let((d as unknown as { copy: () => Expr }).copy());
                    $((next as unknown as { tryDelete: (k: Expr) => Expr })
                        .tryDelete(k as unknown as Expr));
                    return next as never;
                });
                return atEnd(si + 1)
                    .and(() => step().hasTag("key"))
                    .ifElse(
                        () => removeFn(v as never, step().unwrap("key") as never),
                        descend,
                    );
            }
            return descend();
        }
        case "Variant": {
            const cases = (t as { cases: Record<string, EastType> }).cases;
            const mv = v as unknown as { match: (h: unknown) => Expr };
            if (isOptionType(t)) {
                const inner = cases["some"]!;
                const descend = (): Expr => mv.match({
                    some: (_$: unknown, payload: Expr) => East.value(
                        some(rebuild(inner, payload, path, si + 1, depth, state, op)), t),
                    none: () => East.value(none, t),
                });
                if (op.kind === "tag") {
                    const zero = tryZeroExpr(inner);
                    const toSome: Expr = zero !== undefined
                        ? East.value(some(zero), t) as unknown as Expr
                        : v;
                    return atEnd(si).ifElse(
                        () => (op.tag as unknown as { equals: (s: string) => BoolView }).equals("some")
                            .ifElse(() => toSome, () => East.value(none, t)),
                        descend,
                    );
                }
                return descend();
            }
            const tags = Object.keys(cases);
            const descend = (): Expr => {
                const handlers: Record<string, unknown> = {};
                for (const tag of tags) {
                    handlers[tag] = (_$: unknown, payload: Expr) => East.value(
                        variant(tag, rebuild(cases[tag]!, payload, path, si + 1, depth, state, op)), t);
                }
                return mv.match(handlers);
            };
            if (op.kind === "tag") {
                let chain: Expr = v;
                for (const tag of [...tags].reverse()) {
                    const zero = tryZeroExpr(cases[tag]!);
                    if (zero === undefined) continue;
                    const target = East.value(variant(tag, zero), t) as unknown as Expr;
                    const prev = chain;
                    chain = (op.tag as unknown as { equals: (s: string) => BoolView }).equals(tag)
                        .ifElse(() => target, () => prev);
                }
                const tagChain = chain;
                return atEnd(si).ifElse(() => tagChain, descend);
            }
            return descend();
        }
        case "Recursive": {
            const inner = rebuild(
                (t as { node: EastType }).node,
                (v as unknown as { unwrap: () => Expr }).unwrap(),
                path, si, depth + 1, state, op,
            );
            // Field/element sites require the exact wrapped type — re-wrap
            // the rebuilt inner value (subtype transparency does not apply
            // to heap slots).
            return RecursiveExpr.wrap(inner as never, t as RecursiveType, Expr.fromAst) as unknown as Expr;
        }
        default:
            // Sets, blobs, vectors, matrices, refs, functions — read-only.
            return v;
    }
}

// ============================================================================
// Scoped handlers
// ============================================================================

/** One recorded step of a scope path (host-side; mirrors the editable
 *  subset of {@link ValueTreeStepType}). */
export type ValueTreeScopeStep =
    | { readonly kind: "field"; readonly name: string }
    | { readonly kind: "index"; readonly index: bigint }
    | { readonly kind: "key"; readonly key: string }
    | { readonly kind: "some" };

/**
 * A scoped subtree handler built by {@link ValueTree.at} — dispatched
 * when an edit lands at or below its path (deepest scope wins;
 * unmatched edits bubble to the root `onUpdate`).
 */
export interface ValueTreeScope {
    /** @internal Recorded path steps from the root. */
    readonly steps: readonly ValueTreeScopeStep[];
    /** @internal The subtree's East type at the recorded path. */
    readonly subtype: EastType;
    /** @internal The user's subtree handler (`FunctionType([S], Null)`). */
    readonly handler: unknown;
}

/**
 * The typed path probe passed to {@link ValueTree.at} accessors.
 * Navigation is structural over the value's static type: struct fields
 * are properties, `item(i)` addresses an array element, `entry(k)` a
 * dict entry, and `some()` an option's payload. RecursiveType wrappers
 * are transparent.
 *
 * @typeParam T - The East type at this probe position
 */
export type ValueTreeProbe<T> =
    T extends RecursiveType<infer U> ? ValueTreeProbe<U> :
    { readonly __vt?: T }
    & (T extends StructType<infer F> ? { readonly [K in keyof F]: ValueTreeProbe<F[K]> } : unknown)
    & (T extends ArrayType<infer U> ? { item(index: number | bigint): ValueTreeProbe<U> } : unknown)
    & (T extends DictType<StringType, infer V> ? { entry(key: string): ValueTreeProbe<V> } : unknown)
    & (T extends VariantType<{ none: NullType; some: infer U }> ? { some(): ValueTreeProbe<U> } : unknown);

/** Runtime probe: records navigation steps against the static type.
 *  Members are lazy (getters / closures) so recursive types terminate. */
function probeOf(t: EastType, steps: ValueTreeScopeStep[]): unknown {
    const probe: Record<string, unknown> = {};
    Object.defineProperty(probe, "__vtSubtype", { value: t, enumerable: false });
    Object.defineProperty(probe, "__vtSteps", { value: steps, enumerable: false });
    let ct = t;
    while (ct.type === "Recursive") ct = (ct as { node: EastType }).node;
    if (ct.type === "Struct") {
        for (const [name, ft] of Object.entries((ct as { fields: Record<string, EastType> }).fields)) {
            Object.defineProperty(probe, name, {
                get: () => probeOf(ft, [...steps, { kind: "field", name }]),
                enumerable: true,
            });
        }
    } else if (ct.type === "Array") {
        const elem = (ct as { value: EastType }).value;
        probe["item"] = (index: number | bigint) =>
            probeOf(elem, [...steps, { kind: "index", index: BigInt(index) }]);
    } else if (ct.type === "Dict") {
        const { key, value } = ct as { key: EastType; value: EastType };
        if (key.type === "String") {
            probe["entry"] = (k: string) => probeOf(value, [...steps, { kind: "key", key: k }]);
        }
    } else if (isOptionType(ct)) {
        const inner = (ct as { cases: Record<string, EastType> }).cases["some"]!;
        probe["some"] = () => probeOf(inner, [...steps, { kind: "some" }]);
    }
    return probe;
}

/**
 * Builds a scoped subtree handler for {@link ValueTree.Root}'s `at`
 * option: navigate the root type with the typed probe, and receive the
 * rebuilt SUBTREE at that path whenever an edit lands inside it.
 *
 * @typeParam T - The root value's East type
 * @typeParam S - The subtree type at the accessor's path (inferred)
 * @param root - The root value's East type (drives probe navigation)
 * @param path - Accessor over the typed probe selecting the subtree
 * @param onUpdate - Handler receiving the rebuilt subtree value
 * @returns An opaque scope for the `at` option
 *
 * @example
 * ```ts
 * import { East, DictType, StringType, FloatType, NullType } from "@elaraai/east";
 * import { ValueTree } from "@elaraai/east-ui";
 *
 * const RatesType = DictType(StringType, FloatType);
 * const scope = ValueTree.at(RatesType, p => p.entry("base"),
 *     East.function([FloatType], NullType, (_$, _next) => null));
 * ```
 */
function scopeAt<T extends EastType, S extends EastType>(
    root: T,
    path: (probe: ValueTreeProbe<T>) => { readonly __vt?: S },
    onUpdate: SubtypeExprOrValue<FunctionType<[S], NullType>>
        | SubtypeExprOrValue<AsyncFunctionType<[S], NullType>>,
): ValueTreeScope {
    const target = path(probeOf(root, []) as ValueTreeProbe<T>) as unknown as {
        __vtSubtype: EastType;
        __vtSteps: ValueTreeScopeStep[];
    };
    if (target?.__vtSteps === undefined) {
        throw new Error("ValueTree.at: the path accessor must return a probe position (e.g. p => p.machines)");
    }
    return { steps: target.__vtSteps, subtype: target.__vtSubtype, handler: onUpdate };
}

/** Walks the static type along scope steps (RecursiveType transparent);
 *  throws when a step does not fit the type — a scope built against a
 *  different root type than the tree's value. */
function navigateType(t: EastType, steps: readonly ValueTreeScopeStep[]): EastType {
    let ct = t;
    for (const st of steps) {
        while (ct.type === "Recursive") ct = (ct as { node: EastType }).node;
        if (st.kind === "field") {
            const ft = (ct as { fields?: Record<string, EastType> }).fields?.[st.name];
            if (ct.type !== "Struct" || ft === undefined) {
                throw new Error(`ValueTree.at: no struct field '${st.name}' at scope path`);
            }
            ct = ft;
        } else if (st.kind === "index") {
            if (ct.type !== "Array") throw new Error("ValueTree.at: 'item' step on a non-array at scope path");
            ct = (ct as { value: EastType }).value;
        } else if (st.kind === "key") {
            if (ct.type !== "Dict") throw new Error("ValueTree.at: 'entry' step on a non-dict at scope path");
            ct = (ct as { value: EastType }).value;
        } else {
            if (!isOptionType(ct)) throw new Error("ValueTree.at: 'some' step on a non-option at scope path");
            ct = (ct as { cases: Record<string, EastType> }).cases["some"]!;
        }
    }
    return ct;
}

/** Navigates a value expression along scope steps (RecursiveType
 *  unwrapped as consumed; the terminal value keeps its wrapper). */
function navigateExpr(root: Expr, t: EastType, steps: readonly ValueTreeScopeStep[]): Expr {
    let e = root;
    let ct = t;
    for (const st of steps) {
        while (ct.type === "Recursive") {
            e = (e as unknown as { unwrap: () => Expr }).unwrap();
            ct = (ct as unknown as { node: EastType }).node;
        }
        if (st.kind === "field") {
            e = (e as unknown as Record<string, Expr>)[st.name] as Expr;
            ct = (ct as { fields: Record<string, EastType> }).fields[st.name]!;
        } else if (st.kind === "index") {
            e = (e as unknown as { get: (i: bigint) => Expr }).get(st.index);
            ct = (ct as { value: EastType }).value;
        } else if (st.kind === "key") {
            e = (e as unknown as { get: (k: string) => Expr }).get(st.key);
            ct = (ct as { value: EastType }).value;
        } else {
            e = (e as unknown as { unwrap: (tag: string) => Expr }).unwrap("some");
            ct = (ct as { cases: Record<string, EastType> }).cases["some"]!;
        }
    }
    return e;
}

/** Runtime prefix-match condition for a scope against an edit path.
 *  `extra` is 1 for container ops (insert/remove: the affected element's
 *  container must sit strictly below the scope root — removing the
 *  scope's own subtree dispatches to its PARENT scope, whose value
 *  still exists) and 0 for edit/tag. */
function scopeMatch(path: Expr, scope: ValueTreeScope, extra: number): BoolView {
    const p = path as unknown as PathView;
    let cond: BoolView = p.size().greaterEqual(BigInt(scope.steps.length + extra)) as unknown as BoolView;
    scope.steps.forEach((st, i) => {
        const stepAt = () => p.get(BigInt(i));
        if (st.kind === "field") {
            cond = cond.and(() => stepAt().hasTag("field")
                .and(() => (stepAt().unwrap("field") as unknown as { equals: (s: string) => Expr }).equals(st.name)));
        } else if (st.kind === "index") {
            cond = cond.and(() => stepAt().hasTag("index")
                .and(() => (stepAt().unwrap("index") as unknown as { equals: (n: bigint) => Expr }).equals(st.index)));
        } else if (st.kind === "key") {
            cond = cond.and(() => stepAt().hasTag("key")
                .and(() => (stepAt().unwrap("key") as unknown as { equals: (s: string) => Expr }).equals(st.key)));
        } else {
            cond = cond.and(() => stepAt().hasTag("some"));
        }
    });
    return cond;
}

/** Invokes a user handler expression (`FunctionType` value) with one arg. */
function callHandler(handler: unknown, arg: Expr): Expr {
    const fn = East.value(handler as never) as unknown as { call: (a: Expr) => Expr };
    return fn.call(arg);
}

// ============================================================================
// Options
// ============================================================================

/**
 * Options for {@link ValueTree.Root}.
 *
 * @typeParam T - The value's East type (drives the handler signatures)
 *
 * @property onUpdate - Whole-value handler: every edit arrives as the
 *   fully rebuilt value (the default sink when no `at` scope matches)
 * @property at - Scoped subtree handlers ({@link ValueTree.at}); the
 *   deepest scope whose path prefixes the edit path receives the rebuilt
 *   subtree, unmatched edits bubble to `onUpdate`
 * @property onEdit - RAW leaf edit callback: the node path + the new leaf
 *   value (overrides the generated handler for leaf edits)
 * @property onInsert - RAW append/insert callback: array paths end with an
 *   `append` step, dict paths with the new `key` step
 * @property onRemove - RAW remove callback with the element/entry path
 * @property onTag - RAW variant tag switch (and option toggle:
 *   "some"/"none") with the node path and the new tag
 * @property style - Layout style (height / maxHeight)
 */
export interface ValueTreeOptions<T extends EastType = EastType> {
    /** Whole-value handler — receives the rebuilt value after every edit */
    onUpdate?: SubtypeExprOrValue<FunctionType<[T], NullType>>
        | SubtypeExprOrValue<AsyncFunctionType<[T], NullType>>;
    /** Scoped subtree handlers (deepest match wins, else `onUpdate`) */
    at?: readonly ValueTreeScope[];
    /** RAW leaf edit callback: node path + new leaf value */
    onEdit?: SubtypeExprOrValue<FunctionType<[ValueTreePathType, ValueTreeLeafType], NullType>>
        | SubtypeExprOrValue<AsyncFunctionType<[ValueTreePathType, ValueTreeLeafType], NullType>>;
    /** RAW append/insert callback (array `append` / dict new-`key` paths) */
    onInsert?: SubtypeExprOrValue<FunctionType<[ValueTreePathType], NullType>>
        | SubtypeExprOrValue<AsyncFunctionType<[ValueTreePathType], NullType>>;
    /** RAW remove callback with the element/entry path */
    onRemove?: SubtypeExprOrValue<FunctionType<[ValueTreePathType], NullType>>
        | SubtypeExprOrValue<AsyncFunctionType<[ValueTreePathType], NullType>>;
    /** RAW variant tag switch / option toggle callback */
    onTag?: SubtypeExprOrValue<FunctionType<[ValueTreePathType, StringType], NullType>>
        | SubtypeExprOrValue<AsyncFunctionType<[ValueTreePathType, StringType], NullType>>;
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
 * @param options - Value handlers, raw path callbacks + style
 *   ({@link ValueTreeOptions})
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
    options?: ValueTreeOptions<T>,
): ExprType<UIComponentType> {
    const v = East.value(value as never) as Expr;
    const t = Expr.type(v) as EastType;
    const root = nodeOf(t, v, 0, { budget: MAX_MATERIALIZED_NODES });

    const scopes = options?.at ?? [];
    for (const scope of scopes) {
        // Fail at authoring time when a scope was built against a
        // different root type than the tree's value.
        navigateType(t, scope.steps);
    }
    const wantsGenerated = options?.onUpdate !== undefined || scopes.length > 0;

    /** Statement-level dispatch view of a block builder — handler calls
     *  are async effects, so they must sit at STATEMENT positions where
     *  the async compiler awaits them (never inside an expression chain). */
    interface BlockView {
        (expr: Expr): void;
        if: (cond: Expr, then: ($: BlockView) => void) => { else: (fn: ($: BlockView) => void) => void };
    }

    /** Deepest-first dispatch: scoped handlers, then `onUpdate`. */
    const emitDispatch = ($: BlockView, path: Expr, newRoot: Expr, extra: number): void => {
        const ordered = [...scopes].sort((a, b) => b.steps.length - a.steps.length);
        const emit = ($b: BlockView, remaining: readonly ValueTreeScope[]): void => {
            const scope = remaining[0];
            if (scope === undefined) {
                if (options?.onUpdate !== undefined) {
                    $b(callHandler(options.onUpdate, newRoot));
                }
                return;
            }
            const subtree = navigateExpr(newRoot, t, scope.steps);
            $b.if(scopeMatch(path, scope, extra) as unknown as Expr, ($t) => {
                $t(callHandler(scope.handler, subtree));
            }).else(($e) => {
                emit($e, remaining.slice(1));
            });
        };
        emit($, ordered);
    };

    // Generated wrappers are ASYNC: user handlers routinely write State
    // (an async platform effect), and sync handlers are subtypes.
    const genOnEdit = () => East.asyncFunction([ValueTreePathType, ValueTreeLeafType], NullType, ($, p, leaf) => {
        const next = $.let(rebuild(t, v, p as unknown as Expr, 0, 0,
            { budget: MAX_REBUILD_NODES }, { kind: "edit", leaf }));
        emitDispatch($ as unknown as BlockView, p as unknown as Expr, next as unknown as Expr, 0);
    });
    const genOnInsert = () => East.asyncFunction([ValueTreePathType], NullType, ($, p) => {
        const next = $.let(rebuild(t, v, p as unknown as Expr, 0, 0,
            { budget: MAX_REBUILD_NODES }, { kind: "insert" }));
        emitDispatch($ as unknown as BlockView, p as unknown as Expr, next as unknown as Expr, 1);
    });
    const genOnRemove = () => East.asyncFunction([ValueTreePathType], NullType, ($, p) => {
        const next = $.let(rebuild(t, v, p as unknown as Expr, 0, 0,
            { budget: MAX_REBUILD_NODES }, { kind: "remove" }));
        emitDispatch($ as unknown as BlockView, p as unknown as Expr, next as unknown as Expr, 1);
    });
    const genOnTag = () => East.asyncFunction([ValueTreePathType, StringType], NullType, ($, p, tag) => {
        const next = $.let(rebuild(t, v, p as unknown as Expr, 0, 0,
            { budget: MAX_REBUILD_NODES }, { kind: "tag", tag }));
        emitDispatch($ as unknown as BlockView, p as unknown as Expr, next as unknown as Expr, 0);
    });

    const onEdit = options?.onEdit ?? (wantsGenerated ? genOnEdit() : undefined);
    const onInsert = options?.onInsert ?? (wantsGenerated ? genOnInsert() : undefined);
    const onRemove = options?.onRemove ?? (wantsGenerated ? genOnRemove() : undefined);
    const onTag = options?.onTag ?? (wantsGenerated ? genOnTag() : undefined);

    const style = options?.style;
    // Sync raw callbacks widen into the async slots at runtime
    // (FunctionType <: AsyncFunctionType) — the casts only quiet TS.
    return East.value(variant("ValueTree", {
        root,
        onEdit: onEdit !== undefined ? some(onEdit as never) : none,
        onInsert: onInsert !== undefined ? some(onInsert as never) : none,
        onRemove: onRemove !== undefined ? some(onRemove as never) : none,
        onTag: onTag !== undefined ? some(onTag as never) : none,
        style: style !== undefined ? some(East.value({
            height: style.height !== undefined ? some(style.height) : none,
            maxHeight: style.maxHeight !== undefined ? some(style.maxHeight) : none,
        }, ValueTreeStyleType)) : none,
    }), UIComponentType);
}

/**
 * A host-side zero value for any East data type — the default payload
 * for inserted elements, toggled options and switched variant cases.
 *
 * @param t - The East type to zero
 * @returns The TypeScript `ValueTypeOf` zero value
 * @throws When the type has no default (functions; recursion below the
 *   top level)
 *
 * @remarks
 * Delegates to east's {@link defaultValue} (option variants default to
 * `none` — their sorted first case), unrolling a top-level
 * RecursiveType wrapper first.
 */
function zeroValue<T extends EastType>(t: T): ValueTypeOf<T> {
    let ct: EastType = t;
    while (ct.type === "Recursive") ct = (ct as { node: EastType }).node;
    return defaultValue(ct) as ValueTypeOf<T>;
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * ValueTree component namespace.
 *
 * @remarks
 * `ValueTree.Root(value, options)` materializes any East value into the
 * editable tree; `ValueTree.at(Type, p => …, handler)` builds a scoped
 * subtree handler for the `at` option; `ValueTree.zero(Type)` builds
 * the host-side default element for raw `onInsert` handlers.
 */
export const ValueTree = {
    /**
     * Creates a ValueTree — the editable tree of any East value.
     *
     * @param value - The value to materialize (any East type)
     * @param options - Value handlers, raw callbacks + style
     *   ({@link ValueTreeOptions})
     * @returns An East expression of `UIComponentType`
     */
    Root: createValueTree,
    /**
     * Builds a scoped subtree handler for the `at` option — the deepest
     * scope whose path prefixes an edit's path receives the rebuilt
     * subtree; unmatched edits bubble to `onUpdate`.
     */
    at: scopeAt,
    /** Host-side zero value for any East type (for raw `onInsert` handlers). */
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
