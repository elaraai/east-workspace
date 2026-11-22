/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A new event's key under each of the three options a kind takes
 * (east-workspace#1709), in the Calendar itself, over bookings on e3: a
 * booking duplicated — the copy an hour on from the one it copies — is keyed by
 * the app's own rule (`newKey`), by the key its row builds (`key`), or holds
 * the key its session makes in its own field (`keyField`); and Save writes it
 * so. Where the app's rule gives a key a booking holds, the copy is refused,
 * and its Details say which key; over a record read a window at a time, the
 * rule is told the key of every booking the day shows. Over bookings keyed by
 * number, Search Records reads a key typed as a number. A booking keyed by its
 * reference, the reference typed in its Details, moves under the key it then
 * builds, the booking it was, edited — and read through a rail's source, it
 * stays on the board under that key until Save. Read through a rail's source, bookings
 * keyed by a struct, and by a variant — a composite's key — draw, are
 * selected, move from their Details and save under their own keys
 * (east-workspace#1696).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    DateTimeType, DictType, East, IntegerType, SetType, SortedMap, StringType, StructType, VariantType, compareFor, equalFor, printFor, variant,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { editingMessages } from "@elaraai/east-ui-components";
import { Calendar, Data, Record } from "@elaraai/e3-ui";
import { Slice } from "@elaraai/east-ui";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { act, event, settle, slot } from "./harness.test-utils.js";

/** A booking: its reference, what it is, and when it runs. */
const Booking = StructType({ ref: StringType, title: StringType, start: DateTimeType, end: DateTimeType });
const NINE = new Date("2026-10-01T09:00:00Z"), TEN = new Date("2026-10-01T10:00:00Z"), ELEVEN = new Date("2026-10-01T11:00:00Z");
/** The bookings: one, which a new one is copied from. */
const bookings = e3.record("calendar_keyed_bookings", DictType(StringType, Booking), {
    initial: new Map([["B-1", { ref: "B-1", title: "Safety check", start: NINE, end: TEN }]]),
    indexes: (index) => ({
        // What a rail narrows the bookings through: each read over the window in view.
        calendar_keyed_bookings_by_time: index.interval({ from: "start", to: "end" }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const NOON = new Date("2026-10-01T12:00:00Z"), ONE = new Date("2026-10-01T13:00:00Z"), TWO = new Date("2026-10-01T14:00:00Z");
/** The desk's bookings B-1, B-3 and B-7 on the one day, in its own scheme: those numbered between were let go. */
const numbered = e3.record("calendar_numbered_bookings", DictType(StringType, Booking), {
    initial: new Map([
        ["B-1", { ref: "B-1", title: "Safety check", start: NINE, end: TEN }],
        ["B-3", { ref: "B-3", title: "Calibration", start: ELEVEN, end: NOON }],
        ["B-7", { ref: "B-7", title: "Handover", start: ONE, end: TWO }],
    ]),
    indexes: (index) => ({
        calendar_numbered_bookings_by_time: index.interval({ from: "start", to: "end" }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The desk's bookings keyed by number — 2, 12 and 120 — on the one day: what a key typed as a number is sought among. */
const counted = e3.record("calendar_counted_bookings", DictType(IntegerType, Booking), {
    initial: new Map([
        [2n, { ref: "2", title: "Safety check", start: NINE, end: TEN }],
        [12n, { ref: "12", title: "Calibration", start: ELEVEN, end: NOON }],
        [120n, { ref: "120", title: "Handover", start: ONE, end: TWO }],
    ]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** A booking's key as a desk keys its queue: the desk, and the booking's place in it — a struct, no String. */
const Placed = StructType({ desk: StringType, seq: IntegerType });
const A1 = { desk: "A", seq: 1n };
/** The desk's one booking, keyed by its place in desk A's queue. */
const placed = e3.record("calendar_placed_bookings", DictType(Placed, Booking), {
    initial: new SortedMap([[A1, { ref: "A-1", title: "Safety check", start: NINE, end: TEN }]], compareFor(Placed)),
    indexes: (index) => ({
        calendar_placed_bookings_by_time: index.interval({ from: "start", to: "end" }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** A booking's key as a composite record keys its rows: a variant of the source each came from. */
const Sourced = VariantType({ erp: StringType, own: StringType });
const PO7 = variant("erp", "PO-7");
/** The desk's one booking, keyed by the source it came from. */
const sourced = e3.record("calendar_sourced_bookings", DictType(Sourced, Booking), {
    initial: new SortedMap([[PO7, { ref: "PO-7", title: "Safety check", start: NINE, end: TEN }]], compareFor(Sourced)),
    indexes: (index) => ({
        calendar_sourced_bookings_by_time: index.interval({ from: "start", to: "end" }),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const h = e3Harness({ "calendar/row-keys": { bookings, numbered, counted, placed, sourced } }, { main: "data-calendar-main" });
const sameBooking = equalFor(Booking);

/** The bookings' day, under the app's own rule for a new booking's key: B-1, B-2, … */
const ruled = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(bookings, ["patch"]));
    const next = $.const(East.function([SetType(StringType)], StringType, (_$2, taken) => East.str`B-${taken.size().add(1n)}`));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", newKey: next }) } });
}))) };

/** The bookings' day, each keyed as its row builds: its title and the hour it starts. */
const built = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(bookings, ["patch"]));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") },
        events: { booking: Calendar.events(rows, {
            name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", key: (booking) => East.str`${booking.title}@${booking.start.getHour()}`,
        }) } });
}))) };

/** The bookings' day, each booking holding its key in its reference. */
const fielded = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(bookings, ["patch"]));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", keyField: "ref" }) } });
}))) };

/** The bookings' day, under a rule that gives every new booking the key the one booking holds: B-1. */
const clashing = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(bookings, ["patch"]));
    const held = $.const(East.function([SetType(StringType)], StringType, (_$2, _taken) => "B-1"));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", newKey: held }) } });
}))) };

