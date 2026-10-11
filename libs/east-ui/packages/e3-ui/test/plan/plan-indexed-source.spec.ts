/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    decodeBeast2For, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { PinnedSourceType } from "@elaraai/east-ui/internal";
import { Plan } from "@elaraai/e3-ui/internal";

const Person = StructType({ name: StringType });
const Entries = ArrayType(StructType({ ik: VariantType({ by_name: StringType }), key: StringType,
    value: OptionType(NullType), row: OptionType(Person) }));
// Secondary index order deliberately differs from primary-key order.
const entries = [
    { ik: variant("by_name", "Ada"), key: "z", value: some(null), row: some({ name: "Ada" }) },
    { ik: variant("by_name", "Bea"), key: "a", value: some(null), row: some({ name: "Bea" }) },
    { ik: variant("by_name", "Cal"), key: "m", value: some(null), row: some({ name: "Cal" }) },
];
const source = East.value({
    id: "indexed-people",
    page: East.function([IntegerType, IntegerType], OptionType(Entries), ($, offset, limit) => {
        const all = $.const(entries, Entries);
        const start = offset.less(all.size()).ifElse(() => offset, () => all.size());
        const served = limit.less(2n).ifElse(() => limit, () => 2n);
        const end = start.add(served).less(all.size()).ifElse(() => start.add(served), () => all.size());
        return some(all.slice(start, end));
    }),
    total: East.function([], OptionType(IntegerType), () => some(3n)),
    seek: none,
    revision: East.function([], OptionType(StringType), () => some("r1")),
    refresh: East.function([OptionType(StringType)], NullType, () => null),
}, PinnedSourceType(Entries));
const program = East.function([], Plan.Types.Root, () => Plan.Root({
    data: source,
    series: [Plan.series.span(Person, { key: "people", title: "People", label: person => person.name, runs: () => [] })],
    axis: Plan.axis({ window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-11-01T00:00:00Z") }, resolution: "week" }),
    editing: {},
}));

test("indexed Plan keeps index order through short pages, decoding and draft derivation while row ids use primary keys", () => {
    const built = East.compile(program, [])();
    const plan = decodeBeast2For(Plan.Types.Root)(encodeBeast2For(Plan.Types.Root)(built));
    assert.equal(plan.rows.type, "pinned");
    if (plan.rows.type !== "pinned") return;
    const page = plan.rows.value.page(0n, 3n);
    assert.equal(page.type, "some");
    if (page.type !== "some") return;
    assert.deepEqual(page.value[0]!.rows.map(row => row.id.value.path[0]), ["z", "a", "m"]);
    assert.equal(plan.editing.type, "some");
    if (plan.editing.type !== "some") return;
    assert.deepEqual(plan.editing.value.entryIds(0n, 3n), some(["z", "a", "m"]));
    const drafted = plan.editing.value.derive(0n, 3n, new Map());
    assert.equal(drafted.type, "some");
    if (drafted.type !== "some") return;
    assert.deepEqual(drafted.value[0]!.rows.map(row => row.id.value.path[0]), ["z", "a", "m"]);
    const raw = plan.editing.value.readEntry("a", 1n);
    assert.ok(raw.type === "some" && decodeBeast2For(Person)(raw.value).name === "Bea");
});
