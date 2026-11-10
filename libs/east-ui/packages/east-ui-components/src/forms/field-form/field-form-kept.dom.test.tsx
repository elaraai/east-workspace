/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * A number outside its field's bounds changes only as the person changes it
 * (#1585): a stored one the keyboard passes through stays as stored — the box
 * shows it still, and the host is told nothing — and one typed past the bounds
 * is told the host as typed, never held to them, for the host to flag; where
 * what the form edits can't stand outside them (`refusesBreaches`), refused,
 * the field saying the bound. An Integer and a Float alike.
 */

import { afterEach, expect, test } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { FloatType, IntegerType, StructType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { system } from "../../theme/index.js";
import { FieldForm } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

afterEach(cleanup);

// A machine's booking: its hours at most 4, its rate between 1 and 2 — each stored past its most.
const Booking = StructType({ hours: IntegerType, rate: FloatType });
type BookingValue = ValueTypeOf<typeof Booking>;
const SPECS = Fields.specs(Booking, { hours: Fields.number({ max: 4n }), rate: Fields.number({ min: 1, max: 2 }) });
const STORED: BookingValue = { hours: 5n, rate: 2.5 };

/** Lets the form's microtasks and timers run. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** The form over the stored booking, a host taking each edit, and what it was told; a field's box, and what it says of an edit it refused, by key. */
function form(extra: { refusesBreaches?: boolean; live?: boolean } = {}) {
    const told: { path: string; value: unknown }[] = [];
    const { container } = render(<ChakraProvider value={system}><I18nProvider locale="en-US">
        <FieldForm specs={SPECS} value={STORED} refusesBreaches={extra.refusesBreaches} live={extra.live}
            onChange={(path, value) => { told.push({ path: path.join("."), value }); }} />
        <button type="button">elsewhere</button>
    </I18nProvider></ChakraProvider>);
    const field = (key: string) => container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
    const box = (key: string) => within(field(key)).getByRole<HTMLInputElement>("spinbutton");
    const said = (key: string) => field(key).querySelector("[data-scope=field][data-part=error-text]")?.textContent;
    return { told, box, said };
}

test("a stored number past its bounds the keyboard passes through stays as stored: the box shows it still, and the host is told nothing (#1585)", async () => {
    const f = form();
    const user = userEvent.setup();
    await user.click(f.box("hours"));
    await user.tab();
    await user.tab();
    await user.click(within(document.body).getByRole("button", { name: "elsewhere" }));
    await settle();
    expect([f.box("hours").value, f.box("rate").value, f.told]).toEqual(["5", "2.5", []]);
    // Back in the box, and Enter: still nothing to tell.
    await user.click(f.box("hours"));
    await user.keyboard("{Enter}");
    await user.click(within(document.body).getByRole("button", { name: "elsewhere" }));
    await settle();
    expect([f.box("hours").value, f.told]).toEqual(["5", []]);
});

test("a number typed past its bounds is told the host as typed, never held to them: 9 hours over a most of 4, a rate of 3 over a most of 2 (#1585)", async () => {
    const f = form();
    const user = userEvent.setup();
    await user.clear(f.box("hours"));
    await user.type(f.box("hours"), "9");
    await user.tab();
    await settle();
    await user.clear(f.box("rate"));
    await user.type(f.box("rate"), "3");
    await user.tab();
    await settle();
    expect(f.told.map((edit) => edit.path)).toEqual(["hours", "rate"]);
    expect([equalFor(IntegerType)(f.told[0]!.value as bigint, 9n), equalFor(FloatType)(f.told[1]!.value as number, 3)]).toEqual([true, true]);
});

test("where what the form edits can't stand outside its bounds, a number typed past them is refused: the host is told nothing, the box shows what the field holds, and the field says the bound — committed, and live as it is typed (#1585)", async () => {
    for (const live of [false, true]) {
        const f = form({ refusesBreaches: true, live });
        const user = userEvent.setup();
        await user.clear(f.box("hours"));
        await user.type(f.box("hours"), "9");
        await user.tab();
        await settle();
        await user.clear(f.box("rate"));
        await user.type(f.box("rate"), "3");
        await user.tab();
        await settle();
        expect([f.told, f.box("hours").value, f.said("hours"), f.box("rate").value, f.said("rate")], live ? "live" : "committed")
            .toEqual([[], "5", "at most 4", "2.5", "at most 2"]);
        cleanup();
    }
});