/**
 * The bookings' day under the app's own rule, their record read a window at a time — through a rail's source over its
 * interval index, each booking by its key (`entries`): its session holds none of the record's keys but those it has
 * met, so the rule is told none of the bookings the day shows.
 */
const byKey = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(bookings, ["patch"]));
    const entries = $.let(Data.bindPaged(bookings));
    const indexed = $.let(Data.bindPaged(bookings, { indexes: ["calendar_keyed_bookings_by_time"] }));
    const slice = $.let(Slice.bindRecords("test.calendar.rowKeys", { booking: { source: indexed, fields: { start: { label: "Dates" } }, range: "start" } }));
    const next = $.const(East.function([SetType(StringType)], StringType, (_$2, taken) => East.str`B-${taken.size().add(1n)}`));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") }, slice: { slice },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", entries, newKey: next }) } });
}))) };

/**
 * The numbered bookings' day, their record read a window at a time as `byKey`'s are, under the app's own rule: one past
 * the largest number of the keys taken.
 */
const numberedByKey = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(numbered, ["patch"]));
    const entries = $.let(Data.bindPaged(numbered));
    const indexed = $.let(Data.bindPaged(numbered, { indexes: ["calendar_numbered_bookings_by_time"] }));
    const slice = $.let(Slice.bindRecords("test.calendar.numberedKeys", { booking: { source: indexed, fields: { start: { label: "Dates" } }, range: "start" } }));
    const past = $.const(East.function([SetType(StringType)], StringType, ($2, taken) => {
        const most = $2.let(0n);
        $2.for(taken, ($3, key) => {
            $3.assign(most, East.max(most, key.substring(2n, key.length()).parse(IntegerType)));
        });
        return East.str`B-${most.add(1n)}`;
    }));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") }, slice: { slice },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", entries, newKey: past }) } });
}))) };

/** The bookings' day, each keyed by its reference: a field of its row its Details' form edits. */
const byRef = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(bookings, ["patch"]));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", key: (booking) => booking.ref }) } });
}))) };

/** `byRef`'s day read a window at a time, through a rail's source over the bookings' interval index, each booking by its key. */
const byRefRailed = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(bookings, ["patch"]));
    const entries = $.let(Data.bindPaged(bookings));
    const indexed = $.let(Data.bindPaged(bookings, { indexes: ["calendar_keyed_bookings_by_time"] }));
    const slice = $.let(Slice.bindRecords("test.calendar.refKeys", { booking: { source: indexed, fields: { start: { label: "Dates" } }, range: "start" } }));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") }, slice: { slice },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", entries, key: (booking) => booking.ref }) } });
}))) };

