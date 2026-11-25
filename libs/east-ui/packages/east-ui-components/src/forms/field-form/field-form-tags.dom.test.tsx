/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * A tag typed and not Entered (#1758): what is typed into a form is one edit
 * as the keyboard leaves its field, and a tag is no other — the text left in a
 * tags field's box is a tag as the keyboard leaves it, told its host as an
 * edit of the field, never left in the box unsaid, where a host that commits
 * by a button of its own (a Save) would pass it by. A box left empty is no
 * edit, and a tag the field holds already is held once.
 */

import { afterEach, expect, test } from "vitest";
import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { ArrayType, SetType, SortedSet, StringType, StructType, compareFor, equalFor, type ValueTypeOf } from "@elaraai/east";
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

const Job = StructType({ finishes: SetType(StringType), stages: ArrayType(StringType) });
type JobValue = ValueTypeOf<typeof Job>;
const SPECS = Fields.specs(Job, { finishes: Fields.tags(), stages: Fields.tags() });
const STRINGS = compareFor(StringType);
const JOB: JobValue = { finishes: new SortedSet(["oiled"], STRINGS), stages: ["cut"] };
const sameFinishes = equalFor(SetType(StringType));
const sameStages = equalFor(ArrayType(StringType));

/** Lets the form's microtasks and timers run. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** The form over a job, what its host is told, and a tags field's box, by key. */
function form() {
    const told: [readonly string[], unknown][] = [];
    const { container } = render(<ChakraProvider value={system}><I18nProvider locale="en-US">
        <FieldForm specs={SPECS} value={JOB} onChange={(path, value) => { told.push([path, value]); }} />
        <button type="button">elsewhere</button>
    </I18nProvider></ChakraProvider>);
    const field = (key: string) => container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
    const box = (key: string) => field(key).querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;
    const elsewhere = () => within(document.body).getByRole("button", { name: "elsewhere" });
    return { told, box, elsewhere };
}

test("a tag typed and not Entered is a tag as the keyboard leaves its box: a Set's held in East's order, an Array's at its end (#1758)", async () => {
    const f = form();
    const user = userEvent.setup();
    await user.click(f.box("finishes"));
    await user.type(f.box("finishes"), "glazed");
    expect(f.told).toEqual([]);
    await user.click(f.elsewhere());
    await settle();
    expect(f.told).toHaveLength(1);
    expect(f.told[0]![0]).toEqual(["finishes"]);
    expect(sameFinishes(f.told[0]![1] as JobValue["finishes"], new SortedSet(["glazed", "oiled"], STRINGS))).toBe(true);
    // The box is emptied: its text is the tag now.
    await waitFor(() => expect(f.box("finishes").value).toBe(""));

    await user.click(f.box("stages"));
    await user.type(f.box("stages"), "sand");
    await user.tab();
    await settle();
    expect(f.told).toHaveLength(2);
    expect(f.told[1]![0]).toEqual(["stages"]);
    expect(sameStages(f.told[1]![1] as JobValue["stages"], ["cut", "sand"])).toBe(true);
});

test("a box left empty is no edit, and a tag the field holds already is held once (#1758)", async () => {
    const f = form();
    const user = userEvent.setup();
    await user.click(f.box("finishes"));
    await user.click(f.elsewhere());
    await settle();
    expect(f.told).toEqual([]);
    await user.click(f.box("finishes"));
    await user.type(f.box("finishes"), "oiled");
    await user.click(f.elsewhere());
    await settle();
    expect(f.told).toEqual([]);
});
