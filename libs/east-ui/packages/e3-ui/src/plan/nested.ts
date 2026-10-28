/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan's series held to its rows' nested series index (#1435), in the
 * editor. A source's East type carries how its record's nested series index
 * declares each collection — `Data.bindPaged(record, { indexes })`, and a
 * Slice's source over one — as structure: {@link PlanNestedItemsOf} reads it
 * back in the words a series' brand uses (#1436, `PlanReadsBrand`), and
 * {@link PlanNestedRefusals} holds what each series reads to it: a collection
 * the index does not declare, other times than it files by, items read as
 * values or values as items, a subtotal by a rollup it does not keep, and runs
 * rolled up that it files under no parent. Each refusal is a message type,
 * which `<Plan>` makes a property its `series` lacks, so the editor shows the
 * words. A series list held in a variable or built in East is erased, and is
 * held to the index as the Plan is built.
 *
 * @packageDocumentation
 */

import type { NullType, StructType, TypeOf, VariantType } from "@elaraai/east";
import { PlanReadsBrand } from "./reads.js";

// ============================================================================
// The declaration, read back in a series' words
// ============================================================================

/** A struct type's fields. */
type FieldsOf<T> = T extends StructType<infer F> ? F : never;
/** The one name a marker's struct holds: `{ start: Null }` → `"start"`. */
type NameOf<T> = keyof FieldsOf<T> & string;

/**
 * An item's times as a nested series index files them: `{ from: "start"; to:
 * "end" }`, or `{ at: "at" }`.
 *
 * @typeParam I - The items marker's fields
 */
type TimesOf<I> =
    I extends { from: infer A; to: infer B } ? { readonly from: NameOf<A>; readonly to: NameOf<B> }
    : I extends { at: infer A } ? { readonly at: NameOf<A> }
    : never;

/** The rollups a values marker keeps, each by its fold and its aggregate; `never` for none. */
type RollupsOf<V> = V extends StructType<{ rollup: infer U }>
    ? { [Fold in NameOf<U>]: { readonly fold: Fold; readonly aggregate: NameOf<FieldsOf<U>[Fold & keyof FieldsOf<U>]> } }[NameOf<U>]
    : never;

/**
 * How a nested series index declares one collection, in a series' words: its
 * items and their times, and whether each is filed under every parent too;
 * its values, and the rollups kept of them; its child rows' own collections;
 * or more rows of the row's own type.
 *
 * @typeParam M - The collection's marker, as the binding's type carries it
 */
export type PlanNestedCollection<M> =
    FieldsOf<M> extends { items: infer I }
        ? { readonly kind: "items"; readonly times: TimesOf<FieldsOf<I>>; readonly rollup: "rollup" extends keyof FieldsOf<I> ? true : false }
    : FieldsOf<M> extends { values: infer V } ? { readonly kind: "values"; readonly rollups: RollupsOf<V> }
    : FieldsOf<M> extends { rows: infer C } ? { readonly kind: "rows"; readonly collections: PlanNestedCollections<FieldsOf<C>> }
    : FieldsOf<M> extends { recursive: NullType } ? { readonly kind: "recursive" }
    : never;

/**
 * Each collection's declaration, by its field.
 *
 * @typeParam C - Each collection's marker, by its field
 */
export type PlanNestedCollections<C> = { readonly [F in keyof C & string]: PlanNestedCollection<C[F]> };

/**
 * What a source's nested series index declares: its name, and each
 * collection by its field.
 *
 * @typeParam Name - The index's name
 * @typeParam C - Each collection's marker, by its field
 */
export interface PlanNestedIndexOf<Name extends string, C> {
    /** The index's name. */
    readonly index: Name;
    /** Each collection's declaration, by its field. */
    readonly collections: PlanNestedCollections<C>;
}

/** A binding's nested part, read back from its East type; `never` where it lists no nested series index. */
type DeclarationOf<N> =
    N extends VariantType<infer Cases>
        ? Cases extends { some: StructType<infer P> }
            ? P extends { index: infer I; collections: infer C }
                ? [NameOf<I>] extends [never] ? never : PlanNestedIndexOf<NameOf<I>, FieldsOf<C>>
                : never
            : never
        : never;

/** A source expression's East type's fields; `never` for a source that is no struct. */
type SourceFields<S> = FieldsOf<TypeOf<S>>;

/** A Slice handle's `rows` source's declaration; `never` where it has none, or the source lists no nested series index. */
type SliceRowsOf<H> =
    SourceFields<H> extends { sources: StructType<infer P> }
        ? P extends { rows: StructType<infer Part> } ? (Part extends { nested: infer N } ? DeclarationOf<N> : never) : never
        : never;

/**
 * The nested declaration a source's nested series index carries, read from
 * the source's East type: its name, and each collection by its field — what
 * it holds, its times, its rollups, its child rows' own. `"inline"` for a
 * source read whole, whose rows hold their collections; `never` for a paged
 * source with no nested series index.
 *
 * @typeParam S - The source's expression type: a Dict, a bind handle, a paged handle, an indexed binding
 *   (`Data.bindPaged(record, { indexes })`), or a Plan's `slice` options, whose `rows` source gives the rows
 */
export type PlanNestedItemsOf<S> =
    unknown extends S ? "inline"
    : S extends { readonly slice: infer H } ? SliceRowsOf<H>
    : [SourceFields<S>] extends [never] ? "inline"
    : SourceFields<S> extends { nested: infer N; defaultIndex: unknown } ? DeclarationOf<N>
    : SourceFields<S> extends { page: unknown; total: unknown } ? never
    : "inline";

/** Whether a Plan's `slice` options give its rows: a Slice with a `rows` source. */
type GivesRows<S> =
    S extends { readonly slice: infer H }
        ? SourceFields<H> extends { sources: StructType<infer P> } ? ("rows" extends keyof P ? true : false) : false
        : false;

/**
 * The nested declaration a Plan's rows carry: its `slice`'s `rows` source's,
 * where it has one, and otherwise its `data`'s ({@link PlanNestedItemsOf}).
 *
 * @typeParam D - The `data` prop's type
 * @typeParam S - The `slice` prop's type
 */
export type PlanRowsNestedOf<D, S> = GivesRows<S> extends true ? PlanNestedItemsOf<S> : PlanNestedItemsOf<D>;

// ============================================================================
// The refusals, in their words
// ============================================================================

/** Times as code: `{ from: "start", to: "end" }` or `{ at: "at" }`. */
type TimesCode<T> =
    T extends { readonly from: infer A extends string; readonly to: infer B extends string } ? `{ from: "${A}", to: "${B}" }`
    : T extends { readonly at: infer A extends string } ? `{ at: "${A}" }`
    : never;
/** Times in words: `from "start" to "end"` or `at "at"`. */
type TimesWords<T> =
    T extends { readonly from: infer A extends string; readonly to: infer B extends string } ? `from "${A}" to "${B}"`
    : T extends { readonly at: infer A extends string } ? `at "${A}"`
    : never;
/** A rollup in words: `sum`, where its fold and its aggregate are one, else `{ fold: "last", aggregate: "sum" }`. */
type RollupWords<R> =
    R extends { readonly fold: infer F extends string; readonly aggregate: infer A extends string }
        ? ([F] extends [A] ? ([A] extends [F] ? F : `{ fold: "${F}", aggregate: "${A}" }`) : `{ fold: "${F}", aggregate: "${A}" }`)
        : never;
/** A rollup as code: `"sum"`, where its fold and its aggregate are one, else `{ fold: "sum", aggregate: "mean" }`. */
type RollupCode<R> =
    R extends { readonly fold: infer F extends string; readonly aggregate: infer A extends string }
        ? ([F] extends [A] ? ([A] extends [F] ? `"${F}"` : `{ fold: "${F}", aggregate: "${A}" }`) : `{ fold: "${F}", aggregate: "${A}" }`)
        : never;
/** How a nested series index declares a collection, as code. */
type DeclarationCode<D> =
    D extends { kind: "items"; times: infer T; rollup: infer R } ? `items(${TimesCode<T>}${R extends true ? ", { rollup: true }" : ""})`
    : D extends { kind: "values" } ? "values(…)"
    : D extends { kind: "rows" } ? "rows(…)"
    : D extends { kind: "recursive" } ? "recursive()"
    : never;
/** The last field of a place: `"measures.readings"` → `"readings"`. */
type LastField<P extends string> = P extends `${string}.${infer Rest}` ? LastField<Rest> : P;

/** A collection a series reads that the index does not declare. */
type NotDeclared<Use, Place extends string, Name extends string> =
    `Plan: a series reads "${Place}", and the rows source's nested series index "${Name}" does not declare it — declare it e3.recordIndex.series.${Use extends { readonly items: infer T } ? `items(${TimesCode<T>})` : Use extends { readonly values: unknown } ? "values()" : Use extends { readonly rows: unknown } ? "rows({ … })" : "recursive()"}`;

/** Items a series reads: their kind, their times, and whether it rolls them up into each parent. */
type ItemsRefusal<Use, T, D, Place extends string, Name extends string> =
    D extends { kind: "items"; times: infer DT; rollup: infer DR }
        ? (TimesRefusal<T, DT, Place, Name> | (Use extends { readonly rollup: true } ? (DR extends true ? never
            : `Plan: a series rolls its children's runs of "${Place}" up, and "${Name}" files them under no parent — declare it e3.recordIndex.series.items(${TimesCode<DT>}, { rollup: true })`) : never))
    : `Plan: a series reads "${Place}" as items, and "${Name}" declares it ${DeclarationCode<D>} — ${D extends { kind: "values" } ? `read it with Plan.values("${LastField<Place>}", draw)` : "read it as it is declared"}`;

/** Items read by other times than the index files them by. */
type TimesRefusal<T, DT, Place extends string, Name extends string> =
    [TimesCode<T>] extends [TimesCode<DT>] ? ([TimesCode<DT>] extends [TimesCode<T>] ? never : WrongTimes<T, DT, Place, Name>) : WrongTimes<T, DT, Place, Name>;
type WrongTimes<T, DT, Place extends string, Name extends string> =
    `Plan: a series reads "${Place}" ${TimesWords<T>}, and "${Name}" files it ${TimesWords<DT>} — name the times it is filed by`;

/** Values a series reads, and the rollup its parents subtotal them by. */
type ValuesRefusal<V, D, Place extends string, Name extends string> =
    D extends { kind: "values"; rollups: infer R }
        ? V extends { readonly rollup: infer U }
            ? ([R] extends [never]
                ? `Plan: a series subtotals "${Place}" by ${RollupWords<U>}, and "${Name}" keeps no subtotals of it — declare it e3.recordIndex.series.values({ rollup: ${RollupCode<U>} })`
                : [U] extends [R] ? never
                // A count is the index's count, whatever its values fold to.
                : U extends { readonly aggregate: "count" } ? ([Extract<R, { readonly aggregate: "count" }>] extends [never] ? RollupKept<R, U, Place, Name> : never)
                : RollupKept<R, U, Place, Name>)
            : never
    : D extends { kind: "items"; times: infer DT }
        ? `Plan: a series reads "${Place}" as values, and "${Name}" declares it items(${TimesCode<DT>}) — read it with Plan.items("${LastField<Place>}", ${TimesCode<DT>}, draw)`
    : `Plan: a series reads "${Place}" as values, and "${Name}" declares it ${DeclarationCode<D>} — read it as it is declared`;

/** A subtotal by a rollup the index does not keep, a message for each rollup it keeps. */
type RollupKept<R, U, Place extends string, Name extends string> = R extends unknown
    ? `Plan: a series subtotals "${Place}" by ${RollupWords<U>}, and "${Name}" keeps it by ${RollupWords<R>} — add the rollup: e3.recordIndex.series.values({ rollup: [${RollupCode<R>}, ${RollupCode<U>}] }), or subtotal it by ${RollupWords<R>}`
    : never;

/** One collection a series reads, held to how the index declares it; `never` where it reads it as declared. */
type CollectionRefusal<Use, D, Place extends string, Name extends string> =
    [D] extends [undefined] ? NotDeclared<Use, Place, Name>
    : Use extends { readonly items: infer T } ? ItemsRefusal<Use, T, D, Place, Name>
    : Use extends { readonly values: infer V } ? ValuesRefusal<V, D, Place, Name>
    : Use extends { readonly rows: infer CU }
        ? (D extends { kind: "rows"; collections: infer CC } ? CollectionsRefusals<CU, CC, Name, `${Place}.`>
            : `Plan: a series steps down to "${Place}"'s child rows, and "${Name}" declares it ${DeclarationCode<D>} — read it as it is declared`)
    : Use extends { readonly recursive: true }
        ? (D extends { kind: "recursive" } ? never
            : `Plan: a series reads "${Place}" as more rows of its own, and "${Name}" declares it ${DeclarationCode<D>} — read it as it is declared`)
    : never;

/** Each collection a series reads, by its field, held to the declarations beside it. */
type CollectionsRefusals<U, C, Name extends string, Prefix extends string> = {
    [F in keyof U & string]: CollectionRefusal<U[F], F extends keyof C ? C[F] : undefined, `${Prefix}${F}`, Name>
}[keyof U & string];

/** What a series value reads, as its brand says; `unknown` where it reads nothing by name. */
type ReadsOf<E> = E extends { readonly [PlanReadsBrand]?: infer U } ? U : unknown;

/** One series' refusals: none where it reads nothing by name. */
type SeriesRefusals<E, D extends PlanNestedIndexOf<string, unknown>> =
    E extends unknown ? (unknown extends ReadsOf<E> ? never : CollectionsRefusals<ReadsOf<E>, D["collections"], D["index"], "">) : never;

/**
 * Each refusal of a series list by its rows' nested series index, in its
 * words: a union of messages, `never` where every series reads each
 * collection as the index declares it — and where the rows carry no nested
 * series index, or are read whole, or the list is an East expression, which
 * the Plan holds to the index as it is built.
 *
 * @typeParam L - The `series` prop's type: an array of series values
 * @typeParam D - The rows' nested declaration ({@link PlanRowsNestedOf})
 */
export type PlanNestedRefusals<L, D> =
    D extends PlanNestedIndexOf<string, unknown> ? (L extends readonly (infer E)[] ? SeriesRefusals<E, D> : never) : never;

/**
 * A series list held to its rows' nested series index: no constraint where
 * {@link PlanNestedRefusals} has none, and otherwise a property for each,
 * named by its words, which the list lacks — so the editor shows them.
 *
 * @typeParam L - The `series` prop's type
 * @typeParam D - The rows' nested declaration
 */
export type PlanNestedChecked<L, D> = [PlanNestedRefusals<L, D>] extends [never] ? unknown : { readonly [M in PlanNestedRefusals<L, D>]: never };
