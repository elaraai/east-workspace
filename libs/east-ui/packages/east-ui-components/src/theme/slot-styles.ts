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
 * A part drawn a thousand times at once — the Calendar timeline's event
 * blocks, as a glide mounts them — draws plain elements with its slots'
 * classes (`useSlotClass`), each made once a theme: Chakra's styled element
 * works its styles out again at every element it draws — its css function
 * keys its cache by the whole style object, printed, and emotion serialises
 * and hashes what that gives — and a class made once costs an element
 * nothing.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { useChakraContext, type SystemStyleObject } from "@chakra-ui/react";
import { __unsafe_useEmotionCache as useEmotionCache, css as serialize, type CSSObject, type EmotionCache, type SerializedStyles } from "@emotion/react";

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

/** A slot's styles, as a slot recipe gives them: Chakra's style object, which a renderer's own recipe types may call loosely. */
export type SlotStyle = SystemStyleObject | Readonly<Record<string, unknown>>;

/** Each system's classes, by the emotion cache they are inserted in, then by the style object each was made of. */
const classes = new WeakMap<System, WeakMap<EmotionCache, WeakMap<object, string>>>();

/**
 * A style's rules inserted in an emotion cache under their class, once — as emotion inserts a styled element's — and
 * the class.
 *
 * @param cache - The emotion cache the theme's elements are styled in
 * @param serialized - The style, serialised
 * @returns Its class
 */
function insertClass(cache: EmotionCache, serialized: SerializedStyles): string {
    const name = `${cache.key}-${serialized.name}`;
    if (cache.inserted[serialized.name] === undefined) {
        let rules: SerializedStyles | undefined = serialized;
        do {
            cache.insert(rules === serialized ? `.${name}` : "", rules, cache.sheet, true);
            rules = rules.next;
        } while (rules !== undefined);
    }
    return name;
}

/**
 * The class of a slot's styles — the class Chakra gives an element drawn with them — made and inserted once for the
 * theme, for a part drawn many times at once to draw plain elements by (see the module docs). Its recipe owns every
 * style still; the element sets its class, its data attributes and its geometry.
 *
 * @returns A slot's styles' class: the same string for every caller in the theme; `""` for none
 */
export function useSlotClass(): (style: SlotStyle | undefined) => string {
    const system = useChakraContext();
    const cache = useEmotionCache();
    // A page's emotion cache: the one Chakra's styled elements insert theirs in, which a browser's context always holds.
    if (cache === null) throw new Error("useSlotClass: no emotion cache to insert a slot's class in");
    return useMemo(() => {
        let byCache = classes.get(system);
        if (byCache === undefined) {
            byCache = new WeakMap();
            classes.set(system, byCache);
        }
        let byStyle = byCache.get(cache);
        if (byStyle === undefined) {
            byStyle = new WeakMap();
            byCache.set(cache, byStyle);
        }
        const known = byStyle;
        return (style) => {
            if (style === undefined) return "";
            let name = known.get(style);
            if (name === undefined) {
                // As Chakra's styled element works it out: the system's css of the style, serialised by emotion.
                name = insertClass(cache, serialize(system.css(style as SystemStyleObject) as CSSObject));
                known.set(style, name);
            }
            return name;
        };
    }, [system, cache]);
}
