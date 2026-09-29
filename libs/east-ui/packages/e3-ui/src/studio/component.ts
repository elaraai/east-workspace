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
 * shows, what the function reads, the fingerprint of its code, and the
 * function itself. A surface lists the components it offers, and a placement
 * renders by calling its component's function ({@link dispatchComponent}), so
 * a surface's `ui()` task holds every listed component's function and its
 * manifest is the union of theirs.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    East,
    FunctionType,
    IRType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    encodeBeast2For,
    none,
    sha256Hex,
    some,
    variant,
    type CallableFunctionExpr,
    type ExprType,
    type IR,
} from "@elaraai/east";
import { Banner, EmptyState, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { DataManifestType } from "@elaraai/e3-types";
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
 * A Studio component — what the palette shows, what the component reads, the
 * fingerprint of its code, and the East UI function that renders it.
 *
 * @property key - The component's identity; a cell stores it
 * @property name - Its name, in the palette and the inspector
 * @property category - The palette group it sits in
 * @property icon - A Font Awesome solid icon name
 * @property span - The span a new placement takes, in columns of 12
 * @property description - What it shows — the inspector's "fixed by developer" block and the catalog's card
 * @property frame - Drawn in a tile frame, or bare
 * @property tags - The catalog's tags
 * @property collections - The catalog's collections
 * @property owner - Who owns it, in the catalog
 * @property thumbnail - The catalog card's image; `none` draws the component itself at thumbnail scale
 * @property deprecated - Hidden from the palette and the catalog; placements keep rendering
 * @property reads - The datasets, functions and records its function binds, derived from its code
 * @property fingerprint - A hash of its code; a cell stores it when saved, so a code change shows
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
    owner: OptionType(StringType),
    thumbnail: OptionType(StringType),
    deprecated: BooleanType,
    reads: DataManifestType,
    fingerprint: StringType,
    render: FunctionType([], UIComponentType),
});

/** Type representing a Studio component. */
export type StudioComponentType = typeof StudioComponentType;

/**
 * What the palette shows of a component — its `meta`. Only `name`,
 * `category` and `icon` are required.
 *
 * @property name - Its name, in the palette and the inspector
 * @property category - The palette group it sits in
 * @property icon - A Font Awesome solid icon name
 * @property span - The span a new placement takes; `12n` when omitted
 * @property description - What it shows — the inspector's "fixed by developer" block and the catalog's card
 * @property frame - `"card"` (the default) or `"none"`, which renders bare
 * @property tags - The catalog's tags
 * @property collections - The catalog's collections
 * @property owner - Who owns it, in the catalog
 * @property thumbnail - The catalog card's image; omitted, the component itself at thumbnail scale
 * @property deprecated - Hidden from the palette and the catalog; placements keep rendering
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
    /** What it shows — the inspector's "fixed by developer" block and the catalog's card. */
    description?: string;
    /** `"card"` (the default) or `"none"`, which renders bare, on the canvas and published. */
    frame?: StudioFrameLiteral;
    /** The catalog's tags. */
    tags?: string[];
    /** The catalog's collections. */
    collections?: string[];
    /** Who owns it, in the catalog. */
    owner?: string;
    /** The catalog card's image; omitted, the component itself at thumbnail scale. */
    thumbnail?: string;
    /** Hidden from the palette and the catalog; placements keep rendering. */
    deprecated?: boolean;
}

// ============================================================================
// The fingerprint
// ============================================================================

const encodeIR = encodeBeast2For(IRType);

/**
 * The IR in a canonical form: every location id zeroed and every variable
 * renamed by its first appearance, so the same code has the same IR wherever
 * it is written and whatever was built before it.
 */
function canonicalIR(ir: IR): IR {
    const names = new Map<string, string>();
    const walk = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(walk);
        if (node === null || typeof node !== "object") return node;
        const proto = Object.getPrototypeOf(node);
        if (proto !== Object.prototype && proto !== null) return node;
        const out: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(node)) {
            out[field] = field === "loc_id" ? 0n : walk(value);
        }
        const v = out as { type?: unknown; value?: { name?: unknown } };
        if (v.type === "Variable" && v.value !== undefined && typeof v.value.name === "string") {
            const name = v.value.name;
            let canonical = names.get(name);
            if (canonical === undefined) {
                canonical = `v${names.size}`;
                names.set(name, canonical);
            }
            v.value = { ...v.value, name: canonical };
        }
        return out;
    };
    return walk(ir) as IR;
}

/**
 * A function's fingerprint: the SHA-256 of its IR in canonical form. The same
 * code fingerprints the same; a change to it changes the fingerprint.
 *
 * @param fn - The function
 * @returns The fingerprint, hex
 */
export function fingerprintOf(fn: { toIR(): { ir: IR } }): string {
    return sha256Hex(encodeIR(canonicalIR(fn.toIR().ir)));
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
 * (`deriveManifest`), and its `fingerprint` from its IR — neither is written.
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
        owner: meta.owner === undefined ? none : some(meta.owner),
        thumbnail: meta.thumbnail === undefined ? none : some(meta.thumbnail),
        deprecated: meta.deprecated ?? false,
        reads,
        fingerprint: fingerprintOf(fn),
        render: fn,
    }, StudioComponentType);
}

// ============================================================================
// The dispatcher
// ============================================================================

/**
 * Renders one placement: the component the surface lists under `key`, by
 * calling its function. A key the surface does not list renders a placeholder
 * naming it; a key two listed components share renders an error naming it.
 * A deprecated component's placements keep rendering.
 */
export const dispatchComponent = East.function(
    [ArrayType(StudioComponentType), StringType],
    UIComponentType,
    ($, components, key) => {
        const listed = $.let(components.filter((_$, c) => c.key.equal(key)));
        $.if(listed.size().greater(1n), ($2) => {
            $2.return(Banner.Root({
                status: "error",
                title: Text.Root(East.str`Two components share the key "${key}"`),
                description: "A surface lists each component once.",
            }));
        });
        $.if(listed.size().equal(0n), ($2) => {
            $2.return(EmptyState.Root({
                title: Text.Root(East.str`No component "${key}"`),
                description: "This surface lists no component with this key.",
                icon: { prefix: "fas", name: "puzzle-piece" },
            }));
        });
        const component = $.let(listed.get(0n));
        return component.render();
    },
);

/** What {@link createComponent} and the dispatcher are, on the `Studio` namespace. */
export interface StudioComponentNamespace {
    /** Declares a component ({@link createComponent}). */
    component: typeof createComponent;
    /** Renders one placement by its component's key ({@link dispatchComponent}). */
    dispatch: typeof dispatchComponent;
}

/** The component half of the `Studio` namespace. */
export const StudioComponents: StudioComponentNamespace = {
    component: createComponent,
    dispatch: dispatchComponent,
};
