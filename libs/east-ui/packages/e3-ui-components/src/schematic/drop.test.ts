/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Schematic's modules load east-ui-components'
 * entry, which needs one as it loads.
 *
 * What a library card's drop does where it rests (#1390, `Schematic Builder
 * Spec.md` §7, §8, SC11–SC13), decided over real East values before anything
 * is drawn or written: where a drag rests — the point under the pointer, at
 * the screen's resolution, or the entity of the card's kind under it — what
 * each drop does, every refusal in its words, what ⏎ on a card does, the
 * edits a drop writes and the item it selects, the caption, the
 * announcement's name, the history's label, the marks, and the cards the
 * canvas takes from each tab. The DOM test (`schematic-drop.dom.test`)
 * carries them through the drag layer, on e3.
 */

import { describe, expect, test } from "vitest";
import { BlobType, FloatType, OptionType, StringType, defaultValue, encodeBeast2For, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { Schematic } from "@elaraai/e3-ui/internal";
import type { BacklogEntry } from "./backlog.js";
import { entityId, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicValue } from "./data.js";
import {
    NOWHERE, cardOf, dropCaption, dropEdits, dropHostOf, dropLabel, dropName, dropPoint, dropRefusal, droppedItem, markEqual, markOf, planDrop,
    planEnter, printDropAt, readDropAt, restsAt,
    type SchematicDropAt, type SchematicDropCard, type SchematicDropContext, type SchematicDropPlan, type SchematicDropPoint,
} from "./drop.js";
import type { SchematicEdit } from "./edits.js";
import { schematicMessages, type SchematicMessages, type SchematicWords } from "./messages.js";

const T = Schematic.Types;
const printRef = printFor(T.Ref);
const printAt = printFor(OptionType(T.Point));
const printFloat = printFor(FloatType);
const printValues = printFor(OptionType(BlobType));

/** The Schematic's words, in English. */
const words: SchematicWords = { ...formatters("en-US"), m: schematicMessages };

const ref = (kind: string, key: string): SchematicRef => ({ kind, key });
const A01 = ref("racks", "A01"), A02 = ref("racks", "A02"), A03 = ref("racks", "A03"), A06 = ref("racks", "A06");
const ODF = ref("network", "ODF-1");
const U1 = ref("fibre", "u1"), T1 = ref("trunks", "t1");
const CAGE = ref("areas", "cage-a");

// ── The cards ─────────────────────────────────────────────────────────────

/** A rack template's values, as a template's wire carries them: bytes the kind decodes. */
const R42_VALUES = new Uint8Array([4, 2]);
/** A fibre run template's values. */
const UPLINK_VALUES = new Uint8Array([1, 0, 0]);
/** An owner's card's field write: the rack's owner, as bytes at the field's type. */
const OWNER_WRITE = { path: ["owner"], value: encodeBeast2For(StringType)("Elmway College") };

const R42: SchematicDropCard = { does: "add", kind: "racks", label: "42U rack · 8 kW", values: R42_VALUES };
const PLACE_A06: SchematicDropCard = { does: "place", ref: A06, label: "A06" };
const UPLINK: SchematicDropCard = { does: "retype", kind: "fibre", label: "Uplink · 100G", values: UPLINK_VALUES };
const OWNER: SchematicDropCard = { does: "set", kind: "racks", label: "Elmway College", sets: [OWNER_WRITE] };
const FRAME_NOTE: SchematicDropCard = { does: "set", kind: "network", label: "Patched", sets: [OWNER_WRITE] };

// ── The Schematic as a drop reads it ──────────────────────────────────────

/** Each entity the drawing draws, by its id: its name. */
const NAMES = new Map([
    [entityId(A01), "A01"], [entityId(A02), "A02"], [entityId(A03), "A03"], [entityId(ODF), "ODF-1"],
    [entityId(U1), "A01 → ODF-1"], [entityId(T1), "Trunk 1"], [entityId(CAGE), "Cage A"],
]);

/** A data centre floor, 28 × 14 m: racks and areas written, frames read only, fibre runs and trunks written; Cage A over its top-left. */
const CTX: SchematicDropContext = {
    extent: { width: 28, height: 14 },
    kinds: new Map([
        ["racks", { name: "Rack", writes: true }],
        ["network", { name: "Network frame", writes: false }],
        ["areas", { name: "Area", writes: true }],
        ["fibre", { name: "Fibre run", writes: true }],
        ["trunks", { name: "Fibre trunk", writes: true }],
    ]),
    available: () => true,
    nameOf: (at) => NAMES.get(entityId(at)),
    zoneAt: (p) => (p.x >= 0.6 && p.x <= 20.2 && p.y >= 0.6 && p.y <= 5.2 ? "Cage A" : undefined),
};

/** A point at two digits, as a canvas at about 38 px a metre resolves one. */
const point = (x: number, y: number, digits = 2): SchematicDropAt => variant("point", { x, y, digits: BigInt(digits) });
const on = (at: SchematicRef): SchematicDropAt => variant("entity", at);
const atText = (at: SchematicDropAt): string => printDropAt(at);

/** An edit as East prints what it writes. */
function printed(edit: SchematicEdit): string {
    switch (edit.op) {
        case "item": return `item ${printRef(edit.ref)} ${printAt(edit.at)} ${printValues(edit.values)}`;
        case "place": return `place ${printRef(edit.ref)} ${printAt(edit.at)}`;
        case "retype": return `retype ${printRef(edit.ref)}`;
        case "set": return `set ${printRef(edit.ref)} ${edit.sets.map((write) => write.path.join(".")).join(",")}`;
        default: return `${edit.op} ${printRef(edit.ref)}`;
    }
}

/** Keys minted in order: each kind's `<slot>-new-1`, … */
function minter() {
    let n = 0;
    return (slot: string) => `${slot}-new-${++n}`;
}

// ============================================================================
// Where a drag rests
// ============================================================================

describe("where a drag rests", () => {
    test("a drop point is the pointer's, each coordinate to the fewest digits whose last is no wider than a pixel at the zoom", () => {
        const at = (p: SchematicDropPoint) => [printFloat(p.x), printFloat(p.y), p.digits];
        // About 38.6 px a metre, the data centre's fit: a pixel is 2.6 cm, so to the centimetre.
        expect(at(dropPoint({ x: 6.0384, y: 2.9089 }, 1080 / 28))).toEqual(["6.04", "2.91", 2n]);
        // 10 px a metre: to the decimetre; 400: to the millimetre; half a pixel a unit: to the unit.
        expect(at(dropPoint({ x: 6.0384, y: 2.9589 }, 10))).toEqual(["6.0", "3.0", 1n]);
        expect(at(dropPoint({ x: 6.03849, y: 2.9 }, 400))).toEqual(["6.038", "2.9", 3n]);
        expect(at(dropPoint({ x: 6.4, y: 2.6 }, 0.5))).toEqual(["6.0", "3.0", 0n]);
        // Never more than a millionth, never a negative zero, and a canvas with no size rounds to the unit.
        expect(at(dropPoint({ x: 1.23456789, y: 0 }, 1e9))[0]).toBe("1.234568");
        expect(at(dropPoint({ x: -0.001, y: -0.004 }, 38))).toEqual(["0.0", "0.0", 2n]);
        expect(at(dropPoint({ x: 2.4, y: 2.9 }, Number.NaN))).toEqual(["2.0", "3.0", 0n]);
    });

    test("a card that adds or places an item rests on the point; one that lands on an entity, on the entity of its kind under the pointer, or on nothing", () => {
        const here = dropPoint({ x: 6.04, y: 2.91 }, 38);
        const entityOf = (kind: string) => (kind === "fibre" ? U1 : undefined);
        expect(atText(restsAt(R42, here, entityOf))).toBe(atText(variant("point", here)));
        expect(atText(restsAt(PLACE_A06, here, entityOf))).toBe(atText(variant("point", here)));
        expect(atText(restsAt(UPLINK, here, entityOf))).toBe(atText(on(U1)));
        expect(atText(restsAt(OWNER, here, entityOf))).toBe(atText(NOWHERE));
    });

    test("where a drag rests rides a drop's CellRef printed, and reads back; another surface's text names nowhere", () => {
        for (const where of [point(6.04, 2.91), on(U1), NOWHERE]) expect(atText(readDropAt(printDropAt(where))!)).toBe(atText(where));
        expect(readDropAt("row 3")).toBeUndefined();
    });
});

// ============================================================================
// What a drop does
// ============================================================================

describe("a template's item, or a backlog row, lands at the point (SC12, SC4)", () => {
    test("an item template adds an item of its kind there, its values the template's, the zone holding the point named; a backlog row is placed there", () => {
        const add = planDrop(R42, point(6.04, 2.91), CTX);
        expect(add).toEqual({ kind: "add", slot: "racks", at: { x: 6.04, y: 2.91, digits: 2n }, zone: "Cage A", values: R42_VALUES });
        expect(dropEdits(add, minter()).map(printed)).toEqual([`item ${printRef(ref("racks", "racks-new-1"))} ${printAt(some({ x: 6.04, y: 2.91 }))} ${printValues(some(R42_VALUES))}`]);
        const place = planDrop(PLACE_A06, point(6.0, 6.6), CTX);
        expect(place).toEqual({ kind: "place", ref: A06, at: { x: 6.0, y: 6.6, digits: 2n }, zone: undefined });
        expect(dropEdits(place, minter()).map(printed)).toEqual([`place ${printRef(A06)} ${printAt(some({ x: 6.0, y: 6.6 }))}`]);
    });

    test("the item it brings onto the canvas is the one it minted, or the row it placed — the one it selects; none for a drop on an entity", () => {
        const add = planDrop(R42, point(6.04, 2.91), CTX);
        const edits = dropEdits(add, minter());
        expect(printRef(droppedItem(add, edits)!)).toBe(printRef(ref("racks", "racks-new-1")));
        const place = planDrop(PLACE_A06, point(6.0, 6.6), CTX);
        expect(printRef(droppedItem(place, dropEdits(place, minter()))!)).toBe(printRef(A06));
        const retype = planDrop(UPLINK, on(U1), CTX);
        expect(droppedItem(retype, dropEdits(retype, minter()))).toBeUndefined();
    });

    test("outside the drawing it is refused — the drawing's edges are in it — and so is a drag resting on no point", () => {
        for (const where of [point(28.01, 3), point(-0.01, 3), point(6, 14.5), point(6, -1), NOWHERE, on(A01)]) {
            const plan = planDrop(R42, where, CTX);
            expect([plan.kind, dropCaption(plan, words, "m")], atText(where)).toEqual(["refused", "Outside the drawing"]);
        }
        for (const where of [point(0, 0), point(28, 14)]) expect(planDrop(PLACE_A06, where, CTX).kind, atText(where)).toBe("place");
    });
});

describe("a template's values, or an author's card's fields, land on an entity of its kind (SC11)", () => {
    test("a link template writes its values over the link it lands on — its ends and its key as they are; an author's card sets its fields on the rack", () => {
        const retype = planDrop(UPLINK, on(U1), CTX);
        expect(retype).toEqual({ kind: "retype", ref: U1, name: "A01 → ODF-1", values: UPLINK_VALUES });
        expect(dropEdits(retype, minter()).map(printed)).toEqual([`retype ${printRef(U1)}`]);
        const set = planDrop(OWNER, on(A03), CTX);
        expect(set).toEqual({ kind: "set", refs: [A03], name: "A03", kindName: "Rack", sets: [OWNER_WRITE] });
        expect(dropEdits(set, minter()).map(printed)).toEqual([`set ${printRef(A03)} owner`]);
    });

    test("anywhere but on an entity of its kind it is refused, naming the kind it lands on", () => {
        const cases: [SchematicDropCard, SchematicDropAt, string][] = [
            [UPLINK, NOWHERE, "Drop onto a fibre run"],
            [UPLINK, on(T1), "Drop onto a fibre run"],
            [UPLINK, point(6, 3), "Drop onto a fibre run"],
            [OWNER, on(ODF), "Drop onto a rack"],
            [{ does: "set", kind: "areas", label: "Hall", sets: [] }, on(A01), "Drop onto an area"],
        ];
        for (const [card, where, said] of cases) {
            const plan = planDrop(card, where, CTX);
            expect([plan.kind, dropCaption(plan, words, "m"), dropRefusal(plan, words)], `${card.label} on ${atText(where)}`).toEqual(["refused", said, said]);
        }
    });

    test("an entity the drawing no longer draws — a stale coordinate — refuses it in no words", () => {
        const plan = planDrop(OWNER, on(ref("racks", "GONE")), CTX);
        expect(plan).toEqual({ kind: "refused", why: { why: "gone" } });
        expect([dropCaption(plan, words, "m"), dropRefusal(plan, words), dropName(plan, words, "m")]).toEqual([undefined, undefined, "the canvas"]);
    });
});

describe("a kind read only, or whose session takes no edit now, refuses every drop of its cards, wherever it rests (SC14)", () => {
    test("read only, its kind says so; busy, it takes no edit now — before where the drag rests is asked", () => {
        for (const where of [on(ODF), NOWHERE, point(6, 3)]) {
            expect(dropCaption(planDrop(FRAME_NOTE, where, CTX), words, "m")).toBe("Network frames are read only");
        }
        const busy: SchematicDropContext = { ...CTX, available: (slot) => slot !== "racks" };
        for (const card of [R42, PLACE_A06, OWNER]) expect(dropCaption(planDrop(card, point(6, 3), busy), words, "m")).toBe("Racks take no edit now");
        expect(planDrop(UPLINK, on(U1), busy).kind).toBe("retype");
        // A Schematic read only writes no kind.
        const readOnly: SchematicDropContext = { ...CTX, kinds: new Map([...CTX.kinds].map(([slot, kind]) => [slot, { ...kind, writes: false }])) };
        expect(dropCaption(planDrop(R42, point(6, 3), readOnly), words, "m")).toBe("Racks are read only");
        // A kind the Schematic no longer has: a stale card, refused in no words.
        expect(planDrop({ ...R42, kind: "gone" }, point(6, 3), CTX)).toEqual({ kind: "refused", why: { why: "gone" } });
    });
});

// ============================================================================
// ⏎ on a card (SC13)
// ============================================================================

describe("⏎ on a card drops it on the selection, or at the view's centre (SC13)", () => {
    const centre: SchematicDropPoint = { x: 14, y: 7, digits: 2n };

    test("a card that adds or places an item lands at the view's centre; a canvas with no size yet has none, and refuses it", () => {
        expect(planEnter(R42, [A01], centre, CTX)).toMatchObject({ kind: "add", at: centre, zone: undefined });
        expect(planEnter(PLACE_A06, [], centre, CTX)).toMatchObject({ kind: "place", ref: A06, at: centre });
        expect(dropRefusal(planEnter(R42, [], undefined, CTX), words)).toBe("Outside the drawing");
        expect(dropRefusal(planEnter(R42, [], { x: 40, y: 7, digits: 0n }, CTX), words)).toBe("Outside the drawing");
    });

    test("a template on the selected link of its kind; an author's card on the selected rack — or on every selected rack, as one step", () => {
        expect(planEnter(UPLINK, [A01, U1], centre, CTX)).toMatchObject({ kind: "retype", ref: U1 });
        expect(planEnter(OWNER, [A02, ODF], centre, CTX)).toMatchObject({ kind: "set", refs: [A02], name: "A02" });
        const several = planEnter(OWNER, [A01, ODF, A02, A03], centre, CTX);
        expect(several).toEqual({ kind: "set", refs: [A01, A02, A03], name: undefined, kindName: "Rack", sets: [OWNER_WRITE] });
        expect(dropEdits(several, minter()).map(printed)).toEqual([A01, A02, A03].map((at) => `set ${printRef(at)} owner`));
        // One of them no longer drawn: the rest.
        expect(planEnter(OWNER, [A01, ref("racks", "GONE")], centre, CTX)).toMatchObject({ kind: "set", refs: [A01], name: "A01" });
    });

    test("a selection holding nothing of its kind refuses it, naming the kind, as a drag over nothing of its kind is; its kind read only says so first", () => {
        expect(dropRefusal(planEnter(UPLINK, [A01], centre, CTX), words)).toBe("Drop onto a fibre run");
        expect(dropRefusal(planEnter(OWNER, [], centre, CTX), words)).toBe("Drop onto a rack");
        expect(dropRefusal(planEnter(FRAME_NOTE, [ODF, ref("network", "MMR-1")], centre, CTX), words)).toBe("Network frames are read only");
    });
});

// ============================================================================
// Its words and its marks
// ============================================================================

describe("its words and its marks", () => {
    test("the ghost says where a card lands — the zone holding the point, and the point in the drawing's unit — or what it lands on; the drag layer names it; the history labels the drop", () => {
        const add = planDrop(R42, point(6.04, 2.9), CTX);
        expect([dropCaption(add, words, "m"), dropName(add, words, "m"), dropLabel(add, R42, words, "m")])
            .toEqual(["Cage A · 6.04, 2.90 m", "Cage A · 6.04, 2.90 m", "Drop 42U rack · 8 kW at Cage A · 6.04, 2.90 m"]);
        // No zone holds it, and a drawing with no unit: the point alone.
        expect(dropCaption(planDrop(PLACE_A06, point(6, 6.6, 1), CTX), words, undefined)).toBe("6.0, 6.6");
        const retype = planDrop(UPLINK, on(U1), CTX);
        expect([dropCaption(retype, words, "m"), dropName(retype, words, "m"), dropLabel(retype, UPLINK, words, "m")])
            .toEqual(["onto A01 → ODF-1", "A01 → ODF-1", "Drop Uplink · 100G on A01 → ODF-1"]);
        const several = planEnter(OWNER, [A01, A02, A03], undefined, CTX);
        expect([dropName(several, words, "m"), dropLabel(several, OWNER, words, "m")]).toEqual(["3 racks", "Drop Elmway College on 3 racks"]);
        expect(dropRefusal(add, words)).toBeUndefined();
    });

    test("a host's message table words the refusals, and is asked only where one is refused in words", () => {
        const host: SchematicWords = { ...words, m: { ...schematicMessages, dropRefused: () => "Not here" } satisfies SchematicMessages };
        expect(dropCaption(planDrop(UPLINK, NOWHERE, CTX), host, "m")).toBe("Not here");
        const gone = planDrop(OWNER, on(ref("racks", "GONE")), CTX);
        expect([dropCaption(gone, host, "m"), dropRefusal(gone, host)]).toEqual([undefined, undefined]);
    });

    test("the canvas marks the point a card lands at, or the entity it lands on — nothing where a drop is refused, nor for several", () => {
        expect(markOf(planDrop(R42, point(6.04, 2.91), CTX))).toEqual({ kind: "point", x: 6.04, y: 2.91 });
        expect(markOf(planDrop(UPLINK, on(U1), CTX))).toEqual({ kind: "entity", id: entityId(U1) });
        expect(markOf(planDrop(OWNER, on(A01), CTX))).toEqual({ kind: "entity", id: entityId(A01) });
        expect(markOf(planDrop(UPLINK, NOWHERE, CTX))).toBeUndefined();
        expect(markOf(planEnter(OWNER, [A01, A02], undefined, CTX))).toBeUndefined();
        expect(markEqual({ kind: "point", x: 1, y: 2 }, { kind: "point", x: 1, y: 2 })).toBe(true);
        expect(markEqual({ kind: "point", x: 1, y: 2 }, { kind: "point", x: 1, y: 2.01 })).toBe(false);
        expect(markEqual({ kind: "entity", id: entityId(A01) }, { kind: "entity", id: entityId(A01) })).toBe(true);
        expect(markEqual({ kind: "entity", id: entityId(A01) }, { kind: "point", x: 1, y: 2 })).toBe(false);
        expect(markEqual(undefined, undefined)).toBe(true);
        expect(markEqual(undefined, { kind: "entity", id: entityId(A01) })).toBe(false);
    });
});

// ============================================================================
// What the canvas takes
// ============================================================================

describe("what the canvas takes dropped", () => {
    test("each tab whose cards drop, under the library its cards drag from: the templates — an item kind's adding, a link or a net kind's retyping — the backlog's rows, and an author's tab whose patch names a kind; never the Index, the Layers, nor an author's tab without a drop", () => {
        type Template = ValueTypeOf<typeof T.Template>;
        const template = (key: string, name: string, values: Uint8Array): Template => ({ key, name, group: none, icon: none, values });
        const tabs: SchematicValue["library"] = [
            variant("templates", null), variant("backlog", null), variant("index", null), variant("layers", null),
            variant("tab", { name: "Owners", icon: none, drop: some("racks"), cards: [{ key: "elmway", label: "Elmway College", meta: none, group: none, sets: [OWNER_WRITE] }], source: none }),
            variant("tab", { name: "Notes", icon: none, drop: none, cards: [{ key: "n", label: "Checked", meta: none, group: none, sets: [] }], source: none }),
        ];
        const backlog: BacklogEntry[] = [{ ref: A06, id: entityId(A06), roles: { ...defaultValue<typeof T.Item>(T.Item), label: "A06" } }];
        const host = dropHostOf("schematic.surface", (tabKey) => `lib:${tabKey}`, tabs, {
            items: [{ key: "racks", templates: [template("r42", "42U rack · 8 kW", R42_VALUES)] }],
            links: [{ key: "fibre", templates: [template("uplink", "Uplink · 100G", UPLINK_VALUES)] }],
            nets: [{ key: "trunks", templates: [] }],
        }, backlog);
        expect(host.surface).toBe("schematic.surface");
        expect([...host.libraries.keys()]).toEqual(["lib:templates", "lib:backlog", "lib:tab:Owners"]);
        expect(cardOf(host, "lib:templates", entityId(ref("racks", "r42")))).toEqual(R42);
        expect(cardOf(host, "lib:templates", entityId(ref("fibre", "uplink")))).toEqual(UPLINK);
        expect(cardOf(host, "lib:backlog", entityId(A06))).toEqual(PLACE_A06);
        expect(cardOf(host, "lib:tab:Owners", "elmway")).toEqual(OWNER);
        expect([cardOf(host, "lib:templates", "r42"), cardOf(host, "lib:tab:Notes", "n"), cardOf(host, "lib:index", "x")]).toEqual([undefined, undefined, undefined]);
    });
});

// ============================================================================
// A whole drop, as the plan types say it
// ============================================================================

describe("a plan is what the frame records", () => {
    test("a refusal writes nothing", () => {
        const refused: SchematicDropPlan = planDrop(UPLINK, NOWHERE, CTX);
        expect(dropEdits(refused, minter())).toEqual([]);
    });
});
