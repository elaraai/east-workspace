/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Linking two visuals (`links.ts`, #1673): the fields a visual's clicks tell,
 * the placements a visual may follow, the match a link starts with — sure
 * where both read one source or share a field id, proposed by name and kind
 * otherwise — and what a link changes, a cycle refused.
 */

import { describe, expect, it } from "vitest";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import type { StudioCellType, StudioSourceType } from "@elaraai/e3-ui/internal";
import { clickFields, leaderChoices, link, proposeMatch, unlinked } from "./links.js";
import { LISTED_ORDERS } from "./visual.test-utils.js";

const v = Studio.visual;
type Cell = ValueTypeOf<typeof StudioCellType>;
type Source = ValueTypeOf<typeof StudioSourceType>;

const cell = (key: string, content: Cell["content"]): Cell => ({ key, row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content });
/** A placement's visual. */
function visualOf(of: Cell) {
    if (of.content.type !== "visual") throw new Error("not a visual");
    return of.content.value;
}
/** The fields a content's clicks tell. */
const fieldsOf = (content: ReturnType<typeof v.of>) => clickFields(visualOf(cell("c", content)).view);

const customers = cell("c-customers", v.of("orders", v.list({ item: v.group("customer"), values: [v.sum("revenue")] })));
const months = cell("c-months", v.of("orders", v.column({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] })));
const total = cell("c-total", v.of("orders", v.kpi({ value: v.count() })));
const note = cell("c-note", v.text("Notes"));

describe("the fields a visual's clicks tell", () => {
    it("is what each view's mark, row or cell stands for, each once; a KPI's tell none", () => {
        expect(fieldsOf(v.of("orders", v.list({ item: v.group("customer"), values: [v.count()] })))).toEqual(["customer"]);
        expect(fieldsOf(v.of("orders", v.records({ columns: ["region", "revenue"] })))).toEqual(["region"]);
        expect(fieldsOf(v.of("orders", v.summary({ rows: [v.group("region"), v.group("customer")], values: [v.count()] })))).toEqual(["region", "customer"]);
        expect(fieldsOf(v.of("orders", v.pivot({ rows: v.group("region"), columns: v.group("customer"), value: v.count() })))).toEqual(["region", "customer"]);
        expect(fieldsOf(v.of("orders", v.column({ x: v.group("ordered_at", { bucket: "month" }), values: [v.count()], split: "region" })))).toEqual(["ordered_at", "region"]);
        expect(fieldsOf(v.of("orders", v.bar({ x: v.group("region"), values: [v.count()], split: "region" })))).toEqual(["region"]);
        expect(fieldsOf(v.of("orders", v.combo({ x: v.group("region"), columns: [v.left(v.count())], lines: [] })))).toEqual(["region"]);
        expect(fieldsOf(v.of("orders", v.scatter({ point: "customer", x: v.sum("units"), y: v.sum("revenue") })))).toEqual(["customer"]);
        expect(fieldsOf(v.of("orders", v.pie({ slice: v.group("region"), value: v.count() })))).toEqual(["region"]);
        expect(fieldsOf(v.of("orders", v.kpi({ value: v.count() })))).toEqual([]);
    });
});

describe("the placements a visual may be linked to", () => {
    it("is every other visual whose clicks tell a field, in the page's order, each saying whether its click selects already", () => {
        const choices = leaderChoices([customers, months, total, note], "c-total");
        expect(choices.map((choice) => [choice.cell.key, choice.selects, choice.cycle])).toEqual([["c-customers", true, false], ["c-months", false, false]]);
        // A visual is no leader of itself.
        expect(leaderChoices([customers, months], "c-customers").map((choice) => choice.cell.key)).toEqual(["c-months"]);
    });

    it("marks one whose link would make a cycle", () => {
        const following = cell("c-months", v.of("orders", v.column({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] }), {
            follow: { leader: "c-customers", from: "customer", to: "customer", empty: variant("all", null) },
        }));
        expect(leaderChoices([customers, following], "c-customers").map((choice) => [choice.cell.key, choice.cycle])).toEqual([["c-months", true]]);
    });
});

