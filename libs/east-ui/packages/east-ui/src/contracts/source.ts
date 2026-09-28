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
 * (dataset windows over an e3 workspace) and {@link Paged.of} /
 * {@link Paged.pinned} are the in-memory ones; e3 is never named here, and
 * **nothing in this file imports e3**.
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
    isTypeEqual,
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
 * Four shapes, because a key is not always one string: an exact whole-key
 * literal; a String prefix; for STRUCT keys, exact leading fields with an
 * optional prefix continuing into the next String field; and a range over the
 * key's flattened fields. Every shape addresses ONE CONTIGUOUS RANGE in the
 * canonical key order, which is what makes a hit a `row` + `count` rather than
 * a set of scattered matches.
 *
 * Literals are canonical `.east` text of already-validated values, so the query
 * is plain serializable data at any key type — no type-specific wire format,
 * and the search chrome parses the user's text against the key type it was
 * handed ({@link SeekType.keyType}) before it ever gets here.
 *
 * Deliberately the same shapes as e3's `DatasetFindQuery`, so a bound source
 * forwards a query rather than translating one.
 *
 * @property key - A whole-key `.east` literal — an exact lookup, any key type.
 * @property prefix - A String prefix (String keys, or a Struct key's first
 *   field when it is a String).
 * @property fields - Struct keys: `.east` literals of exact leading fields in
 *   declaration order (`values`), optionally continuing into the next String
 *   field (`prefix`).
 * @property range - A half-open bound on a leading prefix of the key's
 *   FLATTENED field path — `.east` literals, nested structs recursed in
 *   declaration order — so `{ik: {status, due}, k}` bounds on `status`, then
 *   `due`. An empty array is an open end, and a range names at least one end:
 *   open at both it bounds nothing, and a server-backed source refuses it.
 *   What a time window or a status band asks for, and the one shape the other
 *   three cannot express.
 */
