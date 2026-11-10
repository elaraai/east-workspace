/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * A number's box emptied (#1585): its input tells nothing as it is typed — no
 * number reads from it — so the form reads its text as the edit commits, on
 * Enter or as the keyboard leaves it. An Option's is none. Any other field's is
 * the field left with no value: a host that takes one (`takesUnset`) is told it
 * as `undefined`, and its refusal said under the field; else the form refuses
 * it, the field showing what it holds again and saying it can't be left empty.
 * A number typed before the box was emptied is never committed, and Esc puts
 * the box back.
 */

import { afterEach, expect, test } from "vitest";
import { act, cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { IntegerType, OptionType, StructType, none, some, type ValueTypeOf } from "@elaraai/east";
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

const Job = StructType({ crew: IntegerType, coats: OptionType(IntegerType) });
type JobValue = ValueTypeOf<typeof Job>;
const SPECS = Fields.specs(Job, { crew: Fields.number({ unit: "people" }), coats: Fields.number({ min: 1n }) });
const JOB: JobValue = { crew: 4n, coats: some(2n) };

/** Lets the form's microtasks and timers run. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** The form over a job, what its host is told, and a field's box and the line under it, by key. */
function form(props: { takesUnset?: boolean; refuse?: string } = {}) {
    const told: [readonly string[], unknown][] = [];
    const { container } = render(<ChakraProvider value={system}><I18nProvider locale="en-US">
        <FieldForm specs={SPECS} value={JOB} takesUnset={props.takesUnset}
            onChange={(path, value) => { told.push([path, value]); return props.refuse; }} />
        <button type="button">elsewhere</button>
    </I18nProvider></ChakraProvider>);
    const field = (key: string) => container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
    const box = (key: string) => within(field(key)).getByRole<HTMLInputElement>("spinbutton");
    const line = (key: string) => field(key).querySelector("[data-scope=field][data-part=error-text]")?.textContent ?? null;
    return { told, box, line };
}

test("a required number's box emptied and committed — on Enter, or as the keyboard leaves it — shows what the field holds again, saying it can't be left empty, and tells the host nothing (#1585)", async () => {
    const f = form();
    const user = userEvent.setup();
    await user.clear(f.box("crew"));
    await user.keyboard("{Enter}");
    await settle();
    expect([f.box("crew").value, f.line("crew"), f.told]).toEqual(["4", "Crew can't be left empty", []]);
    // The keyboard stays on the field's box, and leaving it emptied says the same.
    expect(document.activeElement).toBe(f.box("crew"));
    await user.clear(f.box("crew"));
    await user.click(within(document.body).getByRole("button", { name: "elsewhere" }));
    await settle();
    expect([f.box("crew").value, f.line("crew"), f.told]).toEqual(["4", "Crew can't be left empty", []]);
});

test("a host that takes a field unset is told the emptied box as no value, and its refusal is said under the field, the box showing what it holds (#1585)", async () => {
    const f = form({ takesUnset: true, refuse: "Crew can't be left empty — the roster needs one" });
    const user = userEvent.setup();
    await user.clear(f.box("crew"));
    await user.keyboard("{Enter}");
    await settle();
    expect(f.told).toEqual([[["crew"], undefined]]);
    expect([f.box("crew").value, f.line("crew")]).toEqual(["4", "Crew can't be left empty — the roster needs one"]);
});

test("an Option's number emptied is none, whether or not the host takes a field unset (#1585)", async () => {
    for (const takesUnset of [false, true]) {
        const f = form({ takesUnset });
        const user = userEvent.setup();
        await user.clear(f.box("coats"));
        await user.keyboard("{Enter}");
        await settle();
        expect(f.told).toEqual([[["coats"], none]]);
        cleanup();
    }
});

test("a number typed before its box was emptied is never committed, and Esc puts an emptied box back (#1585)", async () => {
    const f = form({ takesUnset: true });
    const user = userEvent.setup();
    await user.clear(f.box("crew"));
    await user.type(f.box("crew"), "7");
    await user.clear(f.box("crew"));
    await user.keyboard("{Enter}");
    await settle();
    expect(f.told).toEqual([[["crew"], undefined]]);
    cleanup();
    const g = form();
    await user.clear(g.box("crew"));
    await user.keyboard("{Escape}");
    await settle();
    expect([g.box("crew").value, g.line("crew"), g.told]).toEqual(["4", null, []]);
});
