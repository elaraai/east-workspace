/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A slot recipe's styles, made once per theme and variants (#1398, CL9).
 *
 * Chakra's `useSlotRecipe` makes its recipe afresh for each component that
 * asks for it — a structured clone of the recipe, every slot's styles worked
 * out at each call — so a part drawn many times (a placeholder shape in every
 * cell of an unloaded run) or drawn again at every landing (a builder's
 * library, its rail) paid for every slot of its recipe each time. The styles
 * are the same for every caller in one theme: here they are made once for the
 * theme's system, the recipe and the variants asked for, and handed to every
 * caller as the same object.
 *
 * @packageDocumentation
 */

import { useChakraContext, type SystemStyleObject } from "@chakra-ui/react";

/** A slot recipe's styles: each slot's. */
export type SlotStyles = Record<string, SystemStyleObject>;

/** A recipe's variants, as its callers name them: each a word or a flag. */
export type SlotVariants = Readonly<Record<string, string | boolean | undefined>>;

/** The theme's system, as a cache's key: what `useChakraContext` hands every caller in one provider. */
type System = ReturnType<typeof useChakraContext>;

/** Each system's styles, by recipe and variants. */
const made = new WeakMap<System, Map<string, SlotStyles>>();

/** The variants as one key: each named once, in name order, so two callers naming the same ones in another order share it. */
function variantsKey(variants: SlotVariants | undefined): string {
    if (variants === undefined) return "";
    return Object.keys(variants).sort().filter((name) => variants[name] !== undefined).map((name) => `${name}=${variants[name]}`).join("&");
}

/**
 * A slot recipe's styles for the variants asked for — made once for the theme
 * and handed to every caller as the same object (see the module docs). What a
 * component calls in place of `useSlotRecipe({ key })(variants)`.
 *
 * @param key - The slot recipe's key in the theme
 * @param variants - Its variants; omitted, its defaults
 * @returns Each slot's styles — the same object for every caller asking for the same recipe and variants in the theme
 */
export function useSlotStyles(key: string, variants?: SlotVariants): SlotStyles {
    const system = useChakraContext();
    let bySystem = made.get(system);
    if (bySystem === undefined) {
        bySystem = new Map();
        made.set(system, bySystem);
    }
    const id = `${key}\u0000${variantsKey(variants)}`;
    let styles = bySystem.get(id);
    if (styles === undefined) {
        // As `useSlotRecipe` makes it: the recipe cloned, then its slots' styles for the variants — each slot's style
        // object, which Chakra's types call loosely.
        styles = system.sva(structuredClone(system.getSlotRecipe(key)))(variants) as unknown as SlotStyles;
        bySystem.set(id, styles);
    }
    return styles;
}