/** The day of the bookings keyed by number, their record read whole. */
const countedDay = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(counted, ["patch"]));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end" }) } });
}))) };

/** The placed bookings' day, read a window at a time through the rail's `booking` source, each booking by its key. */
const placedDay = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(placed, ["patch"]));
    const entries = $.let(Data.bindPaged(placed));
    const indexed = $.let(Data.bindPaged(placed, { indexes: ["calendar_placed_bookings_by_time"] }));
    const slice = $.let(Slice.bindRecords("test.calendar.placedKeys", { booking: { source: indexed, fields: { start: { label: "Dates" } }, range: "start" } }));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") }, slice: { slice },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", entries }) } });
}))) };

/** The sourced bookings' day, read as the placed bookings' are. */
const sourcedDay = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const rows = $.let(Record.bind(sourced, ["patch"]));
    const entries = $.let(Data.bindPaged(sourced));
    const indexed = $.let(Data.bindPaged(sourced, { indexes: ["calendar_sourced_bookings_by_time"] }));
    const slice = $.let(Slice.bindRecords("test.calendar.sourcedKeys", { booking: { source: indexed, fields: { start: { label: "Dates" } }, range: "start" } }));
    return Calendar({ inspector: true, view: { period: "day", date: new Date("2026-10-01T00:00:00Z") }, slice: { slice },
        events: { booking: Calendar.events(rows, { name: "Booking", icon: "calendar", title: "title", start: "start", end: "end", entries }) } });
}))) };

/** The keys of the bookings the day draws. */
const drawn = (c: HTMLElement): string[] => [...c.querySelectorAll<HTMLElement>("[data-calendar-event]")].map((el) => el.getAttribute("data-calendar-event")!);

/**
 * Moves a booking an hour later from its Details, as a planner does: selected, its start's hour one up, taken as the
 * focus leaves the field; then presses Save.
 */
async function laterAnHourAndSaved(c: HTMLElement, key: string): Promise<void> {
    await waitFor(() => expect(event(c, "booking", key)).not.toBeNull(), { timeout: 8_000 });
    await act(async () => { fireEvent.click(event(c, "booking", key)); });
    await settle();
    const start = slot(c, "end").querySelector<HTMLElement>('[data-field="start"]')!;
    const user = userEvent.setup();
    await user.click(start.querySelector<HTMLElement>('[role="spinbutton"][aria-label^="hour"]')!);
    await user.keyboard("{ArrowUp}");
    while (start.contains(document.activeElement)) await user.tab();
    await settle();
    expect(event(c, "booking", key).hasAttribute("data-drafted")).toBe(true);
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("button", { name: editingMessages.apply() })); });
    await settle();
}

/** Duplicates the booking B-1 from its Details. */
async function duplicate(c: HTMLElement): Promise<void> {
    await waitFor(() => expect(event(c, "booking", "B-1")).not.toBeNull());
    await act(async () => { fireEvent.click(event(c, "booking", "B-1")); });
    await settle();
    await act(async () => { fireEvent.click(slot(c, "end").querySelector("[data-calendar-action='duplicate']")!); });
    await settle();
}

/** Presses Save, and gives the bookings as e3 then holds them. */
async function saved(c: HTMLElement) {
    await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("button", { name: editingMessages.apply() })); });
    await waitFor(async () => expect((await h.read(bookings)).size).toBe(2), { timeout: 8_000 });
    await settle();
    return h.read(bookings);
}

