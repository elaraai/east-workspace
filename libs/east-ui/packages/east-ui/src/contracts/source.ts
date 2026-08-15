/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ROW-SOURCE contract (#567) — how a collection component takes its rows.
 *
 * A component's `rows` / `data` prop accepts an inline collection or a WINDOWED
 * source, and this module is the one place that vocabulary is spelled. east-ui
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
 * `page` and `total` follow the in-flight-is-`none` convention: a window still
 * being fetched reads `none` and the call re-fires when it lands, so the reads
 * belong inside a tracked evaluation. An EMPTY window (`some([])`) means the
 * source is exhausted at that offset — a reader that walks offsets terminates
 * on `some([])`, never on `none`.
 *
 * @typeParam R - The row type.
 * @param r - The row type value.
 * @returns The concrete `StructType` of a paged source over `r`.
 *
 * @property id - Comparable identity (a dataset path, a fixture name). East
 *   compares every function as EQUAL, so a struct of nothing but closures is
 *   indistinguishable from any other — without this field a memoized component
 *   never re-renders when the source is swapped, and a window cache cannot key
 *   itself. Two sources with the same `id` must serve the same rows.
 * @property page - `(offset, limit)` → that window's rows; `none` while in
 *   flight, `some([])` at exhaustion.
 * @property total - The source's total row count, once known; `none` until then.
 * @property seek - Locate a key in the source's row order — `none` on the
 *   OUTER option when the source is not key-ordered (an Array-backed source
 *   cannot seek; there is nothing to search). Present ⇒ calling it returns
 *   `none` while resolving and `some(range)` when it lands.
 */
export const PagedSourceType = <R extends EastType>(r: R) => StructType({
    id:    StringType,
    page:  FunctionType([IntegerType, IntegerType], OptionType(ArrayType(r))),
    total: FunctionType([], OptionType(IntegerType)),
    seek:  OptionType(FunctionType([StringType], OptionType(SeekRangeType))),
});

/**
 * The TypeScript type of a {@link PagedSourceType} over row type `R` — what a
 * component's prop takes when it wants a windowed source specifically.
 *
 * @remarks
 * `R` rides STRUCTURALLY, in the `page` signature, so a source bound to one row
 * type is a compile error against a component expecting another. The identity
 * lives in the East type rather than a phantom brand, so it survives `$.let` /
 * `$.const` and ordinary expression plumbing.
 *
 * @typeParam R - The row type.
 */
export type PagedSource<R extends EastType> = ExprType<ReturnType<typeof PagedSourceType<R>>>;

// ============================================================================
// The row-source variant — what components actually store
// ============================================================================

/**
 * How a component's rows arrive: inline, or from a windowed source.
 *
 * @typeParam R - The row type.
 * @param r - The row type value.
 * @returns The concrete `VariantType` of a row source over `r`.
 *
 * @property inline - The whole collection, already in hand.
 * @property paged - A {@link PagedSourceType} fetched a window at a time.
 */
export const RowSourceType = <R extends EastType>(r: R) => VariantType({
    inline: ArrayType(r),
    paged:  PagedSourceType(r),
});

/**
 * The TypeScript type of a {@link RowSourceType} over row type `R`.
 *
 * @typeParam R - The row type.
 */
export type RowSource<R extends EastType> = ExprType<ReturnType<typeof RowSourceType<R>>>;

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
 * @typeParam R - The row type.
 */
export type RowSourceInput<R extends EastType> =
    | SubtypeExprOrValue<ArrayType<R>>
    | PagedSourceLike;

/** A resolved rows prop — the arm plus the row type recovered from it. */
export type ResolvedRowSource =
    | { kind: "inline"; rows: ExprType<ArrayType<EastType>>; rowType: EastType }
    | { kind: "paged"; source: ExprType<StructType>; rowType: EastType };

/** A struct expression's field types, or undefined when it isn't a struct. */
function structFields(t: unknown): Record<string, EastType> | undefined {
    const type = t as { type?: string; fields?: Record<string, EastType> };
    return type.type === "Struct" ? (type.fields ?? {}) : undefined;
}

/**
 * Classify a component's rows prop at BUILD time — the one dispatch every
 * collection shares, so no component re-sniffs shapes of its own.
 *
 * Accepted shapes, in order:
 * - an `Array<R>` expression / value ⇒ `inline`;
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
    const t = Expr.type(expr) as { type: string; value?: EastType };
    if (t.type === "Array") {
        return { kind: "inline", rows: expr, rowType: t.value as EastType };
    }
    const fields = structFields(t);
    if (fields !== undefined && fields["page"] !== undefined && fields["total"] !== undefined) {
        // `page: Fn([Int, Int], Option<Array<R>>)` — recover R through it. An
        // Option is a VARIANT (`cases.some`), not a struct, so the row type
        // hangs off the `some` case's element type.
        const page = fields["page"] as {
            output?: { cases?: { some?: { value?: EastType } } };
        };
        const rowType = page.output?.cases?.some?.value;
        if (rowType === undefined) {
            throw new Error(
                `${label}: the paged source's \`page\` must return \`Option<Array<R>>\` — got ${JSON.stringify(page)}`,
            );
        }
        return { kind: "paged", source: expr as unknown as ExprType<StructType>, rowType };
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
 * point where the DOMAIN row type is erased to the component's row type, so
 * everything downstream — the renderer, the window cache — sees one row space.
 *
 * @typeParam Out - The component's own row type.
 * @param resolved - The output of {@link resolveRowSource}
 * @param outType - The component's row type
 * @param make - Domain rows → component rows
 * @returns The `RowSourceType(outType)` value to store in the IR
 */
export function buildRowSource<Out extends EastType>(
    resolved: ResolvedRowSource,
    outType: Out,
    make: (rows: ExprType<ArrayType<EastType>>) => SubtypeExprOrValue<ArrayType<Out>>,
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
        page: FunctionType<[IntegerType, IntegerType], OptionType<ArrayType<EastType>>>;
        total: FunctionType<[], OptionType<IntegerType>>;
        seek: OptionType<FunctionType<[StringType], OptionType<SeekRangeType>>>;
    }>>;
    const page = East.function([IntegerType, IntegerType], OptionType(ArrayType(outType)), ($, offset, limit) => {
        const empty = $.const(none, OptionType(ArrayType(outType)));
        const win = $.let(handle.page(offset, limit));
        return win.match({
            some: ($, rows) => {
                const built = $.let(make(rows as ExprType<ArrayType<EastType>>), ArrayType(outType));
                return East.value(some(built), OptionType(ArrayType(outType)));
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

/** Options for {@link Paged.of}. */
export interface PagedOfOptions<R extends EastType> {
    /**
     * Key accessor. Supplying it declares the rows are SORTED by that key and
     * enables `seek` (prefix-matched, the canonical key order the search
     * chrome expects). Omitted ⇒ `seek` is `none`, exactly as an
     * Array-backed dataset behaves.
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
 * @typeParam R - The row type.
 * @param id - Comparable identity for this source (see {@link PagedSourceType}).
 * @param rows - The whole collection.
 * @param options - {@link PagedOfOptions} — supply `key` to enable `seek`.
 * @returns A `PagedSourceType(R)` value.
 *
 * @example
 * ```tsx
 * const units = $.const([...], ArrayType(UnitRow));
 * const source = $.const(Paged.of("units", units, { key: r => r.id }));
 * return <Plan axis={axis} data={source} series={series} style={{ height: "fill" }} />;
 * ```
 */
function createPagedOf<R extends EastType>(
    id: SubtypeExprOrValue<StringType>,
    rows: SubtypeExprOrValue<ArrayType<R>>,
    options?: PagedOfOptions<R>,
): PagedSource<R> {
    const all = East.value(rows) as ExprType<ArrayType<R>>;
    const rowType: EastType = (Expr.type(all) as ArrayType<R>).value;
    const rowsType = ArrayType(rowType);
    // Built OUTSIDE every block: constructing East IR inside one is an
    // authoring-time macro. Inside, each body binds it once with `$.const`.
    const keyOf = options?.key;
    const byFn = keyOf === undefined
        ? undefined
        : East.function([rowType], StringType, (_$, r) => keyOf(r as ExprType<R>));
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
    // `PagedSourceType(rowType)` — is what actually types the value.
    return East.value({ id, page, total, seek }, PagedSourceType(rowType)) as unknown as PagedSource<R>;
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
        /** A windowed row source over a row type. */
        Source: PagedSourceType,
        /** Where a key query landed in a source's row order. */
        SeekRange: SeekRangeType,
        /** How a component's rows arrive (inline / paged). */
        RowSource: RowSourceType,
    },
} as const;
