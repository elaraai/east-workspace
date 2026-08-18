/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The PICK contract (#590) — which of a component's declared things are shown.
 *
 * A Plan picks row series, a Table would pick columns, a Chart layers. The
 * operation is the same one every time: a library of identified things, some
 * switched off, the survivors fed back to the component. This module is the one
 * place that vocabulary is spelled; `Pick.Panel` renders it and never imports a
 * component, exactly as `Slice.Rail` mounts anywhere.
 *
 * # Why it splits in two
 *
 * A `UIComponentType` arm must be a CLOSED East type, so the panel cannot ride
 * a generic. That is not a stylistic call — it is why {@link SliceLegendType}
 * carries `SliceBindType` and not `SliceBindType<T>`. Pick therefore splits at
 * exactly the point where the item type stops mattering:
 *
 * - {@link PickBindType} is NON-GENERIC — a key, a state binding, and a list of
 *   plain-data descriptors. It is the only part that enters the IR, so ONE
 *   panel arm serves every component that ever adopts this.
 * - {@link PickHandleType} is the AUTHOR's handle, and never enters the IR.
 *   `I` rides STRUCTURALLY (in `all` and `id`), the way `C` rides in
 *   {@link PagedSourceType}'s `page` signature, so a handle bound to one item
 *   type is a compile error against a component expecting another.
 *
 * # Why no platform function
 *
 * `state` is literally {@link State.bind}'s `{read, write, has}` pinned at
 * {@link PickStateType}. Pick declares nothing of its own, so it needs neither
 * of the two re-export hops in `east-ui-components` nor the two hard-coded
 * arrays in `e3-ui-components` — the documented "ships broken while tests pass"
 * trap. It also means {@link Pick.active} is provable in a plain `describeEast`
 * spec rather than only in a browser.
 *
 * # Why the state is what is HIDDEN
 *
 * Storing the active list looks equivalent and is not: a thing the author adds
 * in a later release is absent from every user's persisted state, so it
 * silently never appears. Storing what is switched OFF means new arrivals show
 * by default and only explicit removals persist — the same reason `Slice`
 * stores `visible: Option<Set>` with `none` meaning all, minus the `Option`,
 * because an empty HIDDEN list is unambiguous where an empty VISIBLE set is not.
 *
 * # What this contract deliberately does NOT do
 *
 * It does not ORDER. On a key-ordered surface there is nothing for an order to
 * order: a Plan's rows sit in canonical KEY order (`PlanRowsCollectionType` is
 * a `Dict`, and `applySeries` unions with LAST_WINS), so a series' position in
 * the list resolves key collisions and never row position. The panel's own list
 * order is already `all`'s array order. Ordering becomes real for an adopter
 * whose collection is positional — a Table's columns — and belongs to that
 * adopter, not here.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    BooleanType,
    East,
    Expr,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    none,
} from "@elaraai/east";

import { IconType } from "../display/icon/types.js";
import { State } from "../platform/state.js";

// ============================================================================
// The state — what the user switched off
// ============================================================================

/**
 * The pick state — the ids switched OFF. An empty list shows everything.
 *
 * @remarks
 * Deliberately the hidden ids rather than the active ones, and deliberately a
 * bare `Array<String>` rather than a struct: there is exactly one fact to
 * store. See this module's overview for why hidden beats active.
 *
 * Duplicates are harmless ({@link Pick.active} tests membership through a set)
 * and an id that no longer names anything is ignored, so persisted state
 * survives an author renaming or removing an item.
 */
export const PickStateType = ArrayType(StringType);
/** Type alias for {@link PickStateType}. */
export type PickStateType = typeof PickStateType;

/**
 * One pickable thing as the PANEL sees it — plain data, no item type.
 *
 * @remarks
 * This is the whole of what a panel can render, which is what keeps the panel
 * component-agnostic: it never learns what a "series" or a "column" is.
 *
 * @property id - Stable identity — what the state addresses and what `id` returns
 * @property title - The name a user reads (`"Machine jobs"`)
 * @property subtitle - The muted role line (`"one row per machine"`); `none` ⇒ one-line row
 * @property icon - The leading glyph; `none` ⇒ the panel prints no icon
 * @property count - How many things this yields (`"24 rs"`); `none` ⇒ no count printed, which is what a paged source must say
 * @property narrowed - `true` ⇒ the count is a NARROWED count, printed in the brand with a dot
 */