describe("the match a link starts with (LNK-7)", () => {
    /** A source of other rows: its fields named as another system names them. */
    const source = (key: string, fields: [id: string, label: string, kind: "text" | "number" | "date"][]): Source => ({
        ...LISTED_ORDERS, key, name: key, fields: fields.map(([id, label, kind]) => ({ id, label, kind: variant(kind, null), format: none })),
    });
    const leader = visualOf(customers);

    it("fills itself when both read one source: the same field", () => {
        expect(proposeMatch(leader, LISTED_ORDERS, "orders", LISTED_ORDERS)).toEqual({ from: "customer", to: "customer", sure: true });
    });

    it("fills itself when the follower's source has a field of the same id", () => {
        const dispatch = source("dispatch", [["sent_at", "Sent", "date"], ["customer", "Account", "text"]]);
        expect(proposeMatch(leader, LISTED_ORDERS, "dispatch", dispatch)).toEqual({ from: "customer", to: "customer", sure: true });
    });

    it("proposes, by name and kind, where the sources name the field differently: the same name, then a name that holds it, then the first of its kind", () => {
        const byName = source("dispatch", [["weight", "Customer", "number"], ["account", "Account", "text"], ["customer_id", "Customer id", "text"]]);
        expect(proposeMatch(leader, LISTED_ORDERS, "dispatch", byName)).toEqual({ from: "customer", to: "customer_id", sure: false });
        const holding = source("dispatch", [["account", "Account", "text"], ["end_customer_ref", "End customer ref", "text"]]);
        expect(proposeMatch(leader, LISTED_ORDERS, "dispatch", holding)).toEqual({ from: "customer", to: "end_customer_ref", sure: false });
        const ofKind = source("dispatch", [["weight", "Weight", "number"], ["account", "Account", "text"]]);
        expect(proposeMatch(leader, LISTED_ORDERS, "dispatch", ofKind)).toEqual({ from: "customer", to: "account", sure: false });
    });

    it("proposes none where the follower's source lists no field of the kind, or the leader's clicks tell no field", () => {
        expect(proposeMatch(leader, LISTED_ORDERS, "dispatch", source("dispatch", [["weight", "Weight", "number"]]))).toBeUndefined();
        expect(proposeMatch(visualOf(total), LISTED_ORDERS, "orders", LISTED_ORDERS)).toBeUndefined();
    });
});

describe("what a link changes (LNK-3, LNK-6, LNK-7)", () => {
    it("is the follower, following — showing everything until something is selected — and nothing of a leader whose click selects already", () => {
        const linked = link([customers, months], "c-months", "c-customers", { from: "customer", to: "customer" });
        if ("refused" in linked) throw new Error("refused");
        expect(linked.follower.follow).toEqual(some({ leader: "c-customers", from: "customer", to: "customer", empty: variant("all", null) }));
        expect(linked.leader).toBeUndefined();
    });

    it("switches a leader's click to select when it was not, and keeps what a visual already following shows with nothing selected", () => {
        const prompting = cell("c-total", v.of("orders", v.kpi({ value: v.count() }), { follow: { leader: "c-customers", from: "customer", to: "customer", empty: variant("prompt", null) } }));
        const linked = link([customers, months, prompting], "c-total", "c-months", { from: "ordered_at", to: "ordered_at" });
        if ("refused" in linked) throw new Error("refused");
        expect(linked.leader?.click).toEqual(variant("select", null));
        expect(linked.follower.follow.type === "some" && [linked.follower.follow.value.leader, linked.follower.follow.value.empty]).toEqual(["c-months", variant("prompt", null)]);
    });

    it("refuses a link that would make a cycle, and one to a placement that is no visual on the page", () => {
        const following = cell("c-months", v.of("orders", v.column({ x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")] }), {
            follow: { leader: "c-customers", from: "customer", to: "customer", empty: variant("all", null) },
        }));
        expect(link([customers, following], "c-customers", "c-months", { from: "ordered_at", to: "ordered_at" })).toEqual({ refused: "cycle" });
        expect(link([customers, note], "c-customers", "c-note", { from: "x", to: "x" })).toEqual({ refused: "missing" });
        expect(link([customers], "c-customers", "c-gone", { from: "x", to: "x" })).toEqual({ refused: "missing" });
    });

    it("takes a link off", () => {
        const linked = link([customers, months], "c-months", "c-customers", { from: "customer", to: "customer" });
        if ("refused" in linked) throw new Error("refused");
        expect(unlinked(linked.follower).follow).toEqual(none);
    });
});
