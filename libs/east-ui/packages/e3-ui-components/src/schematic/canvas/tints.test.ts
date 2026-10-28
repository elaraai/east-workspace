/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * An entity's colour, as its roles name it (#1387, `tints.ts`, D14, SC26): an
 * item's colour token, else its tone, else its status's; a zone's colour token,
 * else its tone, else its pattern's — muted when its pattern names none; a
 * link's or a net's style's tone, else its style's own; a layer's swatch its
 * colour token, else its tone (#1389). What the recipe's chain is given is the
 * same for the canvas's probe, an item's card dot and a layer's swatch: the
 * data attributes each role sets. Fixtures are real East values, made what the
 * canvas draws by `drawn.ts`.
 */

import { describe, test, expect } from "vitest";
import { defaultValue, none, some, variant } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnLink, drawnNet, drawnZone, entityId, type ItemRoles, type LinkRoles, type NetRoles, type ZoneRoles } from "./drawn";
import { edgeTint, entityTints, itemTint, layerTint, tintAttributes, tintKey, tintsOf, zoneTint } from "./tints";

const RACK = { kind: "racks", key: "A01" };
const FRAME = { kind: "network", key: "ODF-1" };

/** A rack drawn at (2, 3), its other roles as given, else its types' defaults. */
const rack = (over: Partial<ItemRoles> = {}, ref = RACK) => drawnItem(ref, {
    ...defaultValue<typeof Schematic.Types.Item>(Schematic.Types.Item), position: some({ x: 2, y: 3 }), label: ref.key, ...over,
}, undefined)!;

/** An area, its pattern and other roles as given. */
const area = (over: Partial<ZoneRoles> = {}) => drawnZone({ kind: "areas", key: "cage-a" }, {
    ...defaultValue<typeof Schematic.Types.Zone>(Schematic.Types.Zone), width: 4, height: 2, label: "Cage A", ...over,
});

/** A fibre run from the rack to the frame, its style as given. */
const run = (style: LinkRoles["style"]) => drawnLink({ kind: "fibre", key: "u1" }, {
    ...defaultValue<typeof Schematic.Types.Link>(Schematic.Types.Link), from: RACK, to: FRAME, style,
});

/** A power feed from the frame to the rack, its style as given. */
const feed = (style: NetRoles["style"]) => drawnNet({ kind: "feeds", key: "f1" }, {
    ...defaultValue<typeof Schematic.Types.Net>(Schematic.Types.Net), sources: [FRAME], destinations: [RACK], style,
});

const HOT = some({ label: "Hot", tone: variant("danger", null), ring: false });

describe("an item's colour", () => {
    test("names its colour token, its tone and its status's tone, each where it gives one", () => {
        expect(itemTint(rack({ color: some("status.warn"), tone: some(variant("brand", null)), status: HOT })))
            .toEqual({ surface: "item", color: "status.warn", tone: "brand", status: "danger" });
        expect(itemTint(rack({ status: HOT }))).toEqual({ surface: "item", color: undefined, tone: undefined, status: "danger" });
        // An item that names no colour draws its surface's ground.
        expect(tintAttributes(itemTint(rack()))).toEqual({ "data-surface": "item" });
    });

    test("is given to the recipe's chain as the data attributes of each role it names", () => {
        expect(tintAttributes(itemTint(rack({ color: some("heat.3"), status: HOT })))).toEqual({
            "data-surface": "item", "data-color": "heat.3", "data-status": "danger",
        });
    });
});

describe("a zone's colour", () => {
    test("its pattern's tone is muted where its pattern names none, and its tone and colour token are its own", () => {
        expect(zoneTint(area({ pattern: variant("outline", { tone: none }) }))).toEqual({ surface: "zone", color: undefined, tone: undefined, pattern: "muted" });
        expect(zoneTint(area({ pattern: variant("hatch", { tone: some(variant("warning", null)), spacing: none, angle: none }) })).pattern).toBe("warning");
        expect(tintAttributes(zoneTint(area({ pattern: variant("outline", { tone: none }), tone: some(variant("danger", null)), color: some("heat.5") })))).toEqual({
            "data-surface": "zone", "data-color": "heat.5", "data-tone": "danger", "data-pattern": "muted",
        });
    });
});