export const PickItemType = StructType({
    id:       StringType,
    title:    StringType,
    subtitle: OptionType(StringType),
    icon:     OptionType(IconType),
    count:    OptionType(IntegerType),
    narrowed: BooleanType,
});
/** Type alias for {@link PickItemType}. */
export type PickItemType = typeof PickItemType;

/**
 * The state binding a pick carries — EXACTLY {@link State.bind}'s return type,
 * pinned at {@link PickStateType}.
 *
 * @remarks
 * Field order matters and is `read` / `write` / `has`, because East struct
 * subtyping is exact — same arity, same names, same order. Declaring it here
 * rather than re-deriving it means a change to `State.bind`'s shape fails this
 * file's build rather than something downstream.
 *
 * Nothing bespoke is introduced: per #106 a bind handle's methods are
 * IR-bearing East functions over plain-data primitives, so a pick handle is
 * ordinary serializable East data and `decodeBeast2For({ platform })` re-binds
 * it to the decoder's store.
 *
 * @property read - The current state; TRACKS the key, so it belongs in a reactive evaluation
 * @property write - Replace the state
 * @property has - Whether the key is set
 */
export const PickStateHandleType = StructType({
    read:  FunctionType([], PickStateType),
    write: FunctionType([PickStateType], NullType),
    has:   FunctionType([], BooleanType),
});
/** Type alias for {@link PickStateHandleType}. */
export type PickStateHandleType = typeof PickStateHandleType;

// ============================================================================
// The contract — non-generic, the only part that rides in IR
// ============================================================================

/**
 * THE CONTRACT — what a panel stores and what any component's IR may hold.
 *
 * @remarks
 * Non-generic by construction, so it embeds directly in a `UIComponentType`
 * arm. A renderer needs nothing else: `key` to self-subscribe, `state` to read
 * and write, `items` to draw.
 *
 * `items` is an EXPRESSION (`all.map(describe)`), not a build-time snapshot, so
 * a count derived from data re-evaluates every reactive frame instead of
 * freezing at authoring time.
 *
 * @property key - The store key; renderers self-subscribe on it, like `SliceBindType.key`
 * @property state - The {@link PickStateHandleType} binding
 * @property items - Every pickable thing, in declaration order
 */
export const PickBindType = StructType({
    key:   StringType,
    state: PickStateHandleType,
    items: ArrayType(PickItemType),
});
/** Type alias for {@link PickBindType}. */
export type PickBindType = typeof PickBindType;

/**
 * The AUTHOR's handle — the contract plus the typed things it selects over.
 *
 * @remarks
 * Never enters the IR. `all` and `id` are what carry `I`, structurally, so the
 * type flows from `Pick.bind` to `Pick.active` and back into the component
 * without a phantom brand and without surviving into a closed arm.
 *
 * @typeParam I - The item type being picked over
 * @param i - The item type value
 * @returns The concrete `StructType` of a handle over `i`
 *
 * @property pick - The non-generic contract handed to {@link Pick.Panel}
 * @property all - Every item that COULD show, in declaration order
 * @property id - An item's stable id — the same one its {@link PickItemType} carries
 */
export const PickHandleType = <I extends EastType>(i: I) => StructType({
    pick: PickBindType,
    all:  ArrayType(i),
    id:   FunctionType([i], StringType),
});

/**
 * The TypeScript type of a {@link PickHandleType} over item type `I`.
 *
 * @typeParam I - The item type being picked over
 */
export type PickHandle<I extends EastType> = ExprType<ReturnType<typeof PickHandleType<I>>>;

// ============================================================================
// Authoring
// ============================================================================

/**
 * How one item describes itself to the panel — the accessors {@link Pick.bind}
 * reifies.
 *
 * @remarks
 * `id` and `title` are required because a thing with no identity cannot be
 * persisted and a thing with no name cannot be offered to a user. Everything
 * else is presentation the panel degrades gracefully without.
 *
 * @typeParam I - The item type being picked over
 */