export const SeekQueryType = VariantType({
    key:    StringType,
    prefix: StringType,
    fields: StructType({ values: ArrayType(StringType), prefix: OptionType(StringType) }),
    range:  StructType({ from: ArrayType(StringType), to: ArrayType(StringType) }),
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
 * `Dict<K, V>`, and the Plan's canvas windows are its blocks — one
 * `Array<PlanRow>` stream per series (#823). That is what `Data.bindPaged`
 * already produces — it returns `Option<T>` at the dataset's own type — so the
 * contract matches the producer instead of narrowing it to arrays.
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
 * A paged source names no snapshot, so a component reads each of its windows
 * once: the same `id` serves the same rows for as long as the component holds
 * it. A source whose content moves under one id — a dataset the view follows,
 * a source the view writes — is a {@link PinnedSourceType}, which names the
 * snapshot its windows, total and searches belong to.
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

/**
 * A {@link PagedSourceType} that names its SNAPSHOT — the contract a component
 * follows through changes to the source's content, and the one it edits.
 *
 * @remarks
 * Every window, the total and every search belong to one snapshot, the
 * source's `revision`, so rows from two snapshots never sit side by side. When
 * the revision moves — the data was written, `refresh` was asked for — a
 * component reads its windows again at the new one, and the rows it had stand
 * in until each lands: the view never empties between two snapshots of its
 * data (#821). An edit is checked against the snapshot it was drafted on, and
 * the drafts retire once the source reads back at the snapshot the write made
 * (#880) — which is why the Sheet and the Plan edit a paged source only
 * through this contract.
 *
 * `Data.bindPaged` in `@elaraai/e3-ui` returns one, its revision the dataset's
 * content hash, and {@link Paged.pinned} is the in-memory one.
 *
 * @typeParam C - The collection type one window carries.
 * @param c - The collection type value.
 * @returns The concrete `StructType` of a pinned source over `c`.
 *
 * @property id - The logical source's identity, as {@link PagedSourceType}'s;
 *   the rows it serves are its current revision's.
 * @property page - As {@link PagedSourceType}'s, at the current revision.
 * @property total - As {@link PagedSourceType}'s, at the current revision.
 * @property seek - As {@link PagedSourceType}'s, at the current revision.
 * @property revision - The snapshot the source serves; `none` while it is
 *   being found. A reader re-fires when the source moves to another.
 * @property refresh - Move the source: `some(hash)` to that snapshot — after a
 *   write the view confirmed — or `none` to the one the source holds now.
 */
export const PinnedSourceType = <C extends EastType>(c: C) => StructType({
    id:       StringType,
    page:     FunctionType([IntegerType, IntegerType], OptionType(c)),
    total:    FunctionType([], OptionType(IntegerType)),
    seek:     OptionType(FunctionType([SeekQueryType], OptionType(SeekRangeType))),
    revision: FunctionType([], OptionType(StringType)),
    refresh:  FunctionType([OptionType(StringType)], NullType),
});

/**
 * The TypeScript type of a {@link PinnedSourceType} over collection type `C` —
 * the pinned sibling of {@link PagedSource}.
 *
 * @typeParam C - The collection type one window carries.
 */
export type PinnedSource<C extends EastType> = ExprType<ReturnType<typeof PinnedSourceType<C>>>;

// ============================================================================
// The row-source variant — what components actually store
// ============================================================================

/**
 * How a component's rows arrive: inline, or from a windowed source.
 *
 * @remarks
 * Every arm speaks the same COLLECTION type — inline is the whole of it, the
 * windowed arms a window of it — so a keyed source (a Sheet's
 * `Dict<String, Row>`), a positional one (a Table's `Array<Row>`) and a
 * composite one (the Plan's blocks, one row stream per series) share one
 * vocabulary without any shape leaking into the arm names (#568).
 *
 * The two windowed arms differ in one thing: whether the source names its
 * snapshot. `paged` is the released arm — exported UIs carry it, so it never
 * changes — and a component reads each of its windows once; `pinned` names the
 * revision its windows belong to, which is what lets a component follow the
 * source as its content changes, and edit it.
 *
 * @typeParam C - The collection type.
 * @param c - The collection type value.
 * @returns The concrete `VariantType` of a row source over `c`.
 *
 * @property inline - The whole collection, already in hand.
 * @property paged - A {@link PagedSourceType} fetched a window at a time.
 * @property pinned - A {@link PinnedSourceType} — windows at a named snapshot, followed from one to the next.
 */
export const RowSourceType = <C extends EastType>(c: C): RowSourceType<C> => VariantType({
    inline: c,
    paged:  PagedSourceType(c),
    pinned: PinnedSourceType(c),
});

/**
 * The East type {@link RowSourceType} builds over collection type `C`, as a
 * named interface.
 *
 * @remarks
 * An interface is a symbol, so the declaration emitter names it wherever a
 * component's type carries a row source, instead of writing the collection
 * type out once per arm — which keeps `UIComponentType`'s declaration within
 * the length TypeScript will serialize (TS7056; see `UIComponentNode`).
 *
 * @typeParam C - The collection type.
 */
export interface RowSourceType<C extends EastType> extends VariantType {
    /** The arms, by name — {@link RowSourceType}'s three. */
    readonly cases: {
        readonly inline: C;
        readonly paged: ReturnType<typeof PagedSourceType<C>>;
        readonly pinned: ReturnType<typeof PinnedSourceType<C>>;
    };
}

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
 * `keyType` is what a keyed component checks: the Plan requires a `Dict`
 * (any key type, #822) because a row's id starts with its entry's key, so an
 * unkeyed source is refused rather than silently re-keyed (#568).
 *
 * `pinned` says whether a windowed source names its snapshot — `revision` and
 * `refresh`, as {@link PinnedSourceType} has them — and so builds the `pinned`
 * arm: the one a component follows through changes to the source, and the
 * only one the Sheet and the Plan edit.
 */
export type ResolvedRowSource =
    | { kind: "inline"; rows: ExprType<EastType>; collectionType: EastType; elementType: EastType; keyType: EastType | undefined; live?: ExprType<StructType> }
    | { kind: "paged"; source: ExprType<StructType>; collectionType: EastType; elementType: EastType; keyType: EastType | undefined; pinned: boolean }
    | {
        kind: "ordered";
        source: ExprType<StructType>;
        collectionType: EastType;
        elementType: EastType;
        /** The PRIMARY key each row carries, off the element's `key` field. */
        keyType: EastType;
        /** The order key the window is sorted by, off the element's `ik`. */
        orderKeyType: EastType;
        /** Whether the source names its snapshot — `revision` and `refresh`. */
        pinned: boolean;
    };

/** A resolved WINDOWED source — `paged`, or an `ordered` index window. */
export type ResolvedWindowedSource = Extract<ResolvedRowSource, { kind: "paged" | "ordered" }>;

/**
 * The element shape an ORDERED window carries: an index entry.
 *
 * @remarks
 * `ik` is the key the window is SORTED by, `key` the row's own identity,
 * `value` whatever the index covers, and `row` the row itself when the read
 * joined. A window of these is an `Array` because a `Dict` would re-sort by
 * its own key and throw the index order away — which is exactly why the rows
 * need somewhere to carry their identity, and why this is a shape rather than
 * a flag.
 */
const ORDERED_ENTRY_FIELDS = ["ik", "key", "value", "row"] as const;

/** Whether an element type is an ordered window's entry. */
function orderedEntry(elementType: EastType | undefined): { ik: EastType; key: EastType } | null {
    const fields = structFields(elementType);
    if (fields === undefined) return null;
    const names = Object.keys(fields);
    if (names.length !== ORDERED_ENTRY_FIELDS.length) return null;
    if (!ORDERED_ENTRY_FIELDS.every((name, i) => names[i] === name)) return null;
    return { ik: fields["ik"]!, key: fields["key"]! };
}

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

/** The members a {@link PinnedSourceType} adds to a paged source, at their types. */
const SNAPSHOT_MEMBERS = {
    revision: FunctionType([], OptionType(StringType)),
    refresh:  FunctionType([OptionType(StringType)], NullType),
};

/**
 * Whether a windowed source names its snapshot — `revision` and `refresh`,
 * both, at {@link PinnedSourceType}'s types.
 *
 * @param fields - The source's struct fields
 * @param label - Component name for the error message
 * @returns Whether the source is pinned
 * @throws Error when the source has one of the two without the other, or
 *   either at another type — it would build neither arm faithfully
 */
function namesSnapshot(fields: Record<string, EastType>, label: string): boolean {
    const revision = fields["revision"];
    const refresh = fields["refresh"];
    if (revision === undefined && refresh === undefined) return false;
    if (revision !== undefined && refresh !== undefined
        && isTypeEqual(revision, SNAPSHOT_MEMBERS.revision) && isTypeEqual(refresh, SNAPSHOT_MEMBERS.refresh)) {
        return true;
    }
    const found = revision === undefined ? "only `refresh`" : refresh === undefined ? "only `revision`" : "them at other types";
    throw new Error(
        `${label}: a paged source names its snapshot with both \`revision: () → Option<String>\` and ` +
        `\`refresh: (Option<String>) → Null\`, as Data.bindPaged's handle and Paged.pinned do — this one has ${found}`,
    );
}

/**
 * Classify a component's rows prop at BUILD time — the one dispatch every
 * collection shares, so no component re-sniffs shapes of its own.
 *
 * Accepted shapes, in order:
 * - a collection expression / value (`Array<R>`, `Dict<K, V>`, `Set<R>`) ⇒ `inline`;
 * - a struct carrying `page` + `total` ⇒ `paged` (a {@link PagedSourceType},
 *   or anything structurally matching it), marked `pinned` when it also
 *   carries `revision` + `refresh` (a {@link PinnedSourceType} —
 *   `Data.bindPaged`'s handle, `Paged.pinned`);
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
        // A source that names its snapshot builds the `pinned` arm.
        const pinned = namesSnapshot(fields, label);
        // An ORDERED window: positional, but every row carries its own key.
        // Recognised by the element's shape rather than announced by a flag,
        // so a source that serves index entries needs no second vocabulary.
        const entry = (collectionType as { type?: string }).type === "Array" ? orderedEntry(elementType) : null;
        if (entry !== null) {
            return {
                kind: "ordered", source: expr as unknown as ExprType<StructType>,
                collectionType, elementType, keyType: entry.key, orderKeyType: entry.ik, pinned,
            };
        }
        return {
            kind: "paged", source: expr as unknown as ExprType<StructType>,
            collectionType, elementType, keyType: keyTypeOf(collectionType), pinned,
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
 * `Dict<K, R>`.
 *
 * @typeParam Out - The component's own row COLLECTION type.
 * @param resolved - The output of {@link resolveRowSource}
 * @param outType - The component's row collection type
 * @param make - The source collection → the component's row collection
 * @returns The `RowSourceType(outType)` value to store in the IR
 *
 * @remarks
 * The derived source keeps the handle's `id`: `make` is part of what it
 * serves, and a component whose `make` changes (a Plan whose series list a
 * pick narrowed) serves other rows from the same handle — which a renderer
 * tells apart by comparing the derived source whole, closures included
 * (`equivalentFor`, #809), not by its id (#822).
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
 *
 * A source that names its snapshot (`resolved.pinned`, a
 * {@link PinnedSourceType}) builds the `pinned` arm, its `revision` and
 * `refresh` carried through as they are; any other builds `paged`, which has
 * neither. The derived `page` is the same either way.
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
    // `ordered` and `paged` build the same value: by the time `make` has run,
    // the rows are the component's own shape, and whatever the entry carried —
    // its key, its order key — is in there because the component's `make` put
    // it there. The distinction is a BUILD-time one, which is why `ordered`
    // has no arm of its own for a renderer to match on. What picks the arm is
    // whether the source names its snapshot.
    const handle = pagedHandleOf(resolved);
    // Erased locally: the window type is `Out`, but TS cannot see through the
    // generic to unify `Option<Out>`'s arms — the East type is what types it.
    const winType: EastType = outType;
    // The WHOLE window of the source's own collection, then `make` over it
    // (#829) — reified once, and shared with anything that must read the very
    // windows a component reads (the Plan's editing, #880).
    const window = buildPagedWindow(resolved);
    const page = East.function([IntegerType, IntegerType], OptionType(winType), ($, offset, limit) => {
        const read = $.const(window);
        const result = $.let(none, OptionType(winType));
        const whole = $.let(read(offset, limit));
        $.match(whole, {
            some: ($, entries) => {
                const built = $.let(make(entries as ExprType<EastType>), outType);
                $.assign(result, some(built));
            },
        });
        return result;
    });
    // A source predating the contract carries no `id` / `seek`; fall back to a
    // constant identity (it still compares equal to itself) and no seek.
    const fields = structFields(Expr.type(resolved.source)) ?? {};
    const id = fields["id"] !== undefined ? handle.id : East.value("", StringType);
    const seek = fields["seek"] !== undefined
        ? handle.seek
        : East.value(none, OptionType(FunctionType([SeekQueryType], OptionType(SeekRangeType))));
    if (!resolved.pinned) {
        return East.value(
            variant("paged", { id, page, total: handle.total, seek }) as never,
            sourceType,
        ) as RowSource<Out>;
    }
    const snapshot = resolved.source as unknown as ExprType<StructType<typeof SNAPSHOT_MEMBERS>>;
    return East.value(
        variant("pinned", { id, page, total: handle.total, seek, revision: snapshot.revision, refresh: snapshot.refresh }) as never,
        sourceType,
    ) as RowSource<Out>;
}

/** A resolved paged source's handle, at the contract's shape. */
function pagedHandleOf(resolved: ResolvedWindowedSource) {
    return resolved.source as unknown as ExprType<StructType<{
        id: StringType;
        page: FunctionType<[IntegerType, IntegerType], OptionType<EastType>>;
        total: FunctionType<[], OptionType<IntegerType>>;
        seek: OptionType<FunctionType<[SeekQueryType], OptionType<SeekRangeType>>>;
    }>>;
}

/**
 * The WHOLE window `(offset, limit)` of a paged source's own collection — the
 * pieces a trimmed page left out asked for until the window holds `limit`
 * elements, the source is exhausted, or a piece is in flight (the window then
 * reads `none`, #829). What {@link buildRowSource}'s derived `page` maps its
 * `make` over; a caller that must read the very windows a component reads —
 * the Plan's editing reads its entries back (#880) — asks for them here, so
 * each piece is the same request the component made.
 *
 * @param resolved - A resolved paged source ({@link resolveRowSource})
 * @returns `(offset, limit)` → the window, `none` while a piece is in flight
 */
export function buildPagedWindow(
    resolved: ResolvedWindowedSource,
): ExprType<FunctionType<[IntegerType, IntegerType], OptionType<EastType>>> {
    const handle = pagedHandleOf(resolved);
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
    return East.function([IntegerType, IntegerType], OptionType(pieceType), ($, offset, limit) => {
        // Bound ONCE: the handle may be a platform call (`Data.bindPaged(…)`
        // passed inline), and this body reads it up to three times.
        const src = $.const(handle);
        const size = $.const(sizeOf as unknown as ExprType<FunctionType<[EastType], IntegerType>>);
        const join = $.const(joinOf as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>);
        const result = $.let(none, OptionType(pieceType));
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
                $.if(inFlight.not(), ($) => { $.assign(result, some(window)); });
            },
        });
        return result;
    });
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
 * The source captures an immutable copy of the collection when it is created,
 * so no window drifts with the input: changed content is a new source, under a
 * new id. A view that edits its source, or follows it from one snapshot to the
 * next, takes {@link Paged.pinned}.
 *
 * @typeParam R - The row type (array form) / the value type (dict form).
 * @param id - Comparable identity for this source (see {@link PagedSourceType}).
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
    return createInMemory(id, collection, options, false);
}

/**
 * Build an in-memory {@link PinnedSourceType} — {@link Paged.of} naming its
 * snapshot, for a fixture a view edits or follows.
 *
 * @remarks
 * The snapshot is the id, for good: `revision()` reads `some(id)`, a `refresh`
 * to `none` or to the id keeps it, and a refresh to any other snapshot throws —
 * an in-memory source cannot move, so a write it is told about is one it never
 * saw. Everything else is {@link Paged.of}'s: the captured copy, the windows,
 * the total, `seek` and `pageLimit`.
 *
 * @typeParam R - The row type (array form) / the value type (dict form).
 * @param id - The source's identity, and its one snapshot.
 * @param collection - The whole collection — an `Array<R>` or a `Dict<String, R>`.
 * @param options - {@link PagedOfOptions}, as {@link Paged.of} takes them.
 * @returns A `PinnedSourceType` at the collection it was given.
 * @throws {Error} When `pageLimit` is not a positive integer.
 *
 * @example
 * ```tsx
 * const rows = $.const([{ id: "r1", quantity: 2.0 }], ArrayType(OrderRow));
 * const source = $.let(Paged.pinned("orders:fixture-1", rows));
 * // A dataset handle's lifecycle, over one snapshot that never moves.
 * $(source.refresh(none));
 * $(source.refresh(some("orders:fixture-1")));
 * return <Text>{East.str`Snapshot: ${source.revision().unwrap("some")}`}</Text>;
 * ```
 */
function createPagedPinned<R extends EastType>(
    id: SubtypeExprOrValue<StringType>,
    rows: SubtypeExprOrValue<ArrayType<R>>,
    options?: PagedOfOptions<R>,
): PinnedSource<ArrayType<R>>;
function createPagedPinned<V extends EastType>(
    id: SubtypeExprOrValue<StringType>,
    entries: SubtypeExprOrValue<DictType<StringType, V>>,
    options?: Pick<PagedOfOptions<V>, "pageLimit">,
): PinnedSource<DictType<StringType, V>>;
function createPagedPinned(
    id: SubtypeExprOrValue<StringType>,
    collection: SubtypeExprOrValue<EastType>,
    options?: PagedOfOptions<EastType>,
    // Erased for the reason `createPagedOf`'s is.
): any {
    return createInMemory(id, collection, options, true);
}

/**
 * The in-memory source over a collection — {@link Paged.of}'s, or, `pinned`,
 * {@link Paged.pinned}'s.
 *
 * @param id - The source's identity
 * @param collection - The whole collection
 * @param options - {@link PagedOfOptions}
 * @param pinned - Whether the source names its snapshot
 * @returns The source, at the collection it was given
 * @throws {Error} When `pageLimit` is not a positive integer
 */
function createInMemory(
    id: SubtypeExprOrValue<StringType>,
    collection: SubtypeExprOrValue<EastType>,
    options: PagedOfOptions<EastType> | undefined,
    pinned: boolean,
): ExprType<StructType> {
    const pageLimit = options?.pageLimit;
    if (pageLimit !== undefined && !(Number.isInteger(pageLimit) && pageLimit > 0)) {
        throw new Error(`${pinned ? "Paged.pinned" : "Paged.of"}: \`pageLimit\` must be a positive integer — the most elements one window serves (got ${pageLimit})`);
    }
    const collectionExpr = East.value(collection as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    const collectionType = Expr.type(collectionExpr) as EastType;
    const keyed = collectionType.type === "Dict";
    const sourceType: EastType = pinned ? PinnedSourceType(collectionType) : PagedSourceType(collectionType);
    // Evaluate the input once when creating the source, then detach nested
    // mutable values. Page and seek closures share that captured snapshot;
    // passing a live read expression cannot make later pages drift. The copy
    // is beast v2: v1 writes neither a recursive type nor a function, and an
    // entry may be either (a Plan's entries, #822).
    const capture = East.function([StringType, collectionType], sourceType, ($, snapshotId, input) => {
        const snapshot = $.const(East.Blob.encodeBeast(input, "v2").decodeBeast(collectionType, "v2"), collectionType);
        return keyed ? keyedPagedOf(snapshotId, snapshot, pageLimit, pinned)
            : arrayPagedOf(snapshotId, snapshot as ExprType<ArrayType<EastType>>, options, pinned);
    });
    return East.value(capture)(id, collectionExpr) as ExprType<StructType>;
}

/**
 * An in-memory source's lifecycle when it is pinned: its one snapshot is its
 * id. Built as real `East.function`s over the id, never spliced.
 *
 * @param id - The source's identity — its snapshot
 * @returns `revision` and `refresh`, at {@link PinnedSourceType}'s types
 */
function fixedSnapshot(id: SubtypeExprOrValue<StringType>) {
    const revision = East.function([], OptionType(StringType), ($) => {
        const snapshot = $.const(id, StringType);
        return some(snapshot);
    });
    const refresh = East.function([OptionType(StringType)], NullType, ($, target) => {
        const snapshot = $.const(id, StringType);
        $.match(target, {
            some: ($2, hash) => {
                $2.if(hash.notEqual(snapshot), ($3) => {
                    $3.error("Paged.pinned: an immutable snapshot — create a source with the requested snapshot id");
                });
            },
            none: () => {},
        });
        return null;
    });
    return { revision, refresh };
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
 * accessor: it already is one). `pinned` adds its {@link fixedSnapshot}.
 */
function keyedPagedOf(
    id: SubtypeExprOrValue<StringType>,
    collection: ExprType<EastType>,
    pageLimit: number | undefined,
    pinned: boolean,
): ExprType<StructType> {
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
    // A half-open bound. These keys are Strings, which flatten to ONE leaf, so
    // only the first literal of each side applies; an empty side is open.
    const boundedRange = East.function([entriesType, ArrayType(StringType), ArrayType(StringType)], SeekRangeType,
        ($, entries, from, to) => {
            const by = $.const(keyOfEntry);
            const n = $.let(entries.length(), IntegerType);
            const first = $.let(0n, IntegerType);
            $.if(from.length().greater(0n), ($2) => {
                $2.assign(first, entries.findSortedFirst(from.get(0n).parse(StringType), by));
            });
            const last = $.let(n, IntegerType);
            $.if(to.length().greater(0n), ($2) => {
                $2.assign(last, entries.findSortedFirst(to.get(0n).parse(StringType), by));
            });
            const count = $.let(0n, IntegerType);
            $.if(last.greater(first), ($2) => {
                $2.assign(count, last.subtract(first));
            });
            return $.let({ found: count.greater(0n), row: first, count }, SeekRangeType);
        });
    const find = East.function([SeekQueryType], OptionType(SeekRangeType), ($, query) => {
        const src = $.const(all, dictType);
        const entries = $.let(src.toArray(($2, v, k) => $2.const({ key: k, value: v }, entryType)), entriesType);
        const prefixOf = $.const(prefixRange);
        const exactOf = $.const(exactRange);
        const boundedOf = $.const(boundedRange);
        // In-memory sources are never in flight, so every arm resolves to
        // `some` immediately — `none` is reserved for a fetch in progress.
        return query.match({
            prefix: ($2, p) => $2.const(some(prefixOf(entries, p)), OptionType(SeekRangeType)),
            range: ($2, r) => $2.const(some(boundedOf(entries, r.from, r.to)), OptionType(SeekRangeType)),
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
    const members = { id, page, total, seek };
    return (pinned
        ? East.value({ ...members, ...fixedSnapshot(id) }, PinnedSourceType(dictType))
        : East.value(members, PagedSourceType(dictType))) as unknown as ExprType<StructType>;
}

/** The POSITIONAL in-memory source — array windows in stream order.
 *  `pinned` adds its {@link fixedSnapshot}. */
function arrayPagedOf(
    id: SubtypeExprOrValue<StringType>,
    rows: ExprType<ArrayType<EastType>>,
    options: PagedOfOptions<EastType> | undefined,
    pinned: boolean,
): ExprType<StructType> {
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
    // A half-open bound; the key accessor yields a String, which flattens to
    // ONE leaf, so only the first literal of each side applies.
    const boundedRange = byFn === undefined ? undefined
        : East.function([rowsType, ArrayType(StringType), ArrayType(StringType)], SeekRangeType,
            ($, rows, from, to) => {
                const by = $.const(byFn);
                const n = $.let(rows.length(), IntegerType);
                const first = $.let(0n, IntegerType);
                $.if(from.length().greater(0n), ($2) => {
                    $2.assign(first, rows.findSortedFirst(from.get(0n).parse(StringType), by));
                });
                const last = $.let(n, IntegerType);
                $.if(to.length().greater(0n), ($2) => {
                    $2.assign(last, rows.findSortedFirst(to.get(0n).parse(StringType), by));
                });
                const count = $.let(0n, IntegerType);
                $.if(last.greater(first), ($2) => {
                    $2.assign(count, last.subtract(first));
                });
                return $.let({ found: count.greater(0n), row: first, count }, SeekRangeType);
            });
    const seek = prefixRange === undefined || exactRange === undefined || boundedRange === undefined
        ? East.value(none, OptionType(FunctionType([SeekQueryType], OptionType(SeekRangeType))))
        : some(East.function([SeekQueryType], OptionType(SeekRangeType), ($, query) => {
                const src = $.const(all, rowsType);
                const prefixOf = $.const(prefixRange);
                const exactOf = $.const(exactRange);
                const boundedOf = $.const(boundedRange);
                return query.match({
                    prefix: ($2, p) => $2.const(some(prefixOf(src, p)), OptionType(SeekRangeType)),
                    range: ($2, r) => $2.const(some(boundedOf(src, r.from, r.to)), OptionType(SeekRangeType)),
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
    // `PagedSourceType(rowsType)`, or `PinnedSourceType(rowsType)` — is what
    // actually types the value.
    const members = { id, page, total, seek };
    return (pinned
        ? East.value({ ...members, ...fixedSnapshot(id) }, PinnedSourceType(rowsType))
        : East.value(members, PagedSourceType(rowsType))) as unknown as ExprType<StructType>;
}

/**
 * The `Paged` namespace — building a {@link PagedSourceType} or a
 * {@link PinnedSourceType} without a server.
 *
 * @remarks
 * The contract itself is what components consume; this namespace is the
 * in-memory producer. Production sources come from the platform that owns the
 * data (`Data.bindPaged` in `@elaraai/e3-ui`).
 */
export const Paged = {
    /** Build an in-memory paged source over a collection already in hand. */
    of: createPagedOf,
    /** Build an in-memory PINNED source — `of`, naming its one snapshot, for a fixture a view edits or follows. */
    pinned: createPagedPinned,
    /** East types — the contract, for `$.const` / `$.let` annotations. */
    Types: {
        /** A windowed row source over a collection type. */
        Source: PagedSourceType,
        /** A windowed row source that names its snapshot, over a collection type. */
        PinnedSource: PinnedSourceType,
        /** Where a key query landed in a source's row order. */
        SeekRange: SeekRangeType,
        /** A key query — exact literal, String prefix, leading struct fields, or a range. */
        SeekQuery: SeekQueryType,
        /** How a component's rows arrive (inline / paged / pinned), at a collection type. */
        RowSource: RowSourceType,
    },
} as const;
