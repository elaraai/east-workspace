/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * A number its field's bounds don't hold (#1585): given the form from anywhere
 * — under its least, or over its most — it is held as it is, said under the
 * field in its hint's own words, and the field takes the warn wash a field an
 * issue names takes; `fieldBreaches` finds the same fields for a host's
 * issues, a field under a case its variant doesn't hold, or holding no value,
 * breaking none. An edit of it the host refuses says the refusal in that one
 * line, in place of the bound, until the host gives the field a value.
 */

import { afterEach, expect, test } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { FloatType, IntegerType, NullType, OptionType, StructType, VariantType, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { system } from "../../theme/index.js";
import { formatters } from "../../format/index.js";
import { FieldForm, fieldBreachText, fieldBreaches, fieldFormMessages } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

afterEach(cleanup);

const Portion = VariantType({ whole: NullType, sliced: IntegerType });
const Batch = StructType({ crew: IntegerType, length: FloatType, coats: OptionType(IntegerType), portion: Portion });
type BatchValue = ValueTypeOf<typeof Batch>;
const SPECS = Fields.specs(Batch, {
    crew: Fields.number({ unit: "people", min: 1n, max: 12n }),
    length: Fields.number({ unit: "m", max: 4 }),
    coats: Fields.number({ min: 1n }),
    portion: Fields.select({ labels: { whole: "Whole", sliced: "Sliced" }, cases: { sliced: Fields.number({ label: "Slices", min: 1n }) } }),
});
const WORDS = { ...formatters("en-US"), m: fieldFormMessages };

/** Lets the form's microtasks and timers run. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** The form over a batch, and each field's line under it and whether it takes the warn wash, by key. */
function said(value: BatchValue) {
    const { container } = render(<ChakraProvider value={system}><I18nProvider locale="en-US">
        <FieldForm specs={SPECS} value={value} onChange={() => {}} />
    </I18nProvider></ChakraProvider>);
    const line = (key: string) => {
        const field = container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
        return [field.querySelector("[data-scope=field][data-part=error-text]")?.textContent ?? null, field.hasAttribute("data-issue")];
    };
    return { line };
}

test("a number given the form under its least or over its most is said under the field, in its hint's own words, and washed as an issue's field; one its bounds hold, none (#1585)", () => {
    const { line } = said({ crew: 0n, length: 4.5, coats: some(0n), portion: variant("sliced", 0n) });
    expect([line("crew"), line("length"), line("coats"), line("portion.sliced")]).toEqual([
        ["at least 1", true], ["at most 4", true], ["at least 1", true], ["at least 1", true],
    ]);
    cleanup();
    const held = said({ crew: 12n, length: 4, coats: none, portion: variant("sliced", 1n) });
    expect([held.line("crew"), held.line("length"), held.line("coats"), held.line("portion.sliced")]).toEqual([
        [null, false], [null, false], [null, false], [null, false],
    ]);
});

test("fieldBreaches finds each field its bounds don't hold, for a host's issues — never one under a case the variant doesn't hold, nor one holding no value (#1585)", () => {
    const found = fieldBreaches(SPECS, { crew: 13n, length: -1, coats: none, portion: variant("whole", null) });
    expect(found.map((breach) => [breach.key, breach.side, fieldBreachText(breach, WORDS)])).toEqual([["crew", "max", "at most 12"]]);
    expect(fieldBreaches(SPECS, { crew: 1n, length: 0, coats: some(1n), portion: variant("sliced", 0n) }).map((breach) => breach.key)).toEqual(["portion.sliced"]);
});

test("an edit the host refuses of a number its bounds don't hold says the refusal alone, one line under the field; a value the host gives says its own bound (#1585)", async () => {
    const SET = "The crew is set by the roster";
    const form = (crew: bigint) => <ChakraProvider value={system}><I18nProvider locale="en-US">
        <FieldForm specs={SPECS} value={{ crew, length: 1, coats: none, portion: variant("whole", null) }} onChange={() => SET} />
    </I18nProvider></ChakraProvider>;
    const { container, rerender } = render(form(0n));
    const crew = () => container.querySelector<HTMLElement>('[data-field="crew"]')!;
    const lines = () => [...crew().querySelectorAll("[data-scope=field][data-part=error-text]")].map((el) => el.textContent);
    expect(lines()).toEqual(["at least 1"]);
    const user = userEvent.setup();
    const box = within(crew()).getByRole("spinbutton");
    await user.clear(box);
    await user.type(box, "5");
    await user.keyboard("{Enter}");
    await settle();
    expect([lines(), crew().hasAttribute("data-issue")]).toEqual([[SET], true]);
    rerender(form(13n));
    await settle();
    expect(lines()).toEqual(["at most 12"]);
});