export interface PickOptions<I extends EastType> {
    /** The item's stable id — what the state addresses. */
    id: (item: ExprType<I>) => SubtypeExprOrValue<StringType>;
    /** The name a user reads. */
    title: (item: ExprType<I>) => SubtypeExprOrValue<StringType>;
    /** The muted role line — return the field's `Option`. */
    subtitle?: (item: ExprType<I>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** The leading glyph — return the field's `Option`. */
    icon?: (item: ExprType<I>) => SubtypeExprOrValue<OptionType<IconType>>;
    /** How many things this item yields — return the field's `Option`; `none` when the source is paged and cannot know. */
    count?: (item: ExprType<I>) => SubtypeExprOrValue<OptionType<IntegerType>>;
    /** `true` ⇒ the count is a narrowed count. */
    narrowed?: (item: ExprType<I>) => SubtypeExprOrValue<BooleanType>;
    /** Ids switched off to begin with; omit ⇒ everything shows. */
    hidden?: readonly string[];
}

/**
 * Build a {@link PickStateType} seed.
 *
 * @param hidden - The ids switched off; omit ⇒ everything shows
 * @returns The state expression
 *
 * @example
 * ```ts
 * Pick.state()                 // everything shows
 * Pick.state(["crew"])         // "crew" starts switched off
 * ```
 */
export function createPickState(hidden?: readonly string[]): ExprType<PickStateType> {
    return East.value([...(hidden ?? [])], PickStateType);
}

/**
 * Bind a list of things to a persisted pick.
 *
 * @remarks
 * Takes NO item-type argument — `I` is already carried by `all`, recovered with
 * the `Expr.type` idiom, so the call reads the way the author thinks about it.
 *
 * The accessors are REIFIED once into a single describe function which the map
 * then CALLS, per the factory rule (`shared/reify.ts`, `EAST_UI_PROP_PATTERNS.md`)
 * — never invoked mid-map with their expression trees spliced in.
 *
 * Bind exactly ONCE, in the same reactive evaluation that mounts both the panel
 * and the component. A `Reactive.Root` body is a free function and cannot
 * capture a `$.let` handle from an enclosing scope, so a panel that is its own
 * root would need its own bind — two binds on one key work (they share the
 * store) but must be given identical item lists, or the two surfaces disagree
 * about what exists.
 *
 * @typeParam I - The item type being picked over
 * @param key - The store key; also the persistence key
 * @param all - Every item that COULD show — an expression of `Array<I>`
 * @param options - The per-item accessors and the seed ({@link PickOptions})
 * @returns A {@link PickHandleType} over `I`
 *
 * @example
 * ```tsx
 * const shown = $.let(Pick.bind("orders.cols", cols, {
 *     id:    c => c.key,
 *     title: c => c.header,
 *     hidden: ["price"],
 * }));
 *
 * <Pick.Panel value={shown} title="Columns" />
 * <Table data={orders} columns={Pick.active(shown)} />
 * ```
 */
export function createPickBind<I extends EastType>(
    key: string,
    all: SubtypeExprOrValue<ArrayType<I>>,
    options: PickOptions<I>,
): PickHandle<I> {
    const allExpr = East.value(all as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    const itemType: EastType = (Expr.type(allExpr) as ArrayType<EastType>).value;
    const opts = options as unknown as PickOptions<EastType>;

    // Reified ONCE, outside every block; the map below CALLS them.
    const idFn = East.function([itemType], StringType, (_$, item) => opts.id(item));
    const describe = East.function([itemType], PickItemType, (_$, item) => ({
        id:       idFn(item),
        title:    opts.title(item),
        subtitle: opts.subtitle !== undefined ? opts.subtitle(item) : none,
        icon:     opts.icon !== undefined ? opts.icon(item) : none,
        count:    opts.count !== undefined ? opts.count(item) : none,
        narrowed: opts.narrowed !== undefined ? opts.narrowed(item) : false,
    }));

    const pick = East.value({
        key:   East.value(key, StringType),
        // The state IS `State.bind`'s handle — nothing bespoke, and per #106 it
        // serializes and re-binds like any other bound value.
        state: State.bind([PickStateType], key, createPickState(options.hidden)),
        items: allExpr.map((_$, item) => describe(item)),
    }, PickBindType);

    // Two-step cast (the `Paged.of` idiom): the members are built against the
    // item type recovered from the expression, which TS sees as the erased
    // `EastType`. The East-side type is what actually types the value.
    return East.value({
        pick,
        all: allExpr,
        id:  idFn,
    }, PickHandleType(itemType)) as unknown as PickHandle<I>;
}

/**
 * The items still switched on, in DECLARATION order — the feed a component takes.
 *
 * @remarks
 * The twin of `Slice.rows(...)`: one tracked read, one derivation, and the
 * result is an ordinary expression the component's own prop already accepts.
 * For a Plan that means `series={Pick.active(shown)}` needs no Plan change at
 * all, because `PlanSeriesInput` already accepts the expression form.
 *
 * Declaration order, never the state's — see this module's overview. An id in
 * the state that names nothing is ignored, so a rename or removal degrades to
 * "shown" rather than to an error.
 *
 * Call this INSIDE the reactive evaluation that renders the component: the read
 * is what registers the dependency that repaints on a toggle.
 *
 * @typeParam I - The item type being picked over
 * @param handle - The handle from {@link Pick.bind}
 * @returns The surviving items, as `Array<I>`
 */
export function pickActive<I extends EastType>(handle: PickHandle<I>): ExprType<ArrayType<I>> {
    const h = handle as unknown as ExprType<StructType<{
        pick: PickBindType;
        all: ArrayType<EastType>;
        id: FunctionType<[EastType], StringType>;
    }>>;
    // The tracked read is the ONLY thing this adds over `pickVisible`, which is
    // what makes the derivation itself testable without a State runtime.
    return pickVisible(h.all, h.id, h.pick.state.read()) as unknown as ExprType<ArrayType<I>>;
}

/**
 * The derivation on its own — items minus a hidden list, with NO state binding.
 *
 * @remarks
 * {@link Pick.active} is this plus one tracked read, so proving this proves the
 * shipped behaviour. It exists split out because the semantics are the part
 * worth testing and `State.bind` is not runnable in a `describeEast` spec —
 * `TestImpl` carries no State runtime (`test/platform/state.spec.ts` is
 * compile-only for exactly this reason). Here the hidden list is a plain value,
 * so the whole contract is provable with no platform function at all.
 *
 * Three behaviours it fixes, all of them things a bare `active` list gets
 * wrong: declaration order is preserved, an id naming nothing is ignored, and
 * an item absent from the list still shows.
 *
 * @typeParam I - The item type being picked over
 * @param all - Every item that COULD show
 * @param id - An item's stable id
 * @param hidden - The ids switched off
 * @returns The surviving items, in declaration order
 */
export function pickVisible<I extends EastType>(
    all: SubtypeExprOrValue<ArrayType<I>>,
    id: SubtypeExprOrValue<FunctionType<[I], StringType>>,
    hidden: SubtypeExprOrValue<PickStateType>,
): ExprType<ArrayType<I>> {
    const allExpr = East.value(all as SubtypeExprOrValue<ArrayType<EastType>>) as ExprType<ArrayType<EastType>>;
    const listType = Expr.type(allExpr) as ArrayType<EastType>;
    const idType = FunctionType([listType.value as EastType], StringType);
    // Everything the block touches arrives as a PARAMETER: a JS const holding
    // an East expression is re-inlined — and re-evaluated — at every use.
    const fn = East.function([PickStateType, listType, idType], listType, ($, off, items, idOf) => {
        const hiddenSet = $.let(off.toSet(), SetType(StringType));
        return items.filter((_$, item) => hiddenSet.has(idOf(item)).not());
    });
    // Two-step cast (the `Paged.of` idiom): `fn` is built against the item type
    // recovered from the expression, which TS sees as the erased `EastType`
    // rather than the caller's `I`. The East-side types are what type the call.
    const idErased = id as unknown as SubtypeExprOrValue<FunctionType<[EastType], StringType>>;
    return fn(hidden, allExpr, idErased) as unknown as ExprType<ArrayType<I>>;
}

/**
 * The `Pick` namespace — choosing which of a component's declared things show.
 *
 * @remarks
 * Bind a list with {@link Pick.bind}, feed the survivors to the component with
 * {@link Pick.active}, and render the library with `Pick.Panel`. The handle is
 * what decouples them: the panel never imports the component, and the component
 * never learns a panel exists.
 */
export const Pick = {
    /** Build a state seed — the ids switched off. */
    state: createPickState,
    /** Bind a list of things to a persisted pick. */
    bind: createPickBind,
    /** The items still switched on, in declaration order. */
    active: pickActive,
    /** The derivation alone — items minus a hidden list, no state binding. */
    visible: pickVisible,
    /** East types — the contract, for `$.const` / `$.let` annotations. */
    Types: {
        /** The ids switched off (an empty list shows everything). */
        State: PickStateType,
        /** One pickable thing as the panel sees it. */
        Item: PickItemType,
        /** The state binding — `State.bind`'s shape at {@link PickStateType}. */
        StateHandle: PickStateHandleType,
        /** The non-generic contract a component's IR holds. */
        Bind: PickBindType,
        /** The author's handle, at an item type. */
        Handle: PickHandleType,
    },
} as const;