describe("a link's and a net's colour", () => {
    test("is its style's tone; a style naming none has no colour of its own, and draws in the links look's muted ink (#1403)", () => {
        expect(edgeTint(run(variant("solid", { tone: none, weight: none })))).toBeUndefined();
        expect(edgeTint(run(variant("dashed", { tone: none, weight: none })))).toBeUndefined();
        expect(edgeTint(run(variant("dashed", { tone: some(variant("danger", null)), weight: none })))).toEqual({ surface: "link", tone: "danger" });
        expect(edgeTint(feed(variant("solid", { tone: some(variant("success", null)), weight: some(3) })))).toEqual({ surface: "link", tone: "success" });
    });
});

describe("a layer's swatch", () => {
    test("is its colour token, else its tone, else an item's ground", () => {
        const layer = { key: "power", label: "Power", visible: none, locked: none, opacity: none, tone: none, color: none };
        expect(tintAttributes(layerTint(layer))).toEqual({ "data-surface": "item" });
        expect(tintAttributes(layerTint({ ...layer, tone: some(variant("warning", null)) }))).toEqual({ "data-surface": "item", "data-tone": "warning" });
        expect(tintAttributes(layerTint({ ...layer, tone: some(variant("warning", null)), color: some("status.warn") }))).toEqual({
            "data-surface": "item", "data-color": "status.warn", "data-tone": "warning",
        });
    });
});

describe("a drawing's colours", () => {
    test("each colour once, in the order the drawing first names it, and each entity's by its id", () => {
        const a01 = rack({ status: HOT });
        const a02 = rack({ status: HOT }, { kind: "racks", key: "A02" });
        const a03 = rack({ color: some("status.info") }, { kind: "racks", key: "A03" });
        const tints = tintsOf({
            items: [a01, a02, a03], zones: [area()], links: [run(variant("solid", { tone: some(variant("warning", null)), weight: none }))], nets: [],
        });
        expect([...tints.specs.values()]).toEqual([
            itemTint(a01), itemTint(a03), zoneTint(area()), { surface: "link", tone: "warning" },
        ]);
        expect(tints.byEntity.get(a01.key)).toBe(tintKey(itemTint(a01)));
        expect(tints.byEntity.get(a02.key)).toBe(tintKey(itemTint(a01)));
        expect(tints.byEntity.get(entityId({ kind: "fibre", key: "u1" }))).toBe(tintKey({ surface: "link", tone: "warning" }));
        // A run whose style names no tone has none to resolve: it draws in the links look's ink.
        expect(tintsOf({ items: [], zones: [], links: [run(variant("solid", { tone: none, weight: none }))], nets: [] }).byEntity.size).toBe(0);
    });

    test("its signature holds while the drawing names the same colours, and moves when one changes", () => {
        const one = tintsOf({ items: [rack({ status: HOT })], zones: [], links: [], nets: [] });
        const moved = tintsOf({ items: [rack({ status: HOT, label: "A01 moved" })], zones: [], links: [], nets: [] });
        const recoloured = tintsOf({ items: [rack({ status: some({ label: "OK", tone: variant("success", null), ring: false }) })], zones: [], links: [], nets: [] });
        expect(moved.signature).toBe(one.signature);
        expect(recoloured.signature).not.toBe(one.signature);
    });

    test("a colour's key tells apart roles that name the same words in different places", () => {
        expect(tintKey({ surface: "item", tone: "danger" })).not.toBe(tintKey({ surface: "item", status: "danger" }));
        expect(tintKey({ surface: "item", tone: "muted" })).not.toBe(tintKey({ surface: "zone", tone: "muted" }));
        expect(tintKey({ surface: "item", color: "heat.3" })).toBe(tintKey({ surface: "item", color: "heat.3" }));
    });

    test("each entity's colour is its colour's as the bridge read it; one not read is left out, to draw its kind's ground", () => {
        const byEntity = new Map([["a", "k1"], ["b", "k2"], ["c", "k1"]]);
        const resolved = new Map<string, [number, number, number]>([["k1", [10, 20, 30]]]);
        expect([...entityTints(byEntity, resolved)]).toEqual([["a", [10, 20, 30]], ["c", [10, 20, 30]]]);
    });
});
