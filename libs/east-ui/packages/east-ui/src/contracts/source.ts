/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ROW-SOURCE contract (#567) — how a collection component takes its rows.
 *
 * A component's `rows` / `data` prop accepts an inline collection or a WINDOWED
 * source, and this module is the one place that vocabulary is spelled. Both are
 * parameterised on the COLLECTION the component speaks — an `Array<Row>` for a
 * positional surface, a `Dict<String, Row>` for a keyed one (#568). east-ui
 * declares the shape; whoever can actually fetch windows produces a value of
 * it. `Data.bindPaged` in `@elaraai/e3-ui` is the production implementation
 * (dataset windows over an e3 workspace) and {@link Paged.of} is the in-memory
 * one; neither is named here, and **nothing in this file imports e3**.
 *
 * # Why a variant, not a narrow struct
 *
 * East struct subtyping is EXACT — same arity, same field names, same order
 * (`types.ts`'s `isSubtypeImpl`: `if (e1.length !== e2.length) return false`).
 * Variants get width subtyping. So a narrow "source" struct could never be
 * *satisfied* by a wider handle, and there is no `extends` to lean on. The
 * component prop therefore takes a {@link RowSourceType} VARIANT, and the
 * factory wraps whatever it was handed into the right arm at build time
 * ({@link resolveRowSource}) — the same shape `Plan`'s rows channel already
 * uses. What lands in the IR is a tagged union the renderer matches
 * exhaustively, never a shape it has to sniff.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    ArrayType,
    BooleanType,
    DictType,
    FunctionType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    variant,
    some,
    none,
} from "@elaraai/east";

// ============================================================================
// Seek — where a key lands in a source's row space
// ============================================================================

/**
 * Where a key query landed in a source's canonical row order.
 *
 * @remarks
 * The RANGE, not just a row: a prefix query matches a contiguous run, and the
 * search chrome needs `count` for its "k of n" indicator and its prev/next
 * stepping. `found: false` still carries a `row` — the query's insertion point
 * — so a miss can still position the viewport.
 *
 * @property found - Whether any row matched.
 * @property row - First matched row (a miss carries the insertion row).
 * @property count - Number of matched rows (1/0 for an exact key).
 */
export const SeekRangeType = StructType({
    found: BooleanType,
    row:   IntegerType,
    count: IntegerType,
});
/** Type alias for {@link SeekRangeType}. */
export type SeekRangeType = typeof SeekRangeType;

// ============================================================================
// The paged source
// ============================================================================

/**
 * A WINDOWED view of a row collection — the contract a component consumes when
 * the source is too large to hold whole.
 *
 * @remarks
 * Deliberately read-only: a window is not a value you can diff or stage.
 *
 * Parameterised on the COLLECTION, not on the row: a window of an `Array<R>`
 * dataset is an `Array<R>`, a window of a `Dict<K, V>` dataset is a
 * `Dict<K, V>`, and the Plan's canvas windows are `Dict<String, PlanRow>`
 * (#568). That is what `Data.bindPaged` already produces — it returns
 * `Option<T>` at the dataset's own type — so the contract matches the producer
 * instead of narrowing it to arrays.
 *
 * `page` and `total` follow the in-flight-is-`none` convention: a window still
 * being fetched reads `none` and the call re-fires when it lands, so the reads
 * belong inside a tracked evaluation. An EMPTY window (`some([])`) means the
 * source is exhausted at that offset — a reader that walks offsets terminates
 * on an empty window, never on `none`.
 *
 * @typeParam C - The collection type one window carries.
 * @param c - The collection type value.
 * @returns The concrete `StructType` of a paged source over `c`.
 *
 * @property id - Comparable identity (a dataset path, a fixture name). East
 *   compares every function as EQUAL, so a struct of nothing but closures is
 *   indistinguishable from any other — without this field a memoized component
 *   never re-renders when the source is swapped, and a window cache cannot key
 *   itself. Two sources with the same `id` must serve the same rows.
 * @property page - `(offset, limit)` → that window's elements as a value of the
 *   collection type; `none` while in flight, an EMPTY collection at exhaustion.
 * @property total - The source's total element count, once known; `none` until then.
 * @property seek - Locate a key in the source's row order — `none` on the
 *   OUTER option when the source is not key-ordered (an Array-backed source
 *   cannot seek; there is nothing to search). Present ⇒ calling it returns
 *   `none` while resolving and `some(range)` when it lands.
 */
export const PagedSourceType = <C extends EastType>(c: C) => StructType({
    id:    StringType,
    page:  FunctionType([IntegerType, IntegerType], OptionType(c)),
    total: FunctionType([], OptionType(IntegerType)),
    seek:  OptionType(FunctionType([StringType], OptionType(SeekRangeType))),
});

/**
 * The TypeScript type of a {@link PagedSourceType} over collection type `C` —
 * what a component's prop takes when it wants a windowed source specifically.
 *
 * @remarks
 * `C` rides STRUCTURALLY, in the `page` signature, so a source bound to one
 * collection type is a compile error against a component expecting another. The
 * identity lives in the East type rather than a phantom brand, so it survives
 * `$.let` / `$.const` and ordinary expression plumbing.
 *
 * @typeParam C - The collection type one window carries.
 */
export type PagedSource<C extends EastType> = ExprType<ReturnType<typeof PagedSourceType<C>>>;

// ============================================================================
// The row-source variant — what components actually store
// ============================================================================

/**
 * How a component's rows arrive: inline, or from a windowed source.
 *
 * @remarks
 * Both arms speak the same COLLECTION type — inline is the whole of it, paged
 * is a window of it — so a component that keys its rows (the Plan's
 * `Dict<String, PlanRow>`) and one that positions them (`Array<Row>`) share one
 * vocabulary without either shape leaking into the arm names (#568).
 *
 * @typeParam C - The collection type.
 * @param c - The collection type value.
 * @returns The concrete `VariantType` of a row source over `c`.
 *
 * @property inline - The whole collection, already in hand.
 * @property paged - A {@link PagedSourceType} fetched a window at a time.
 */
export const RowSourceType = <C extends EastType>(c: C) => VariantType({
    inline: c,
    paged:  PagedSourceType(c),
});

/**
 * The TypeScript type of a {@link RowSourceType} over collection type `C`.
 *
 * @typeParam C - The collection type.
 */
export type RowSource<C extends EastType> = ExprType<ReturnType<typeof RowSourceType<C>>>;

// ============================================================================
// Build-time resolution
// ============================================================================

/**
 * The loose TS face a paged source presents at a `rows` / `data` prop —
 * structural only (`page` / `total`, which a concrete source expression
 * exposes and an array expression does not). {@link resolveRowSource}'s
 * `Expr.type` dispatch is the real check.
 */
export interface PagedSourceLike {
    /** The source's page method (typed precisely on the concrete value). */
    readonly page: unknown;
    /** The source's total method. */
    readonly total: unknown;
}

/**
 * What a component's rows prop accepts: an inline collection expression, a
 * paged source, or a whole-value bind handle (anything with a `read`).
 *
 * @typeParam C - The collection type.
 */
export type RowSourceInput<C extends EastType> =
    | SubtypeExprOrValue<C>
    | PagedSourceLike;

/**
 * A resolved rows prop — the arm, the COLLECTION type the source speaks, the
 * element type recovered from it (an `Array`'s value, a `Set`'s key, a
 * `Dict`'s value), and its KEY type when it has one.
 *
 * `keyType` is what a keyed component checks: the Plan requires
 * `Dict<String, R>` because its canvas rows inherit the source's keys, so an
 * unkeyed source is refused rather than silently re-keyed (#568).
 */
export type ResolvedRowSource =
    | { kind: "inline"; rows: ExprType<EastType>; collectionType: EastType; elementType: EastType; keyType: EastType | undefined }
    | { kind: "paged"; source: ExprType<StructType>; collectionType: EastType; elementType: EastType; keyType: EastType | undefined };

/** A struct expression's field types, or undefined when it isn't a struct. */
function structFields(t: unknown): Record<string, EastType> | undefined {
    const type = t as { type?: string; fields?: Record<string, EastType> };
    return type.type === "Struct" ? (type.fields ?? {}) : undefined;
}

/**
 * A collection type's ELEMENT type — what one row of it is. `undefined` for
 * anything that is not a collection.
 */
function elementTypeOf(t: EastType | undefined): EastType | undefined {
    const type = t as { type?: string; key?: EastType; value?: EastType } | undefined;
    if (type === undefined) return undefined;
    if (type.type === "Array") return type.value;
    if (type.type === "Dict") return type.value;
    if (type.type === "Set") return type.key;
    return undefined;
}

/**
 * A collection type's KEY type — a `Dict`'s key, a `Set`'s element (a set IS
 * its keys). `undefined` for an `Array`, which is positional and has none.
 */
function keyTypeOf(t: EastType | undefined): EastType | undefined {
    const type = t as { type?: string; key?: EastType } | undefined;
    if (type === undefined) return undefined;
    if (type.type === "Dict" || type.type === "Set") return type.key;
    return undefined;
}

/**
 * Classify a component's rows prop at BUILD time — the one dispatch every
 * collection shares, so no component re-sniffs shapes of its own.
 *
 * Accepted shapes, in order:
 * - a collection expression / value (`Array<R>`, `Dict<K, V>`, `Set<R>`) ⇒ `inline`;
 * - a struct carrying `page` + `total` ⇒ `paged` (a {@link PagedSourceType},
 *   or anything structurally matching it — `Data.bindPaged`'s handle);
 * - a struct carrying `read` ⇒ a whole-value bind handle, which resolves by
 *   CALLING `read()` and recursing. The call becomes part of the surrounding
 *   East expression, so it is evaluated inside the component's reactive render
 *   and re-fires like any other tracked read — `rows={handle}` and
 *   `rows={handle.read()}` build the same IR.
 *
 * @param data - The rows prop as the author passed it
 * @param label - Component name for the error message (`"Plan"`, `"Table"`)
 * @returns The resolved arm — see {@link ResolvedRowSource}
 * @throws Error when the expression is none of the accepted shapes
 */
export function resolveRowSource(data: unknown, label: string): ResolvedRowSource {
    const expr = East.value(data as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    const t = Expr.type(expr) as EastType & { type: string };
    const inlineElement = elementTypeOf(t);
    if (inlineElement !== undefined) {
        return { kind: "inline", rows: expr, collectionType: t, elementType: inlineElement, keyType: keyTypeOf(t) };
    }
    const fields = structFields(t);
    if (fields !== undefined && fields["page"] !== undefined && fields["total"] !== undefined) {
        // `page: Fn([Int, Int], Option<C>)` — recover the COLLECTION through
        // it, then its element type. An Option is a VARIANT (`cases.some`), not
        // a struct, so the collection hangs off the `some` case.
        const page = fields["page"] as { output?: { cases?: { some?: EastType } } };
        const collectionType = page.output?.cases?.some;
        const elementType = elementTypeOf(collectionType);
        if (collectionType === undefined || elementType === undefined) {
            throw new Error(
                `${label}: the paged source's \`page\` must return \`Option<Collection>\` ` +
                `(an Array, Dict or Set) — got ${JSON.stringify(page)}`,
            );
        }
        return {
            kind: "paged", source: expr as unknown as ExprType<StructType>,
            collectionType, elementType, keyType: keyTypeOf(collectionType),
        };
    }
    if (fields !== undefined && fields["read"] !== undefined) {
        // A whole-value bind handle (`Data.bind`) — read it here, in the
        // surrounding East expression, and resolve the result.
        const handle = expr as unknown as ExprType<StructType<{ read: FunctionType<[], ArrayType<EastType>> }>>;
        return resolveRowSource(handle.read(), label);
    }
    throw new Error(
        `${label}: rows must be a collection, a paged source (\`{ id, page, total }\` — e.g. Data.bindPaged), ` +
        `or a bound value (\`{ read }\` — e.g. Data.bind); got a ${t.type}`,
    );
}

/**
 * Wrap a resolved rows prop into the {@link RowSourceType} arm a component
 * stores, mapping each window through the same `make` the inline arm applies
 * to the whole collection.
 *
 * @remarks
 * `make` is the component's own row-construction pipeline (Table's
 * `rows_mapped`, Plan's `applySeries`). Applying it inside `page` is the single
 * point where the DOMAIN collection is erased to the component's row
 * COLLECTION, so everything downstream — the renderer, the window cache — sees
 * one row space.
 *
 * It is handed the source's COLLECTION, not a flattened element array: a keyed
 * component's rows inherit the source's keys, and flattening at the boundary
 * would throw away exactly what makes a window's rows addressable (#568). A
 * positional component (Table) receives its `Array<Row>`; a keyed one (Plan) a
 * `Dict<String, R>`.
 *
 * @typeParam Out - The component's own row COLLECTION type.
 * @param resolved - The output of {@link resolveRowSource}
 * @param outType - The component's row collection type
 * @param make - The source collection → the component's row collection
 * @returns The `RowSourceType(outType)` value to store in the IR
 */
export function buildRowSource<Out extends EastType>(
    resolved: ResolvedRowSource,
    outType: Out,
    make: (collection: ExprType<EastType>) => SubtypeExprOrValue<Out>,
): RowSource<Out> {
    const sourceType = RowSourceType(outType);
    if (resolved.kind === "inline") {
        return East.value(
            variant("inline", make(resolved.rows)) as never,
            sourceType,
        ) as RowSource<Out>;
    }
    const handle = resolved.source as unknown as ExprType<StructType<{
        id: StringType;
        page: FunctionType<[IntegerType, IntegerType], OptionType<EastType>>;
        total: FunctionType<[], OptionType<IntegerType>>;
        seek: OptionType<FunctionType<[StringType], OptionType<SeekRangeType>>>;
    }>>;
    // Erased locally: the window type is `Out`, but TS cannot see through the
    // generic to unify `Option<Out>`'s arms — the East type is what types it.
    const winType: EastType = outType;
    const page = East.function([IntegerType, IntegerType], OptionType(winType), ($, offset, limit) => {
        const empty = $.const(none, OptionType(winType));
        const win = $.let(handle.page(offset, limit));
        return win.match({
            some: ($, window) => {
                const built = $.let(make(window as ExprType<EastType>), outType);
                return $.const(some(built), OptionType(winType));
            },
            none: (_$) => empty,
        });
    });
    // A source predating the contract carries no `id` / `seek`; fall back to a
    // constant identity (it still compares equal to itself) and no seek.
    const fields = structFields(Expr.type(resolved.source)) ?? {};
    const id = fields["id"] !== undefined ? handle.id : East.value("", StringType);
    const seek = fields["seek"] !== undefined
        ? handle.seek
        : East.value(none, OptionType(FunctionType([StringType], OptionType(SeekRangeType))));
    return East.value(
        variant("paged", { id, page, total: handle.total, seek }) as never,
        sourceType,
    ) as RowSource<Out>;
}

// ============================================================================
// Paged.of — the in-memory source
// ============================================================================

/** Options for the ARRAY form of {@link Paged.of}. */
export interface PagedOfOptions<R extends EastType> {
    /**
     * Key accessor. Supplying it declares the rows are SORTED by that key and
     * enables `seek` (prefix-matched, the canonical key order the search
     * chrome expects). Omitted ⇒ `seek` is `none`, exactly as an
     * Array-backed dataset behaves.
     *
     * A keyed collection needs none of this — pass a `Dict` and its own keys
     * are the row order and the search space.
     */
    key?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
}

/**
 * Build an in-memory {@link PagedSourceType} over a collection already in hand
 * — the paged sibling of passing the array directly.
 *
 * @remarks
 * Every window resolves immediately (`page` never returns `none`), so this is
 * the source to reach for in examples, fixtures and tests: it exercises the
 * whole paged path — windowing, exhaustion on `some([])`, totals, seek — with
 * no server, no platform function and no bind. `@elaraai/e3-ui`'s
 * `Data.bindPaged` is the same contract backed by real dataset windows.
 *
 * Windows follow the collection: an `Array` source serves array windows in
 * stream order, a `Dict` source serves DICT windows in canonical key order —
 * the same shape and the same order a keyed dataset's windows arrive in, which
 * is what a keyed component (the Plan) requires of its source (#568).
 *
 * @typeParam R - The row type (array form) / the value type (dict form).
 * @param id - Comparable identity for this source (see {@link PagedSourceType}).
 * @param collection - The whole collection — an `Array<R>` or a `Dict<String, R>`.
 * @param options - {@link PagedOfOptions} — array form only; supply `key` to enable `seek`.
 * @returns A `PagedSourceType` at the collection it was given.
 *
 * @example
 * ```tsx
 * // A keyed source: the canvas rows inherit these keys, so `seek` addresses
 * // real rows and a window's key range is a canvas key range.
 * const units = $.const(new Map([["UNIT-001", { … }]]), DictType(StringType, UnitRow));
 * const source = $.const(Paged.of("units", units));
 * // A paged canvas declares its window — fitting the axis to a partial
 * // prefix would re-fit it on every landed window (#567 D8).
 * const axis = $.const(Plan.axis({ window: { min: W27, max: W39 }, resolution: "week" }));
 * return <Plan axis={axis} data={source} series={series} style={{ height: "fill" }} />;
 * ```
 */
function createPagedOf<R extends EastType>(
    id: SubtypeExprOrValue<StringType>,
    rows: SubtypeExprOrValue<ArrayType<R>>,
    options?: PagedOfOptions<R>,
): PagedSource<ArrayType<R>>;
function createPagedOf<V extends EastType>(
    id: SubtypeExprOrValue<StringType>,
    entries: SubtypeExprOrValue<DictType<StringType, V>>,
): PagedSource<DictType<StringType, V>>;
function createPagedOf(
    id: SubtypeExprOrValue<StringType>,
    collection: SubtypeExprOrValue<EastType>,
    options?: PagedOfOptions<EastType>,
    // The erased implementation signature: `PagedSource<C>` is invariant in
    // `C`, so neither overload's return is assignable to a common one. The
    // overloads above are what callers see.
): any {
    const collectionExpr = East.value(collection as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    if ((Expr.type(collectionExpr) as { type: string }).type === "Dict") {
        return keyedPagedOf(id, collectionExpr as unknown as ExprType<EastType>);
    }
    return arrayPagedOf(id, collectionExpr, options);
}

/**
 * The KEYED in-memory source — dict windows in canonical key order, with
 * `seek` derived from the keys themselves (a keyed collection needs no key
 * accessor: it already is one).
 */
function keyedPagedOf(
    id: SubtypeExprOrValue<StringType>,
    collection: ExprType<EastType>,
): PagedSource<EastType> {
    const all = collection as unknown as ExprType<DictType<StringType, EastType>>;
    const valueType: EastType = (Expr.type(all) as DictType<StringType, EastType>).value;
    const dictType = DictType(StringType, valueType);
    const entryType = StructType({ key: StringType, value: valueType });
    const entriesType = ArrayType(entryType);
    // Built OUTSIDE every block (an East macro inside one splices per use).
    const keyOfEntry = East.function([entryType], StringType, (_$, e) => e.key);
    const page = East.function([IntegerType, IntegerType], OptionType(dictType), ($, offset, limit) => {
        const src = $.const(all, dictType);
        // `toArray` walks the dictionary in key order, so the window a given
        // offset serves is the window a keyed dataset would serve.
        const entries = $.let(src.toArray(($2, v, k) => $2.const({ key: k, value: v }, entryType)), entriesType);
        const n = $.let(entries.length(), IntegerType);
        const start = $.let(offset.less(n).ifElse(() => offset, () => n), IntegerType);
        const rawEnd = $.let(offset.add(limit), IntegerType);
        const end = $.let(rawEnd.less(n).ifElse(() => rawEnd, () => n), IntegerType);
        // In-memory windows are never in flight; an exhausted offset yields
        // the EMPTY window, which is how a walking reader terminates.
        const win = $.let(entries.slice(start, end), entriesType);
        return some(win.toDict((_$, e) => e.key, (_$, e) => e.value));
    });
    const total = East.function([], OptionType(IntegerType), ($) => {
        const src = $.const(all, dictType);
        return some(src.size());
    });
    const seek = some(East.function([StringType], OptionType(SeekRangeType), ($, query) => {
        const src = $.const(all, dictType);
        const entries = $.let(src.toArray(($2, v, k) => $2.const({ key: k, value: v }, entryType)), entriesType);
        const by = $.const(keyOfEntry);
        // Key order ⇒ the first entry at-or-after the query starts the matching
        // run, and the run is contiguous, so counting the entries that still
        // carry the prefix counts exactly the matches.
        const first = $.let(entries.findSortedFirst(query, by), IntegerType);
        const tail = $.let(entries.slice(first, entries.length()), entriesType);
        const matched = $.let(tail.filter((_$, e) => e.key.startsWith(query)), entriesType);
        const count = $.let(matched.length(), IntegerType);
        const range = $.let({ found: count.greater(0n), row: first, count }, SeekRangeType);
        return some(range);
    }));
    return East.value({ id, page, total, seek }, PagedSourceType(dictType)) as unknown as PagedSource<EastType>;
}

/** The POSITIONAL in-memory source — array windows in stream order. */
function arrayPagedOf(
    id: SubtypeExprOrValue<StringType>,
    rows: ExprType<ArrayType<EastType>>,
    options?: PagedOfOptions<EastType>,
): PagedSource<EastType> {
    const all = rows;
    const rowType: EastType = (Expr.type(all) as ArrayType<EastType>).value;
    const rowsType = ArrayType(rowType);
    // Built OUTSIDE every block: constructing East IR inside one is an
    // authoring-time macro. Inside, each body binds it once with `$.const`.
    const keyOf = options?.key;
    const byFn = keyOf === undefined
        ? undefined
        : East.function([rowType], StringType, (_$, r) => keyOf(r));
    const page = East.function([IntegerType, IntegerType], OptionType(rowsType), ($, offset, limit) => {
        const src = $.const(all, rowsType);
        const n = $.let(src.length(), IntegerType);
        const start = $.let(offset.less(n).ifElse(() => offset, () => n), IntegerType);
        const rawEnd = $.let(offset.add(limit), IntegerType);
        const end = $.let(rawEnd.less(n).ifElse(() => rawEnd, () => n), IntegerType);
        // In-memory windows are never in flight; an exhausted offset yields
        // the EMPTY window, which is how a walking reader terminates.
        const win = $.let(src.slice(start, end), rowsType);
        return some(win);
    });
    const total = East.function([], OptionType(IntegerType), ($) => {
        const src = $.const(all, rowsType);
        return some(src.length());
    });
    const seek = byFn === undefined
        ? East.value(none, OptionType(FunctionType([StringType], OptionType(SeekRangeType))))
        : some(East.function([StringType], OptionType(SeekRangeType), ($, query) => {
            const src = $.const(all, rowsType);
            const by = $.const(byFn);
            // Sorted by key ⇒ the first row at-or-after the query starts the
            // matching run, and the run is contiguous, so counting the rows
            // that still carry the prefix counts exactly the matches.
            const first = $.let(src.findSortedFirst(query, by), IntegerType);
            const tail = $.let(src.slice(first, src.length()), rowsType);
            const matched = $.let(tail.filter((_$, r) => by(r).startsWith(query)), rowsType);
            const count = $.let(matched.length(), IntegerType);
            const range = $.let({ found: count.greater(0n), row: first, count }, SeekRangeType);
            return some(range);
        }));
    // Two-step cast (the `Data.bindPaged` idiom): the members are built
    // against the row type recovered from the expression, which TS sees as the
    // erased `EastType` rather than the caller's `R`. The East-side type —
    // `PagedSourceType(rowsType)` — is what actually types the value.
    return East.value({ id, page, total, seek }, PagedSourceType(rowsType)) as unknown as PagedSource<EastType>;
}

/**
 * The `Paged` namespace — building a {@link PagedSourceType} without a server.
 *
 * @remarks
 * The contract itself is what components consume; this namespace is the
 * in-memory producer. Production sources come from the platform that owns the
 * data (`Data.bindPaged` in `@elaraai/e3-ui`).
 */
export const Paged = {
    /** Build an in-memory paged source over a collection already in hand. */
    of: createPagedOf,
    /** East types — the contract, for `$.const` / `$.let` annotations. */
    Types: {
        /** A windowed row source over a collection type. */
        Source: PagedSourceType,
        /** Where a key query landed in a source's row order. */
        SeekRange: SeekRangeType,
        /** How a component's rows arrive (inline / paged), at a collection type. */
        RowSource: RowSourceType,
    },
} as const;
