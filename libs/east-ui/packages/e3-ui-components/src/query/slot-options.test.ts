/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A slot's offers as the shared picker lists them (#1673): its sections in the
 * offers' groups' order, each option's words and marks, the keys a highlight
 * is held by, and the offer the list opens on.
 */

import { describe, expect, test } from "vitest";
import { variant } from "@elaraai/east";
import type { SlotItem } from "./model/slots.js";
import { slotOptions } from "./slot-options.js";

/** A field slot's offers once text is typed: the value typed first, then the fields. */
const OFFERS: readonly SlotItem[] = [
    { value: { kind: "value", value: variant("text", "re") }, label: "Use “re”", group: "Typed", typed: true },
    { value: { kind: "field", ref: "region" }, label: "Region", detail: "text", meta: "5 values", group: "Fields" },
    { value: { kind: "field", ref: "revenue" }, label: "Revenue", detail: "number", meta: "438.00 – 2,196.00", group: "Fields", mono: false },
    { value: { kind: "field", ref: "orders.region" }, label: "Region", detail: "text", note: "only while a row is an order", group: "Fields" },
];

describe("a slot's offers as the picker's options", () => {
    test("its sections are its offers' groups, in their order; each option's detail and note are its line, its meta its range", () => {
        const { sections } = slotOptions(OFFERS, 1);
        expect(sections.map((s) => [s.label, s.options.map((o) => o.label)])).toEqual([["Typed", ["Use “re”"]], ["Fields", ["Region", "Revenue", "Region"]]]);
        const [, fields] = sections;
        expect(fields!.options.map((o) => [o.line, o.range])).toEqual([
            ["text", "5 values"], ["number", "438.00 – 2,196.00"], ["text · only while a row is an order", undefined],
        ]);
    });

    test("an offer's key is its group and label — the value typed always the one key — and two alike are told apart; each key names its offer", () => {
        const { sections, offerOf } = slotOptions(OFFERS, 1);
        const keys = sections.flatMap((s) => s.options.map((o) => o.key));
        expect(keys[0]).toBe("typed");
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.map((key) => offerOf.get(key))).toEqual(OFFERS);
        // Typed again, the value typed keeps its key: the highlight held on it stays.
        const again = slotOptions([{ ...OFFERS[0]!, label: "Use “reg”", value: { kind: "value", value: variant("text", "reg") } }], 0);
        expect(again.sections[0]!.options[0]!.key).toBe("typed");
    });

    test("it opens on the offer the editor names; with none, on no key", () => {
        expect(slotOptions(OFFERS, 2).initialKey).toBe(slotOptions(OFFERS, 2).sections[1]!.options[1]!.key);
        expect(slotOptions(OFFERS, -1).initialKey).toBeUndefined();
    });

    test("an offer listed but not to be picked is refused, its reason on its line; a step's icon leads it; words are words and data is mono", () => {
        const steps: SlotItem[] = [
            { value: { kind: "step", step: "filter" }, label: "Keep rows", detail: "where a condition holds", icon: "filter", group: "Add a step" },
            { value: { kind: "step", step: "walk" }, label: "List every part", detail: "of a tree", icon: "sitemap", group: "Add a step", disabled: true, note: "Needs a tree" },
            { value: { kind: "value", value: variant("number", 2026) }, label: "2026", meta: "16 orders", group: "Years", mono: true },
        ];
        const options = slotOptions(steps, 0).sections.flatMap((s) => s.options);
        expect(options.map((o) => [o.state, o.line, o.icon, o.words])).toEqual([
            ["enabled", "where a condition holds", ["fas", "filter"], true],
            ["refused", "of a tree · Needs a tree", ["fas", "sitemap"], true],
            ["enabled", undefined, undefined, undefined],
        ]);
    });
});
