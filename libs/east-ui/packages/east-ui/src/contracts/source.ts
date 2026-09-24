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
    NullType,
    OptionType,
    SetType,
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

/**
 * A key query, in the one form every key-ordered source understands.
 *
 * @remarks
 * Three shapes, because a key is not always one string: an exact whole-key
 * literal, a String prefix, or — for STRUCT keys — exact leading fields with an
 * optional prefix continuing into the next String field. Every shape addresses
 * ONE CONTIGUOUS RANGE in the canonical key order, which is what makes a hit a
 * `row` + `count` rather than a set of scattered matches.
 *
 * Literals are canonical `.east` text of already-validated values, so the query
 * is plain serializable data at any key type — no type-specific wire format,
 * and the search chrome parses the user's text against the key type it was
 * handed ({@link SeekType.keyType}) before it ever gets here.
 *
 * Deliberately the same three shapes as e3's `DatasetFindQuery`, so a bound
 * source forwards a query rather than translating one.
 *
 * @property key - A whole-key `.east` literal — an exact lookup, any key type.
 * @property prefix - A String prefix (String keys, or a Struct key's first
 *   field when it is a String).
 * @property fields - Struct keys: `.east` literals of exact leading fields in
 *   declaration order (`values`), optionally continuing into the next String
 *   field (`prefix`).
 */
export const SeekQueryType = VariantType({
    key:    StringType,
    prefix: StringType,
    fields: StructType({ values: ArrayType(StringType), prefix: OptionType(StringType) }),
});
/** Type alias for {@link SeekQueryType}. */
export type SeekQueryType = typeof SeekQueryType;