describe("a Calendar's new event under each of the three key options (east-workspace#1709)", () => {
    test("ruling 1 — told the app's rule (`newKey`), a booking duplicated is keyed by it — B-2, never a key made up from the one it copies — and Save writes it there", async () => {
        const { container: c } = await h.mount(ruled);
        await duplicate(c);
        expect(event(c, "booking", "B-2")).not.toBeNull();
        const rows = await saved(c);
        expect([[...rows.keys()], sameBooking(rows.get("B-2")!, { ref: "B-1", title: "Safety check", start: TEN, end: ELEVEN })]).toEqual([["B-1", "B-2"], true]);
    });

    test("ruling 1 — keyed as its row builds (`key`), a booking duplicated stands under the key its own row builds — its title and the hour the copy starts — and Save writes it there", async () => {
        const { container: c } = await h.mount(built);
        await duplicate(c);
        expect(event(c, "booking", "Safety check@10")).not.toBeNull();
        expect(drawn(c)).toHaveLength(2);
        const rows = await saved(c);
        expect([[...rows.keys()], sameBooking(rows.get("Safety check@10")!, { ref: "B-1", title: "Safety check", start: TEN, end: ELEVEN })])
            .toEqual([["B-1", "Safety check@10"], true]);
    });

    test("ruling 1 — holding its key in a field (`keyField`), a booking duplicated holds its own key there from the first, never the key of the booking it copies, and Save writes it so", async () => {
        const { container: c } = await h.mount(fielded);
        await duplicate(c);
        const rows = await saved(c);
        const [made] = [...rows.keys()].filter((key) => !sameKey(key, "B-1"));
        expect(made).toBeDefined();
        expect(sameBooking(rows.get(made!)!, { ref: made!, title: "Safety check", start: TEN, end: ELEVEN })).toBe(true);
        expect(rows.get("B-1")!.ref).toBe("B-1");
    });

    test("ruling 1 — where the app's rule gives a key a booking holds, Duplicate adds no booking and says which key, in the words every refused key is said in — never that the copy must wait", async () => {
        const { container: c } = await h.mount(clashing);
        await duplicate(c);
        expect(within(slot(c, "end")).getByRole("alert").textContent).toBe('Another booking is keyed "B-1" already');
        expect(drawn(c)).toHaveLength(1);
    });

    test("ruling 1 — over a record read a window at a time, the rule is told of a booking the day shows where the key it gives is that booking's, and asked again: the copy takes the next key, B-2, never refused for a key the rule could not know taken", async () => {
        const { container: c } = await h.mount(byKey);
        await duplicate(c);
        expect(within(slot(c, "end")).queryByRole("alert")).toBeNull();
        expect(event(c, "booking", "B-2")).not.toBeNull();
        const rows = await saved(c);
        expect([[...rows.keys()], sameBooking(rows.get("B-2")!, { ref: "B-1", title: "Safety check", start: TEN, end: ELEVEN })]).toEqual([["B-1", "B-2"], true]);
    });

    test("ruling 9 — over a record read a window at a time, the app's rule is told the key of every booking the day shows: a copy one past the largest is B-8 — never B-2, past only the booking it first runs into — and Save writes it there", async () => {
        const { container: c } = await h.mount(numberedByKey);
        await waitFor(() => expect(drawn(c)).toHaveLength(3));
        await duplicate(c);
        expect(within(slot(c, "end")).queryByRole("alert")).toBeNull();
        expect(event(c, "booking", "B-8")).not.toBeNull();
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("button", { name: editingMessages.apply() })); });
        await waitFor(async () => expect((await h.read(numbered)).size).toBe(4), { timeout: 8_000 });
        const rows = await h.read(numbered);
        expect([[...rows.keys()], sameBooking(rows.get("B-8")!, { ref: "B-1", title: "Safety check", start: TEN, end: ELEVEN })])
            .toEqual([["B-1", "B-3", "B-7", "B-8"], true]);
    });
});

