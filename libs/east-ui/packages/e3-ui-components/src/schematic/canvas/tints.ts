/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An entity's colour, as its roles name it (#1387, D14, SC26): an item's
 * colour token, else its tone, else its status's; a zone's colour token, else
 * its tone, else its pattern's; a link's or a net's style's tone — one whose
 * style names none draws in the shared links look's muted ink, which the theme
 * bridge reads from the links part (#1403); a layer's swatch its colour token,
 * else its tone (#1389). The
 * recipe's one chain of custom properties resolves it, for
 * the canvas — through the theme bridge's probe (`theme.tsx`) — and for an
 * item's card alike, so both draw one colour in each mode, and a value naming
 * no theme colour token draws the tone. This module only names what to
 * resolve: each entity's colour roles, the key they are resolved under, and
 * every colour a drawing needs. Pure, unit-tested in `tints.test.ts`.
 *
 * @packageDocumentation
 */

import { match, type option } from "@elaraai/east";
import type { RGB } from "./paint";
import type { DrawnItem, DrawnLink, DrawnNet, DrawnZone, SchematicDrawn } from "./drawn";
import type { SchematicLayerValue } from "./layers";

/** An Option's value, or `undefined` — East's `match`, as paint.ts reads one: this module loads no renderer. */
const getSomeorUndefined = <T,>(opt: option<T>): T | undefined => match(opt, { some: (value) => value }, undefined);

/**
 * An entity's colour roles, as the recipe's chain takes them from its data
 * attributes: its surface (whose ground colour is the last resort), its
 * colour token, its tone, its status's tone and its pattern's tone.
 */
export interface SchematicTint {
    /** `item`, `zone` or `link` (a net's too): what its tone's `muted` and its ground are. */
    readonly surface: "item" | "zone" | "link";
    /** A theme colour token (`status.warn`, `heat.3`): drawn when the theme holds it, else its tone. */
    readonly color?: string | undefined;
    /** Its tone: brand, ink, muted, success, warning or danger. */
    readonly tone?: string | undefined;
    /** Its status's tone: success, warning, danger, info or neutral. */
    readonly status?: string | undefined;
    /** A zone's pattern's tone. */
    readonly pattern?: string | undefined;
}

/**
 * An item's colour roles: its colour token, its tone, its status's — the
 * colour of its card's dot, its markers and its footprint.
 *
 * @param item - The item, as the canvas draws it
 * @returns Its colour roles
 */
export function itemTint(item: DrawnItem): SchematicTint {
    const status = getSomeorUndefined(item.status);
    return { surface: "item", color: getSomeorUndefined(item.color), tone: getSomeorUndefined(item.tone)?.type, status: status?.tone.type };
}

/**
 * A zone's colour roles: its colour token, its tone, its pattern's tone — muted
 * when its pattern names none (§4.2).
 *
 * @param zone - The zone, as the canvas draws it
 * @returns Its colour roles
 */
export function zoneTint(zone: DrawnZone): SchematicTint {
    const pattern = getSomeorUndefined(zone.pattern.value.tone)?.type ?? "muted";
    return { surface: "zone", color: getSomeorUndefined(zone.color), tone: getSomeorUndefined(zone.tone)?.type, pattern };
}

/**
 * A link's or a net's colour roles: its style's tone (#1403). A style naming
 * none has no colour of its own: it draws in the shared links look's muted ink,
 * as the Plan's and the Allocation's links do.
 *
 * @param edge - The link or the net, as the canvas draws it
 * @returns Its colour roles; `undefined` for a style naming no tone
 */
export function edgeTint(edge: DrawnLink | DrawnNet): SchematicTint | undefined {
    const tone = getSomeorUndefined(edge.style.value.tone)?.type;
    return tone === undefined ? undefined : { surface: "link", tone };
}

/**
 * A layer's swatch's colour roles, in the library's Layers tab (#1389, §8):
 * its colour token, else its tone, else an item's ground.
 *
 * @param layer - The layer
 * @returns Its colour roles
 */
export function layerTint(layer: SchematicLayerValue): SchematicTint {
    return { surface: "item", color: getSomeorUndefined(layer.color), tone: getSomeorUndefined(layer.tone)?.type };
}

/**
 * The key a colour is resolved under: its roles, each in its place.
 *
 * @param tint - The colour roles
 * @returns Its key
 */
export function tintKey(tint: SchematicTint): string {
    return JSON.stringify([tint.surface, tint.color ?? "", tint.tone ?? "", tint.status ?? "", tint.pattern ?? ""]);
}

/**
 * The data attributes the recipe's chain reads a colour from: what the
 * probe's element and an item's card dot carry.
 *
 * @param tint - The colour roles
 * @returns The attributes, each only when its role is given
 */
export function tintAttributes(tint: SchematicTint): Readonly<Record<string, string>> {
    return {
        "data-surface": tint.surface,
        ...(tint.color === undefined ? {} : { "data-color": tint.color }),
        ...(tint.tone === undefined ? {} : { "data-tone": tint.tone }),
        ...(tint.status === undefined ? {} : { "data-status": tint.status }),
        ...(tint.pattern === undefined ? {} : { "data-pattern": tint.pattern }),
    };
}

/** Every colour a drawing draws its entities in, and each entity's. */
export interface SchematicTints {
    /** Each colour, by its key, in the order the drawing first names it. */
    readonly specs: ReadonlyMap<string, SchematicTint>;
    /** Each entity's colour's key, by the entity's id. */
    readonly byEntity: ReadonlyMap<string, string>;
    /** The colours' keys, in order: equal whenever the drawing names the same colours. */
    readonly signature: string;
}

/**
 * Every colour a drawing draws its entities in (see the module docs).
 *
 * @param drawn - What the canvas draws
 * @returns The colours, and each entity's
 */
export function tintsOf(drawn: SchematicDrawn): SchematicTints {
    const specs = new Map<string, SchematicTint>();
    const byEntity = new Map<string, string>();
    const take = (id: string, tint: SchematicTint | undefined) => {
        if (tint === undefined) return;
        const key = tintKey(tint);
        if (!specs.has(key)) specs.set(key, tint);
        byEntity.set(id, key);
    };
    for (const item of drawn.items) take(item.key, itemTint(item));
    for (const zone of drawn.zones) take(zone.key, zoneTint(zone));
    for (const link of drawn.links) take(link.key, edgeTint(link));
    for (const net of drawn.nets) take(net.key, edgeTint(net));
    return { specs, byEntity, signature: [...specs.keys()].join("\n") };
}

/**
 * Each entity's colour, resolved: its colour's RGB, by the entity's id.
 *
 * @param byEntity - Each entity's colour's key, by its id
 * @param resolved - Each colour's RGB, by its key, as the bridge read it
 * @returns Each entity's RGB; an entity whose colour was not read is left out, and draws its kind's ground
 */
export function entityTints(byEntity: ReadonlyMap<string, string>, resolved: ReadonlyMap<string, RGB>): Map<string, RGB> {
    const out = new Map<string, RGB>();
    for (const [id, key] of byEntity) {
        const rgb = resolved.get(key);
        if (rgb !== undefined) out.set(id, rgb);
    }
    return out;
}
