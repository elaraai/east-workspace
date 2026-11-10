/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * A number its field's bounds don't hold (#1585): given the form from anywhere
 * — under its least, or over its most — it is held as it is, the field takes
 * the warn wash a field an issue names takes, and the bound is said once, in
 * the tone the host says it in: in the help line, which names the field's
 * bounds — or, where the field prints its value, in its hint's own words on a
 * line of its own in the help line, under the help the host gives it. A row as
 * stored (`breaches: "warn"`) says it in the warn tone, the field never
 * invalid; a changed one's (`"error"`, the default) in the danger tone, the
 * field invalid. `fieldBreaches` finds the same fields for a host's issues, a
 * field under a case its variant doesn't hold, or holding no value, breaking
 * none. An edit of it the host refuses says the refusal on a line of its own,
 * the bound still said once in the help line, until the host gives the field a
 * value.
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
import { FieldForm, fieldBreachText, fieldBreaches, fieldFormMessages, type FieldFormProps } from "./index.js";

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
    length: Fields.number({ unit: "m", max: 4, help: "Cut to the order" }),
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

/** What a field says of its value: its help line, the part of it said in a tone and that tone, its error line, its wash and whether its box is invalid. */
interface Said {
    readonly help: string | null;
    readonly toned: readonly [string | null, string | null] | null;
    readonly error: string | null;
    readonly washed: boolean;
    readonly invalid: boolean;
}

/** The form over a batch — as stored or changed, printed or not — and what each field says, by key. */
function said(value: BatchValue, props: Partial<Pick<FieldFormProps, "breaches" | "readOnly">> = {}) {
    const { container } = render(<ChakraProvider value={system}><I18nProvider locale="en-US">
        <FieldForm specs={SPECS} value={value} onChange={() => {}} {...props} />
    </I18nProvider></ChakraProvider>);
    const field = (key: string) => container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
    const line = (key: string): Said => {
        const el = field(key);
        const toned = el.querySelector("[data-scope=field][data-part=helper-text] [data-breach]");
        return {
            help: el.querySelector("[data-scope=field][data-part=helper-text]")?.textContent ?? null,
            toned: toned === null ? null : [toned.textContent, toned.getAttribute("data-breach")],
            error: el.querySelector("[data-scope=field][data-part=error-text]")?.textContent ?? null,
            washed: el.hasAttribute("data-issue"),
            invalid: el.querySelector("[aria-invalid=true]") !== null,
        };
    };
    return { line, field };
}

const BROKEN: BatchValue = { crew: 0n, length: 4.5, coats: some(0n), portion: variant("sliced", 0n) };
const KEYS = ["crew", "length", "coats", "portion.sliced"];

test("a number given the form under its least or over its most is said once, in the help line that names its bounds, and washed as an issue's field; one its bounds hold, in no tone (#1585)", () => {
    const { line } = said(BROKEN);
    expect(KEYS.map(line)).toEqual([
        { help: "1–12 people", toned: ["1–12 people", "error"], error: null, washed: true, invalid: true },
        { help: "Cut to the order · at most 4 m", toned: ["Cut to the order · at most 4 m", "error"], error: null, washed: true, invalid: true },
        { help: "at least 1", toned: ["at least 1", "error"], error: null, washed: true, invalid: true },
        { help: "at least 1", toned: ["at least 1", "error"], error: null, washed: true, invalid: true },
    ]);
    cleanup();
    const held = said({ crew: 12n, length: 4, coats: none, portion: variant("sliced", 1n) });
    expect(KEYS.map(held.line)).toEqual([
        { help: "1–12 people", toned: null, error: null, washed: false, invalid: false },
        { help: "Cut to the order · at most 4 m", toned: null, error: null, washed: false, invalid: false },
        { help: "at least 1", toned: null, error: null, washed: false, invalid: false },
        { help: "at least 1", toned: null, error: null, washed: false, invalid: false },
    ]);
});

test("a row as stored says the bound in the warn tone, the field never invalid; a changed row's in the danger tone, the field invalid (#1585)", () => {
    const stored = said(BROKEN, { breaches: "warn" });
    expect([stored.line("crew"), stored.field("crew").getAttribute("data-breach")]).toEqual([
        { help: "1–12 people", toned: ["1–12 people", "warn"], error: null, washed: true, invalid: false }, "warn",
    ]);
    cleanup();
    const changed = said(BROKEN, { breaches: "error" });
    expect([changed.line("crew"), changed.field("crew").getAttribute("data-breach")]).toEqual([
        { help: "1–12 people", toned: ["1–12 people", "error"], error: null, washed: true, invalid: true }, "error",
    ]);
    cleanup();
    expect(said({ crew: 12n, length: 4, coats: none, portion: variant("whole", null) }).field("crew").hasAttribute("data-breach")).toBe(false);
});

test("a printed number its bounds don't hold says the bound on a line of its own in its help line, under the host's help, in the tone; its help names no bound (#1585)", () => {
    const stored = said(BROKEN, { breaches: "warn", readOnly: true });
    const bound = (key: string) => stored.field(key).querySelector("[data-field-breach]");
    expect([stored.line("length"), stored.line("crew"), bound("length")?.previousSibling?.textContent]).toEqual([
        { help: "Cut to the order at most 4", toned: ["at most 4", "warn"], error: null, washed: true, invalid: false },
        { help: "at least 1", toned: ["at least 1", "warn"], error: null, washed: true, invalid: false },
        "Cut to the order ",
    ]);
    cleanup();
    const changed = said(BROKEN, { breaches: "error", readOnly: true });
    expect(changed.line("length")).toEqual({ help: "Cut to the order at most 4", toned: ["at most 4", "error"], error: null, washed: true, invalid: true });
});

test("fieldBreaches finds each field its bounds don't hold, for a host's issues — never one under a case the variant doesn't hold, nor one holding no value (#1585)", () => {
    const found = fieldBreaches(SPECS, { crew: 13n, length: -1, coats: none, portion: variant("whole", null) });
    expect(found.map((breach) => [breach.key, breach.side, fieldBreachText(breach, WORDS)])).toEqual([["crew", "max", "at most 12"]]);
    expect(fieldBreaches(SPECS, { crew: 1n, length: 0, coats: some(1n), portion: variant("sliced", 0n) }).map((breach) => breach.key)).toEqual(["portion.sliced"]);
});

test("an edit the host refuses of a number its bounds don't hold says the refusal on a line of its own, the bound still said once in the help line; a value the host gives says its own bound (#1585)", async () => {
    const SET = "The crew is set by the roster";
    const form = (crew: bigint) => <ChakraProvider value={system}><I18nProvider locale="en-US">
        <FieldForm specs={SPECS} value={{ crew, length: 1, coats: none, portion: variant("whole", null) }} breaches="warn" onChange={() => SET} />
    </I18nProvider></ChakraProvider>;
    const { container, rerender } = render(form(0n));
    const crew = () => container.querySelector<HTMLElement>('[data-field="crew"]')!;
    const lines = () => [
        [...crew().querySelectorAll("[data-scope=field][data-part=error-text]")].map((el) => el.textContent),
        crew().querySelector("[data-scope=field][data-part=helper-text] [data-breach]")?.textContent ?? null,
    ];
    expect(lines()).toEqual([[], "1–12 people"]);
    const user = userEvent.setup();
    const box = within(crew()).getByRole("spinbutton");
    await user.clear(box);
    await user.type(box, "5");
    await user.keyboard("{Enter}");
    await settle();
    expect([lines(), crew().hasAttribute("data-issue"), within(crew()).getByRole("spinbutton").getAttribute("aria-invalid")]).toEqual([[[SET], "1–12 people"], true, "true"]);
    rerender(form(13n));
    await settle();
    expect([lines(), within(crew()).getByRole("spinbutton").getAttribute("aria-invalid")]).toEqual([[[], "1–12 people"], null]);
});
