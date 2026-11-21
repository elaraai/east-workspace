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
 * and its Details say which key.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DateTimeType, DictType, East, SetType, StringType, StructType, equalFor } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { editingMessages } from "@elaraai/east-ui-components";
import { Calendar, Record } from "@elaraai/e3-ui";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { act, event, settle, slot } from "./harness.test-utils.js";

/** A booking: its reference, what it is, and when it runs. */
const Booking = StructType({ ref: StringType, title: StringType, start: DateTimeType, end: DateTimeType });
const NINE = new Date("2026-10-01T09:00:00Z"), TEN = new Date("2026-10-01T10:00:00Z"), ELEVEN = new Date("2026-10-01T11:00:00Z");
/** The bookings: one, which a new one is copied from. */
const bookings = e3.record("calendar_keyed_bookings", DictType(StringType, Booking), {
    initial: new Map([["B-1", { ref: "B-1", title: "Safety check", start: NINE, end: TEN }]]),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

const h = e3Harness({ "calendar/row-keys": { bookings } }, { main: "data-calendar-main" });
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

/** The keys of the bookings the day draws. */
const drawn = (c: HTMLElement): string[] => [...c.querySelectorAll<HTMLElement>("[data-calendar-event]")].map((el) => el.getAttribute("data-calendar-event")!);

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
});

const sameKey = equalFor(StringType);
