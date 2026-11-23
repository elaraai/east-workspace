/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Record's meters where they draw no share (east-workspace#1730), over a
 * floor deployed to e3 itself, each test a workspace of its own: a max that is
 * no finite number — NaN, an infinity — and a value that is none, each an
 * empty bar at 0%, never `NaN%`, its hover saying why; and a max that throws
 * over a row, that meter alone drawing no share and saying it could not be
 * read, the console saying why once however many rows it throws over — the
 * row's mark and its other meter read all the same. The percent Meter draws is
 * its fill's share, one number giving both (`display/meter`): `0%` is an
 * empty bar.
 */

import { describe, expect, test, vi } from "vitest";
import { DateTimeType, DictType, East, FloatType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Record } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { sheetHarness } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

/** A bay of the floor: its kind, this week's hours booked, the hours it can run, and the hours it ran. */
const Bay = StructType({ name: StringType, kind: StringType, booked: FloatType, capacity: FloatType, used: FloatType });
/** The floor: two bays with a share to draw, three whose figures make none, and two of a kind the limits don't hold. */
const bays = e3.record("meter_no_share_bays", DictType(StringType, Bay), {
    initial: new Map([
        ["B-1", { name: "Bay 1", kind: "small", booked: 30, capacity: 40, used: 20 }],
        // A capacity no reading gave a number: NaN.
        ["B-2", { name: "Bay 2", kind: "small", booked: 30, capacity: NaN, used: 20 }],
        // Hours booked no reading gave a number.
        ["B-3", { name: "Bay 3", kind: "small", booked: NaN, capacity: 40, used: 20 }],
        // A capacity without end.
        ["B-4", { name: "Bay 4", kind: "small", booked: 30, capacity: Infinity, used: 20 }],
        ["B-5", { name: "Bay 5", kind: "large", booked: 30, capacity: 40, used: 20 }],
        ["B-6", { name: "Bay 6", kind: "large", booked: 10, capacity: 40, used: 5 }],
    ]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const h = sheetHarness({ modules: { "record/meter-no-share": { bays } }, frame: 2000 });

/** Each kind's limit on the hours used: the large kind has none, and reading it throws. */
const LIMITS = new Map([["small", 40]]);

/** The floor's Record: booked against each bay's capacity, used against its kind's limit, and the large kind's bays marked. */
const floor = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(bays));
    return Record({
        record: rows,
        title: "Floor",
        edits: { insertRows: false },
        columns: {
            name: Record.column.title(Bay, { header: "Bay" }),
            kind: Record.column.text(Bay, {
                header: "Kind",
                mark: East.function([Bay, DateTimeType], OptionType(Record.Types.Mark), ($2, bay) => {
                    const unmarked = $2.const(none, OptionType(Record.Types.Mark));
                    return bay.kind.equal("large").ifElse(() => some(variant("note", "oversize")), () => unmarked);
                }),
            }),
            booked: Record.column.meter(Bay, { header: "Booked", max: (b) => b.capacity }),
            used: Record.column.meter(Bay, { header: "Used", max: (b) => East.value(LIMITS, DictType(StringType, FloatType)).get(b.kind) }),
        },
        name: "floor",
    });
})));

/** A bay's cell, by its key and the column's. */
const cell = (c: HTMLElement, id: string, key: string) =>
    c.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** A Meter's percent, as it draws it beside its bar — its one span. */
const percent = (el: HTMLElement) => el.querySelector('[data-slot="display"][data-kind="meter"]')?.querySelector("span")?.textContent;
/** A meter cell as it reads: its percent and its hover. */
const reads = (c: HTMLElement, id: string, key: string) => [percent(cell(c, id, key)), cell(c, id, key).title];

/** What the console says of a meter whose max or tone threw. */
const SAID = '[Sheet] the meter "used" could not read its max or tone:';

describe("a Record's meters where they draw no share (east-workspace#1730)", () => {
    test("a max or a value that is no finite number draws an empty bar at 0%, never NaN%, its hover saying why", async () => {
        const { container } = await h.mount({ fn: floor }, { storageKey: "meter-no-share-finite" });
        expect(["B-1", "B-2", "B-3", "B-4"].map((id) => reads(container, id, "booked"))).toEqual([
            ["75%", "30 of 40 · 75%"],
            ["0%", "30 · no share: its max is not a finite number"],
            ["0%", "NaN of 40 · no share: its value is not a finite number"],
            ["0%", "30 · no share: its max is not a finite number"],
        ]);
    });

    test("a max that throws over a row: that meter alone draws no share, saying it could not be read, the console why once — the row's mark and its other meter read all the same", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { container } = await h.mount({ fn: floor }, { storageKey: "meter-no-share-throws" });
            expect([reads(container, "B-5", "used"), reads(container, "B-6", "used")]).toEqual([
                ["0%", "20 · no share: its max or tone could not be read"],
                ["0%", "5 · no share: its max or tone could not be read"],
            ]);
            // The large kind's bays as any other: their booked meters drawn, their kind's mark read — a note, no lock.
            expect([reads(container, "B-5", "booked"), reads(container, "B-6", "booked")]).toEqual([["75%", "30 of 40 · 75%"], ["25%", "10 of 40 · 25%"]]);
            expect([cell(container, "B-5", "kind").textContent, cell(container, "B-5", "kind").hasAttribute("data-locked")]).toEqual(["largeoversize", false]);
            expect(reads(container, "B-1", "used")).toEqual(["50%", "20 of 40 · 50%"]);
            // Said once, for the first row it threw over; and nothing said of the marks, which read.
            expect(logged.mock.calls.filter((call) => call[0] === SAID)).toEqual([[SAID, 'Dict does not contain key "large"']]);
            expect(logged).not.toHaveBeenCalledWith("[Sheet] a column from data or a mark could not be read:", expect.anything());
        } finally {
            logged.mockRestore();
        }
    });
});