/**
 * The KEY TYPE is deliberately NOT part of this contract.
 *
 * A first design carried it here (`seek: Option<{ keyType: EastTypeType, find }>`)
 * so a component could compose a typed query with no authoring-time knowledge
 * of the dataset's schema. Two things ruled it out:
 *
 * - `EastTypeType` is a `RecursiveType`, and the generic-platform type
 *   substituter walks output types structurally — `applyTypeArgs`
 *   (`east/src/expr/block.ts`) recurses forever through the marker and blows
 *   the stack the moment `Data.bindPaged` instantiates its handle. A recursive
 *   type cannot ride a generic platform's output.
 * - It has no consumer. The hosts that mount key search — `<DatasetPreview>`,
 *   `<PagedDatasetPreview>` — hold the dataset's `EastTypeValue` already and
 *   pass it as a prop; a keyed component's own keys are Strings, whose search
 *   input is a plain prefix.
 *
 * So the QUERY is data ({@link SeekQueryType}, `.east` literals as text) and the
 * key type stays with whoever knows the schema. Revisit only with a real
 * component-level consumer, and then as printed type text, not a recursive
 * value.
 */

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
 * A window may also hold FEWER than `limit` elements while the source still
 * has more: a source that bounds its pages serves what fits. e3 trims every
 * page of a dataset to a byte budget — the same number of elements on every
 * page of one dataset — so wide elements come back in short windows (#829).
 * Only an EMPTY window means exhausted. Components never see a short window:
 * {@link buildRowSource}'s derived `page` re-requests whatever a trimmed page
 * left out, so every window it serves is whole.
 *
 * A window that CANNOT be read — a failed fetch, a page that does not decode —
 * makes `page` THROW its reason; it never reads `none`, which means in flight,
 * and a reader waiting on it would wait forever (#811). A component shows the
 * failure where that window's rows would be and asks again when the user
 * retries. A source may rate-limit repeat attempts (e3 relaunches a failed
 * window on a read at least two seconds later), and an authoring error — a
 * dataset that cannot be paged — keeps throwing. `seek` follows the same rule.
 *
 * @property revision - Coherent snapshot shared by pages, total and seek; none
 *   while discovering it, or on a legacy immutable-id source.
 * @property refresh - Install an exact revision (some(hash)), or discover the
 *   current snapshot (none), invalidating windows, total and seek together.
 *
 * @typeParam C - The collection type one window carries.
 * @param c - The collection type value.
 * @returns The concrete `StructType` of a paged source over `c`.
 *
 * @property id - Comparable identity (a dataset path, a fixture name). East
 *   compares every function as EQUAL, so a struct of nothing but closures is
 *   indistinguishable from any other — without this field a memoized component
 *   never re-renders when the source is swapped, and a window cache cannot key
 *   itself. The id names the logical source; revision names its snapshot.
 * @property page - `(offset, limit)` → that window's elements as a value of the
 *   collection type; `none` while in flight, an EMPTY collection at exhaustion,
 *   and possibly fewer than `limit` elements before it (see above). Throws when
 *   the window cannot be read.
 * @property total - The source's total element count, once known; `none` until then.
 * @property seek - The source's key-search capability ({@link SeekType}) —
 *   `none` when the source is not key-ordered (an Array-backed source cannot
 *   seek; there is nothing to binary-search). A search that fails throws.
 */
export const PagedSourceType = <C extends EastType>(c: C) => StructType({
    id:    StringType,
    page:  FunctionType([IntegerType, IntegerType], OptionType(c)),
    total: FunctionType([], OptionType(IntegerType)),
    seek:  OptionType(FunctionType([SeekQueryType], OptionType(SeekRangeType))),
    revision: FunctionType([], OptionType(StringType)),
    refresh: FunctionType([OptionType(StringType)], NullType),
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
    | { kind: "inline"; rows: ExprType<EastType>; collectionType: EastType; elementType: EastType; keyType: EastType | undefined; live?: ExprType<StructType> }
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
 * @returns The resolved arm, retaining a live handle for invocation-time reads — see {@link ResolvedRowSource}
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
        const resolved = resolveRowSource(handle.read(), label);
        return resolved.kind === "inline" ? { ...resolved, live: expr as unknown as ExprType<StructType> } : resolved;
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
 * @param idSuffix - Appended to the paged source's `id` — see below
 * @returns The `RowSourceType(outType)` value to store in the IR
 *
 * @remarks
 * `idSuffix` exists because `make` is part of what the derived source SERVES.
 * {@link PagedSourceType} requires that two sources sharing an `id` serve the
 * same rows, and a component whose `make` changes — a Plan whose series list was
 * narrowed by a pick — now serves different rows from the same underlying
 * handle. Since a window cache keys on `id` alone and resident windows are never
 * re-read, an unsigned id leaves the previous rows on screen forever. A
 * component that can vary its `make` must pass a signature of what varied.
 *
 * The derived `page` serves WHOLE windows (#829). A handle may answer
 * `(offset, limit)` with fewer than `limit` elements while it still has more —
 * e3 trims every page to a byte budget — and every component addresses its
 * windows at `w × size`, so a short window would silently drop its tail. The
 * derived `page` therefore re-requests `(offset + served, limit − served)`
 * until the window holds `limit` elements, the source is exhausted (an empty
 * piece, or `offset + served` reaching a known `total()`), or a piece is still
 * in flight — in which case the whole window reads `none` and re-fires when the
 * piece lands. The pieces join in the collection's own order (arrays
 * concatenate; dicts and sets union, their pieces being disjoint and ascending)
 * and `make` runs once over the whole window. Each piece stays its own request,
 * so a runtime caches them at the size the source chose to serve.
 */
export function buildRowSource<Out extends EastType>(
    resolved: ResolvedRowSource,
    outType: Out,
    make: (collection: ExprType<EastType>) => SubtypeExprOrValue<Out>,
    idSuffix?: SubtypeExprOrValue<StringType>,
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
        seek: OptionType<FunctionType<[SeekQueryType], OptionType<SeekRangeType>>>;
        revision: FunctionType<[], OptionType<StringType>>;
        refresh: FunctionType<[OptionType<StringType>], NullType>;
    }>>;
    // Erased locally: the window type is `Out`, but TS cannot see through the
    // generic to unify `Option<Out>`'s arms — the East type is what types it.
    const winType: EastType = outType;
    // The source's own collection — every piece of a window is a value of it.
    // Its size and the in-order join of two pieces are reified ONCE, outside
    // the block, per collection kind, then CALLED. Both are pure: a piece may
    // be the very window object a runtime holds in its cache.
    const pieceType: EastType = resolved.collectionType;
    const pieceKind = (pieceType as { type: string }).type;
    const sizeOf = pieceKind === "Array"
        ? East.function([pieceType], IntegerType, (_$, c) => (c as unknown as ExprType<ArrayType<EastType>>).length())
        : pieceKind === "Dict"
            ? East.function([pieceType], IntegerType, (_$, c) => (c as unknown as ExprType<DictType<EastType, EastType>>).size())
            : East.function([pieceType], IntegerType, (_$, c) => (c as unknown as ExprType<SetType<EastType>>).size());
    const joinOf = pieceKind === "Array"
        ? East.function([pieceType, pieceType], pieceType, (_$, a, b) =>
            (a as unknown as ExprType<ArrayType<EastType>>).concat(b as unknown as ExprType<ArrayType<EastType>>))
        : pieceKind === "Dict"
            // Pieces are disjoint, so the conflict arm never runs.
            ? East.function([pieceType, pieceType], pieceType, (_$, a, b) =>
                (a as unknown as ExprType<DictType<EastType, EastType>>).union(
                    b as unknown as ExprType<DictType<EastType, EastType>>, (_$2, _mine, theirs) => theirs))
            : East.function([pieceType, pieceType], pieceType, (_$, a, b) =>
                (a as unknown as ExprType<SetType<EastType>>).union(b as unknown as ExprType<SetType<EastType>>));
    const page = East.function([IntegerType, IntegerType], OptionType(winType), ($, offset, limit) => {
        // Bound ONCE: the handle may be a platform call (`Data.bindPaged(…)`
        // passed inline), and this body reads it up to three times.
        const src = $.const(handle);
        const size = $.const(sizeOf as unknown as ExprType<FunctionType<[EastType], IntegerType>>);
        const join = $.const(joinOf as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>);
        const result = $.let(none, OptionType(winType));
        const first = $.let(src.page(offset, limit));
        $.match(first, {
            some: ($, head) => {
                const window = $.let(head, pieceType);
                const served = $.let(size(head), IntegerType);
                const inFlight = $.let(false, BooleanType);
                // An empty first window is exhaustion. A short one — the
                // source trimmed it — asks for the rest, piece by piece.
                $.while(served.greater(0n).and(() => served.less(limit)), ($, label) => {
                    // A known total says where the source ends: no piece past it.
                    const total = $.let(src.total());
                    $.match(total, {
                        some: ($, t) => {
                            $.if(offset.add(served).greaterEqual(t), ($) => { $.break(label); });
                        },
                    });
                    const next = $.let(src.page(offset.add(served), limit.subtract(served)));
                    $.match(next, {
                        none: ($) => {
                            // Still in flight: the whole window waits, and the
                            // piece's landing re-fires this evaluation.
                            $.assign(inFlight, true);
                            $.break(label);
                        },
                        some: ($, piece) => {
                            const n = $.let(size(piece), IntegerType);
                            $.if(n.equal(0n), ($) => { $.break(label); });
                            $.assign(window, join(window, piece));
                            $.assign(served, served.add(n));
                        },
                    });
                });
                $.if(inFlight.not(), ($) => {
                    const built = $.let(make(window as ExprType<EastType>), outType);
                    $.assign(result, some(built));
                });
            },
        });
        return result;
    });
    // A source predating the contract carries no `id` / `seek`; fall back to a
    // constant identity (it still compares equal to itself) and no seek.
    const fields = structFields(Expr.type(resolved.source)) ?? {};
    const baseId = fields["id"] !== undefined ? handle.id : East.value("", StringType);
    const id = idSuffix !== undefined
        ? East.str`${baseId}#${East.value(idSuffix, StringType)}`
        : baseId;
    const seek = fields["seek"] !== undefined
        ? handle.seek
        : East.value(none, OptionType(FunctionType([SeekQueryType], OptionType(SeekRangeType))));
    const revision = fields["revision"] !== undefined
        ? handle.revision
        : East.function([], OptionType(StringType), () => none);
    const refresh = fields["refresh"] !== undefined
        ? handle.refresh
        : East.function([OptionType(StringType)], NullType, $ => {
            $.error("Paged: this legacy source cannot refresh — provide revision and refresh methods for mutable editing");
        });
    return East.value(
        variant("paged", { id, page, total: handle.total, seek, revision, refresh }) as never,
        sourceType,
    ) as RowSource<Out>;
}

// ============================================================================
// Paged.of — the in-memory source
// ============================================================================

/** Options for {@link Paged.of} — `key` applies to the ARRAY form only,
 *  `pageLimit` to both. */
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
    /**
     * Serve at most this many elements per window, whatever `limit` asks — the
     * in-memory twin of a source that bounds its pages (e3 trims every page to
     * a byte budget, so wide elements come back in short windows, #829).
     *
     * A component never sees the trim: `buildRowSource` re-requests what a
     * short window left out, so every window it serves is whole. Set it to
     * exercise that path in examples and tests. Must be a positive integer;
     * omit it and a window is exactly what `limit` asks (clamped at the end).
     */
    pageLimit?: number;
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
 * `pageLimit` adds the one thing a real server does that an in-memory source
 * would not: short windows, as e3 serves wide elements under its byte budget.
 *
 * Windows follow the collection: an `Array` source serves array windows in
 * stream order, a `Dict` source serves DICT windows in canonical key order —
 * the same shape and the same order a keyed dataset's windows arrive in, which
 * is what a keyed component (the Plan) requires of its source (#568).
 *
 * @typeParam R - The row type (array form) / the value type (dict form).
 * `Paged.of` captures an immutable copy at creation. Give changed content a
 * new id: this fixture's revision is `some(id)`. Refreshing with `none` or
 * that same token keeps the snapshot; another target throws.
 *
 * @param id - Unique snapshot identity (see {@link PagedSourceType}).
 * @param collection - The whole collection — an `Array<R>` or a `Dict<String, R>`.
 * @param options - {@link PagedOfOptions} — `key` (array form only) enables `seek`;
 *   `pageLimit` trims every window, as a server bounding its pages does.
 * @returns A `PagedSourceType` at the collection it was given.
 * @throws {Error} When `pageLimit` is not a positive integer.
 *
 * @example
 * ```tsx
 * // A keyed source: the canvas rows inherit these keys, so `seek` addresses
 * // real rows and a window's key range is a canvas key range.
 * const units = $.const(new Map([["UNIT-001", { … }]]), DictType(StringType, UnitRow));
 * const source = $.const(Paged.of("units", units));
 * // The lifecycle is shared with mutable sources; fixtures retain this token.
 * $(source.refresh(some("units")));
 * const revision = $.let(source.revision()); // some("units")
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
    options?: Pick<PagedOfOptions<V>, "pageLimit">,
): PagedSource<DictType<StringType, V>>;
function createPagedOf(
    id: SubtypeExprOrValue<StringType>,
    collection: SubtypeExprOrValue<EastType>,
    options?: PagedOfOptions<EastType>,
    // The erased implementation signature: `PagedSource<C>` is invariant in
    // `C`, so neither overload's return is assignable to a common one. The
    // overloads above are what callers see.
): any {
    const pageLimit = options?.pageLimit;
    if (pageLimit !== undefined && !(Number.isInteger(pageLimit) && pageLimit > 0)) {
        throw new Error(`Paged.of: \`pageLimit\` must be a positive integer — the most elements one window serves (got ${pageLimit})`);
    }
    const collectionExpr = East.value(collection as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    const collectionType = Expr.type(collectionExpr) as EastType;
    const keyed = collectionType.type === "Dict";
    // Evaluate the input once when creating the source, then detach nested
    // mutable values. Page and seek closures share that captured snapshot;
    // passing a live read expression cannot make later pages drift.
    const capture = East.function([StringType, collectionType], PagedSourceType(collectionType), ($, snapshotId, input) => {
        const snapshot = $.const(East.Blob.encodeBeast(input).decodeBeast(collectionType), collectionType);
        return keyed ? keyedPagedOf(snapshotId, snapshot, pageLimit)
            : arrayPagedOf(snapshotId, snapshot as ExprType<ArrayType<EastType>>, options);
    });
    return East.value(capture)(id, collectionExpr);
}

/**
 * The window size a source actually serves for a requested `limit` — the
 * request itself, or `pageLimit` when that is smaller. Reified once as a real
 * East function (the `shared/reify` rule), so a page body CALLS it instead of
 * branching on host state. `none` ⇒ the source never trims.
 */
function servedLimitFn(pageLimit: number | undefined): ExprType<FunctionType<[IntegerType], IntegerType>> {
    const capValue = pageLimit === undefined ? none : some(BigInt(pageLimit));
    return East.function([IntegerType], IntegerType, ($, limit) => {
        const cap = $.const(capValue, OptionType(IntegerType));
        return cap.match({
            some: (_$, c) => limit.less(c).ifElse(() => limit, () => c),
            none: (_$) => limit,
        });
    });
}

/**
 * The KEYED in-memory source — dict windows in canonical key order, with
 * `seek` derived from the keys themselves (a keyed collection needs no key
 * accessor: it already is one).
 */
function keyedPagedOf(
    id: SubtypeExprOrValue<StringType>,
    collection: ExprType<EastType>,
    pageLimit: number | undefined,
): PagedSource<EastType> {
    const all = collection as unknown as ExprType<DictType<StringType, EastType>>;
    const valueType: EastType = (Expr.type(all) as DictType<StringType, EastType>).value;
    const dictType = DictType(StringType, valueType);
    const entryType = StructType({ key: StringType, value: valueType });
    const entriesType = ArrayType(entryType);
    // Built OUTSIDE every block (an East macro inside one splices per use).
    const keyOfEntry = East.function([entryType], StringType, (_$, e) => e.key);
    const servedLimit = servedLimitFn(pageLimit);
    const page = East.function([IntegerType, IntegerType], OptionType(dictType), ($, offset, limit) => {
        const src = $.const(all, dictType);
        const served = $.const(servedLimit);
        // `toArray` walks the dictionary in key order, so the window a given
        // offset serves is the window a keyed dataset would serve.
        const entries = $.let(src.toArray(($2, v, k) => $2.const({ key: k, value: v }, entryType)), entriesType);
        const n = $.let(entries.length(), IntegerType);
        const start = $.let(offset.less(n).ifElse(() => offset, () => n), IntegerType);
        const rawEnd = $.let(offset.add(served(limit)), IntegerType);
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
    // Key order ⇒ the first entry at-or-after the query starts the matching
    // run, and the run is contiguous, so counting the entries that still carry
    // the prefix counts exactly the matches. Both ranges are real
    // `East.function`s built OUTSIDE every block, then CALLED per arm.
    const prefixRange = East.function([entriesType, StringType], SeekRangeType, ($, entries, p) => {
        const by = $.const(keyOfEntry);
        const first = $.let(entries.findSortedFirst(p, by), IntegerType);
        const tail = $.let(entries.slice(first, entries.length()), entriesType);
        const matched = $.let(tail.filter((_$, e) => e.key.startsWith(p)), entriesType);
        const count = $.let(matched.length(), IntegerType);
        return $.let({ found: count.greater(0n), row: first, count }, SeekRangeType);
    });
    const exactRange = East.function([entriesType, StringType], SeekRangeType, ($, entries, k) => {
        const by = $.const(keyOfEntry);
        const first = $.let(entries.findSortedFirst(k, by), IntegerType);
        const tail = $.let(entries.slice(first, entries.length()), entriesType);
        const matched = $.let(tail.filter((_$, e) => East.equal(e.key, k)), entriesType);
        const count = $.let(matched.length(), IntegerType);
        return $.let({ found: count.greater(0n), row: first, count }, SeekRangeType);
    });
    const find = East.function([SeekQueryType], OptionType(SeekRangeType), ($, query) => {
        const src = $.const(all, dictType);
        const entries = $.let(src.toArray(($2, v, k) => $2.const({ key: k, value: v }, entryType)), entriesType);
        const prefixOf = $.const(prefixRange);
        const exactOf = $.const(exactRange);
        // In-memory sources are never in flight, so every arm resolves to
        // `some` immediately — `none` is reserved for a fetch in progress.
        return query.match({
            prefix: ($2, p) => $2.const(some(prefixOf(entries, p)), OptionType(SeekRangeType)),
            // The whole-key `.east` literal of a String key is its quoted text.
            key: ($2, literal) => $2.const(some(exactOf(entries, literal.parse(StringType))), OptionType(SeekRangeType)),
            // Leading FIELDS address a struct key; these keys are Strings, so a
            // leading-field query can only match when it names none of them —
            // then it is just its prefix.
            fields: ($2, f) => {
                const empty = $2.const({ found: false, row: 0n, count: 0n }, SeekRangeType);
                const range = $2.let(f.values.length().equal(0n).ifElse(
                    () => f.prefix.match({
                        some: ($3, p) => $3.const(prefixOf(entries, p), SeekRangeType),
                        none: ($3) => $3.const(prefixOf(entries, ""), SeekRangeType),
                    }),
                    () => empty,
                ), SeekRangeType);
                return $2.const(some(range), OptionType(SeekRangeType));
            },
        });
    });
    const seek = some(find);
    const revision = East.function([], OptionType(StringType), $ => some($.const(id, StringType)));
    const refresh = East.function([OptionType(StringType)], NullType, ($, target) => {
        $.match(target, {
            some: ($2, hash) => {
                $2.if(hash.notEqual($2.const(id, StringType)), $3 => {
                    $3.error("Paged.of: immutable snapshot — create a source with the requested snapshot id");
                });
            },
            none: () => {},
        });
        return null;
    });
    return East.value({ id, page, total, seek, revision, refresh }, PagedSourceType(dictType)) as unknown as PagedSource<EastType>;
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
    const servedLimit = servedLimitFn(options?.pageLimit);
    const page = East.function([IntegerType, IntegerType], OptionType(rowsType), ($, offset, limit) => {
        const src = $.const(all, rowsType);
        const served = $.const(servedLimit);
        const n = $.let(src.length(), IntegerType);
        const start = $.let(offset.less(n).ifElse(() => offset, () => n), IntegerType);
        const rawEnd = $.let(offset.add(served(limit)), IntegerType);
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
    // Sorted by key ⇒ the first row at-or-after the query starts the matching
    // run, and the run is contiguous, so counting the rows that still carry the
    // prefix counts exactly the matches. Built as real `East.function`s outside
    // every block, then CALLED per query arm.
    const prefixRange = byFn === undefined ? undefined
        : East.function([rowsType, StringType], SeekRangeType, ($, rows, p) => {
            const by = $.const(byFn);
            const first = $.let(rows.findSortedFirst(p, by), IntegerType);
            const tail = $.let(rows.slice(first, rows.length()), rowsType);
            const matched = $.let(tail.filter((_$, r) => by(r).startsWith(p)), rowsType);
            const count = $.let(matched.length(), IntegerType);
            return $.let({ found: count.greater(0n), row: first, count }, SeekRangeType);
        });
    const exactRange = byFn === undefined ? undefined
        : East.function([rowsType, StringType], SeekRangeType, ($, rows, k) => {
            const by = $.const(byFn);
            const first = $.let(rows.findSortedFirst(k, by), IntegerType);
            const tail = $.let(rows.slice(first, rows.length()), rowsType);
            const matched = $.let(tail.filter((_$, r) => East.equal(by(r), k)), rowsType);
            const count = $.let(matched.length(), IntegerType);
            return $.let({ found: count.greater(0n), row: first, count }, SeekRangeType);
        });
    const seek = prefixRange === undefined || exactRange === undefined
        ? East.value(none, OptionType(FunctionType([SeekQueryType], OptionType(SeekRangeType))))
        : some(East.function([SeekQueryType], OptionType(SeekRangeType), ($, query) => {
                const src = $.const(all, rowsType);
                const prefixOf = $.const(prefixRange);
                const exactOf = $.const(exactRange);
                return query.match({
                    prefix: ($2, p) => $2.const(some(prefixOf(src, p)), OptionType(SeekRangeType)),
                    key: ($2, literal) => $2.const(some(exactOf(src, literal.parse(StringType))), OptionType(SeekRangeType)),
                    fields: ($2, f) => {
                        const empty = $2.const({ found: false, row: 0n, count: 0n }, SeekRangeType);
                        const range = $2.let(f.values.length().equal(0n).ifElse(
                            () => f.prefix.match({
                                some: ($3, p) => $3.const(prefixOf(src, p), SeekRangeType),
                                none: ($3) => $3.const(prefixOf(src, ""), SeekRangeType),
                            }),
                            () => empty,
                        ), SeekRangeType);
                        return $2.const(some(range), OptionType(SeekRangeType));
                    },
                });
        }));
    // Two-step cast (the `Data.bindPaged` idiom): the members are built
    // against the row type recovered from the expression, which TS sees as the
    // erased `EastType` rather than the caller's `R`. The East-side type —
    // `PagedSourceType(rowsType)` — is what actually types the value.
    const revision = East.function([], OptionType(StringType), $ => some($.const(id, StringType)));
    const refresh = East.function([OptionType(StringType)], NullType, ($, target) => {
        $.match(target, {
            some: ($2, hash) => {
                $2.if(hash.notEqual($2.const(id, StringType)), $3 => {
                    $3.error("Paged.of: immutable snapshot — create a source with the requested snapshot id");
                });
            },
            none: () => {},
        });
        return null;
    });
    return East.value({ id, page, total, seek, revision, refresh }, PagedSourceType(rowsType)) as unknown as PagedSource<EastType>;
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
        /** A key query — exact literal, String prefix, or leading struct fields. */
        SeekQuery: SeekQueryType,
        /** How a component's rows arrive (inline / paged), at a collection type. */
        RowSource: RowSourceType,
    },
} as const;
