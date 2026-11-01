/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio components (#991) — a component is self-contained: an East UI
 * function written exactly like a `ui()` body, which binds its own data, sets
 * up its own slices and returns its UI. Different data is a different
 * component.
 *
 * `Studio.component(key, meta, fn)` returns it as a `Studio.Types.Component`
 * struct, the way `Slice.config` returns a slice config: what the palette
 * shows, what the function reads, and the function itself. A surface lists the components it offers, and the Studio's
 * renderers draw a placement by calling its component's function, so a
 * surface's `ui()` task holds every listed component's function and its
 * manifest is the union of theirs.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    East,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    none,
    some,
    variant,
    type CallableFunctionExpr,
    type ExprType,
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui/internal";
import { DataManifestType, TreePathType } from "@elaraai/e3-types";
import { deriveManifest } from "../utils/derive.js";

// ============================================================================
// Types
// ============================================================================

/**
 * How a component's placements are drawn.
 *
 * @property card - In a tile frame (the default)
 * @property none - Bare, on the canvas and published alike
 */
export const StudioFrameType = VariantType({
    card: NullType,
    none: NullType,
});

/** Type representing how a component's placements are drawn. */
export type StudioFrameType = typeof StudioFrameType;

/** Literal shorthand for {@link StudioFrameType}. */
export type StudioFrameLiteral = "card" | "none";

/**
 * A Studio component — what the palette shows, what the component reads, and
 * the East UI function that renders it.
 *
 * @property key - The component's identity; a cell stores it
 * @property name - Its name, in the palette and the inspector
 * @property category - The palette group it sits in
 * @property icon - A Font Awesome solid icon name
 * @property span - The span a new placement takes, in columns of 12
 * @property description - What it shows — the inspector's "fixed by developer" block
 * @property frame - Drawn in a tile frame, or bare
 * @property tags - Its tags, which the palette's Filter menu offers
 * @property collections - Its collections, which the palette's Filter menu offers
 * @property deprecated - Hidden from the palette; placements keep rendering
 * @property reads - The datasets, functions and records its function binds, derived from its code
 * @property render - The East UI function that renders it
 */
export const StudioComponentType = StructType({
    key: StringType,
    name: StringType,
    category: StringType,
    icon: StringType,
    span: IntegerType,
    description: OptionType(StringType),
    frame: StudioFrameType,
    tags: ArrayType(StringType),
    collections: ArrayType(StringType),
    deprecated: BooleanType,
    reads: DataManifestType,
    render: FunctionType([], UIComponentType),
});

/** Type representing a Studio component. */
export type StudioComponentType = typeof StudioComponentType;

// ============================================================================
// What a component reads, in words
// ============================================================================

/**
 * The name of the data at a path, in words, as the people who build pages
 * read it — never its keypath, nor its name as code spells it: a task's
 * output by its task's name, anything else by its own, its words apart and
 * the first upper case (`.inputs.sales_daily` "Sales daily",
 * `.tasks.weeklyForecast.output` "Weekly forecast").
 */
export const dataName = East.function([TreePathType], StringType, ($, path) => {
    const last = $.let(path.size().subtract(1n));
    // A task's output, `.tasks.<task>.output`, is its task's.
    const output = $.let(path.size().equal(3n)
        .and(() => path.get(0n).unwrap("field").equal("tasks"))
        .and(() => path.get(last).unwrap("field").equal("output")));
    const name = $.let(output.ifElse(() => path.get(1n).unwrap("field"), () => path.get(last).unwrap("field")));
    const words = $.let(name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().lowerCase());
    return words.length().equal(0n).ifElse(
        () => name,
        () => words.substring(0n, 1n).upperCase().concat(words.substring(1n, words.length())),
    );
});

/**
 * The data a component's code reads — each dataset and record it binds, whole
 * or a window at a time — each named in words ({@link dataName}), as the
 * palette's cards, the canvas's tiles and the inspector name it.
 */
export const readNames = East.function([DataManifestType], ArrayType(StringType), (_$, reads) =>
    reads.paths.concat(reads.pages).map((_$2, path) => dataName(path)));

/**
 * What the palette shows of a component — its `meta`. Only `name`,
 * `category` and `icon` are required.
 *
 * @property name - Its name, in the palette and the inspector
 * @property category - The palette group it sits in
 * @property icon - A Font Awesome solid icon name
 * @property span - The span a new placement takes; `12n` when omitted
 * @property description - What it shows — the inspector's "fixed by developer" block
 * @property frame - `"card"` (the default) or `"none"`, which renders bare
 * @property tags - Its tags, which the palette's Filter menu offers
 * @property collections - Its collections, which the palette's Filter menu offers
 * @property deprecated - Hidden from the palette; placements keep rendering
 */
export interface StudioComponentMeta {
    /** Its name, in the palette and the inspector. */
    name: string;
    /** The palette group it sits in. */
    category: string;
    /** A Font Awesome solid icon name. */
    icon: string;
    /** The span a new placement takes, in columns of 12; `12n` when omitted. */
    span?: bigint;
    /** What it shows — the inspector's "fixed by developer" block. */
    description?: string;
    /** `"card"` (the default) or `"none"`, which renders bare, on the canvas and published. */
    frame?: StudioFrameLiteral;
    /** Its tags, which the palette's Filter menu offers. */
    tags?: string[];
    /** Its collections, which the palette's Filter menu offers. */
    collections?: string[];
    /** Hidden from the palette; placements keep rendering. */
    deprecated?: boolean;
}

// ============================================================================
// Authoring
// ============================================================================

/**
 * Declares a Studio component — a self-contained East UI function, and what
 * the palette shows of it.
 *
 * @remarks
 * `fn` is exactly what `ui()` takes, so a component written for a `ui()` body
 * moves into `Studio.component` unchanged. Its `reads` come from its code
 * (`deriveManifest`), never written.
 * Call it at module scope or inside an East function, as `Slice.config` is.
 *
 * @param key - The component's identity; a cell stores it
 * @param meta - What the palette shows ({@link StudioComponentMeta})
 * @param fn - The East UI function that renders it
 * @returns The component, a {@link StudioComponentType} value
 *
 * @example
 * ```tsx
 * import { East, IntegerType, NullType } from "@elaraai/east";
 * import { Button, HStack, Reactive, State, Text, UIComponentType } from "@elaraai/east-ui";
 * import { Studio } from "@elaraai/e3-ui";
 *
 * // A counter: its own state, shared by every placement of it.
 * export const counter = Studio.component("counter", {
 *     name: "Counter", category: "Display", icon: "gauge-high", span: 4n,
 *     description: "Clicks so far",
 * }, East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const clicks = $.let(State.bind([IntegerType], "counter.clicks", 0n));
 *         const add = $.const(East.function([], NullType, $2 => { $2(clicks.write(clicks.read().add(1n))); }));
 *         return (
 *             <HStack gap="3" align="center">
 *                 <Text>{East.str`${East.print(clicks.read())} clicks`}</Text>
 *                 <Button size="xs" onClick={add}>Add</Button>
 *             </HStack>
 *         );
 *     }}</Reactive>
 * )));
 * ```
 */
function createComponent(
    key: string,
    meta: StudioComponentMeta,
    fn: CallableFunctionExpr<[], typeof UIComponentType>,
): ExprType<StudioComponentType> {
    const reads = deriveManifest(fn);
    return East.value({
        key,
        name: meta.name,
        category: meta.category,
        icon: meta.icon,
        span: meta.span ?? 12n,
        description: meta.description === undefined ? none : some(meta.description),
        frame: variant(meta.frame ?? "card", null),
        tags: meta.tags ?? [],
        collections: meta.collections ?? [],
        deprecated: meta.deprecated ?? false,
        reads,
        render: fn,
    }, StudioComponentType);
}

/** What {@link createComponent} is, on the `Studio` namespace. */
export interface StudioComponentNamespace {
    /** Declares a component ({@link createComponent}). */
    component: typeof createComponent;
}

/** The component half of the `Studio` namespace. */
export const StudioComponents: StudioComponentNamespace = {
    component: createComponent,
};