describe("a Calendar whose events' keys their rows build (east-workspace#1709)", () => {
    test("ruling 1 — a booking whose reference is typed moves under the key it then builds, the booking it was, edited: its Details pending, never new; and Save writes it there", async () => {
        const { container: c } = await h.mount(byRef);
        await waitFor(() => expect(event(c, "booking", "B-1")).not.toBeNull());
        await act(async () => { fireEvent.click(event(c, "booking", "B-1")); });
        await settle();
        const box = within(slot(c, "end").querySelector<HTMLElement>('[data-field="ref"]')!).getByRole("textbox");
        await act(async () => { fireEvent.change(box, { target: { value: "B-9" } }); fireEvent.blur(box); });
        await settle();
        expect([event(c, "booking", "B-1"), event(c, "booking", "B-9") !== null, slot(c, "end").querySelector("[data-state]")?.getAttribute("data-state")])
            .toEqual([null, true, "pending"]);
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("button", { name: editingMessages.apply() })); });
        await waitFor(async () => expect((await h.read(bookings)).has("B-9")).toBe(true), { timeout: 8_000 });
        const rows = await h.read(bookings);
        expect([[...rows.keys()], sameBooking(rows.get("B-9")!, { ref: "B-9", title: "Safety check", start: NINE, end: TEN })]).toEqual([["B-9"], true]);
    });

    test("ruling 1 — read through a rail's source, a booking whose reference is typed stays on the board under the key it then builds — one booking drawn, never none until Save — its Details pending; and Save writes it there", async () => {
        const { container: c } = await h.mount(byRefRailed);
        await waitFor(() => expect(event(c, "booking", "B-1")).not.toBeNull(), { timeout: 8_000 });
        await act(async () => { fireEvent.click(event(c, "booking", "B-1")); });
        await settle();
        const box = within(slot(c, "end").querySelector<HTMLElement>('[data-field="ref"]')!).getByRole("textbox");
        await act(async () => { fireEvent.change(box, { target: { value: "B-9" } }); fireEvent.blur(box); });
        await settle();
        // Its window holds no row under B-9, and the record holds it under B-1: it is the booking it was, drawn where it stands.
        expect([drawn(c).length, event(c, "booking", "B-1"), event(c, "booking", "B-9") !== null, slot(c, "end").querySelector("[data-state]")?.getAttribute("data-state")])
            .toEqual([1, null, true, "pending"]);
        await act(async () => { fireEvent.click(within(slot(c, "toolbar")).getByRole("button", { name: editingMessages.apply() })); });
        await waitFor(async () => expect((await h.read(bookings)).has("B-9")).toBe(true), { timeout: 8_000 });
        const rows = await h.read(bookings);
        expect([[...rows.keys()], sameBooking(rows.get("B-9")!, { ref: "B-9", title: "Safety check", start: NINE, end: TEN })]).toEqual([["B-9"], true]);
        await waitFor(() => expect(drawn(c)).toHaveLength(1));
    });
});

describe("a Calendar over bookings keyed by number (east-workspace#1709)", () => {
    test("ruling 10 — Search Records reads the key typed as a number: 12 finds booking 12 alone, never 120 beside it, and 1..200 lists them in their numbers' order — 2, 12, 120", async () => {
        const { container: c } = await h.mount(countedDay);
        await waitFor(() => expect(drawn(c)).toHaveLength(3));
        const input = slot(c, "toolbar").querySelector<HTMLInputElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search'] input")!;
        /** Types a query into the box, and gives the keys of the lines it lists. */
        const listed = async (text: string) => {
            await act(async () => { input.focus(); fireEvent.input(input, { target: { value: text } }); });
            await settle();
            const list = () => document.getElementById(input.getAttribute("aria-controls") ?? "");
            await waitFor(() => expect(list()?.querySelector('[role="option"]')).not.toBeNull(), { timeout: 10_000 });
            return [...list()!.querySelectorAll('[role="option"] [data-item-key]')].map((key) => key.textContent);
        };
        expect(await listed("12")).toEqual(["12"]);
        expect(await listed("1..200")).toEqual(["2", "12", "120"]);
    });
});

describe("a Calendar's event kind keyed by any type, read through its source of the slice (east-workspace#1696)", () => {
    test("#1696 — a booking keyed by a struct draws through its source, is selected, moves an hour later from its Details, and Save writes it under its own key", async () => {
        const { container: c } = await h.mount(placedDay);
        await laterAnHourAndSaved(c, printFor(Placed)(A1));
        await waitFor(async () => expect((await h.read(placed)).get(A1)?.start.getTime()).toBe(TEN.getTime()), { timeout: 8_000 });
        const rows = await h.read(placed);
        expect([rows.size, rows.get(A1)!.ref, rows.get(A1)!.title]).toEqual([1, "A-1", "Safety check"]);
    });

    test("#1696 — a booking keyed by a variant, as a composite record keys its rows, draws through its source, is selected, moves an hour later from its Details, and Save writes it under its own key", async () => {
        const { container: c } = await h.mount(sourcedDay);
        await laterAnHourAndSaved(c, printFor(Sourced)(PO7));
        await waitFor(async () => expect((await h.read(sourced)).get(PO7)?.start.getTime()).toBe(TEN.getTime()), { timeout: 8_000 });
        const rows = await h.read(sourced);
        expect([rows.size, rows.get(PO7)!.ref, rows.get(PO7)!.title]).toEqual([1, "PO-7", "Safety check"]);
    });
});

const sameKey = equalFor(StringType);
