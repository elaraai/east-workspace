/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * `FieldForm` (#1147) over a joinery job: each field the shared `Field`
 * around the shared input its East type takes; a typed edit one edit on
 * leaving the field or on Enter, Esc putting it back, a new value from the
 * host dropping it; a choice an edit at once; an Option's Set and Clear; a
 * checklist's items; the tint of a changed field; read-only, every value
 * printed. And (#1188) a field with no value yet, a date's precision, and a
 * control the host draws itself; and (#1250) a text's control titled with its
 * whole text, and a choice's with its chosen words; and (#1473) a choice of up
 * to four cases a radio group; and (#1534) a field a host draws on one line,
 * the wash of a field an issue names, and the field a host names taking the
 * keyboard; and (#1549) a variant whose cases hold data edited as a block
 * under its choice, and a reference to a key of any type; and (#1561) a line's
 * help under it; and (#1585) an edit the host refuses, the field showing what
 * it holds and saying why. Every value handed back is asserted with East's
 * `equalFor`.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet,
    StringType, StructType, VariantType, compareFor, equalFor, isVariant, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { formatters } from "../../format/index.js";
import { FieldForm, type FieldLineChoice } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});
// A select scrolls its open listbox to the chosen option; jsdom does not scroll.
Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");

afterEach(cleanup);

// Five cases: past four, a choice is a select (#1473).
const Status = VariantType({ planned: NullType, underway: NullType, paused: NullType, done: NullType, cancelled: NullType });
const Step = StructType({ text: StringType, done: BooleanType });
const Site = StructType({ room: StringType, floor: IntegerType });
const Job = StructType({
    task: StringType, crew: IntegerType, length: FloatType, rush: BooleanType, due: DateTimeType, status: Status,
    finishes: SetType(StringType), steps: ArrayType(Step), bench: OptionType(StringType), note: OptionType(StringType),
    batch: OptionType(IntegerType), stock: DictType(StringType, IntegerType), site: Site,
});
type JobValue = ValueTypeOf<typeof Job>;

const SPECS = Fields.specs(Job, {
    crew: Fields.number({ unit: "people", min: 1n, max: 20n, help: "On the job at once" }),
    length: Fields.number({ unit: "m", step: 0.5 }),
    status: Fields.select({ labels: { planned: "Planned", underway: "Underway", done: "Done" } }),
    finishes: Fields.tags({ options: ["oiled", "waxed", "painted"] }),
    bench: Fields.reference({ of: "benches" }),
    batch: Fields.number({ min: 1n }),
});

const BENCHES = { benches: [{ key: "B1", label: "Bench 1" }, { key: "B2", label: "Bench 2" }] };
const STRINGS = compareFor(StringType);
const LOCALE = "en-US";

const JOB: JobValue = {
    task: "Hang doors",
    crew: 4n,
    length: 2.5,
    rush: false,
    due: new Date(Date.UTC(2026, 9, 6, 9, 0)),
    status: variant("planned", null),
    finishes: new SortedSet(["oiled"], STRINGS),
    steps: [{ text: "Measure", done: true }, { text: "Cut", done: false }],
    bench: some("B2"),
    note: none,
    batch: none,
    stock: new SortedMap([["hinges", 12n]], STRINGS),
    site: { room: "Workshop", floor: 1n },
};

/** One edit the form handed back. */
interface Edit { path: string; value: unknown }

/** The value with one field set along its path — a step into a variant through the case it holds — a host's draft. */
function setAt<V>(value: V, path: readonly string[], next: unknown): V {
    const [head, ...rest] = path;
    if (head === undefined) return next as V;
    if (isVariant(value)) return variant(head, setAt(value.value, rest, next)) as V;
    const struct = value as Record<string, unknown>;
    return { ...struct, [head]: setAt(struct[head], rest, next) } as V;
}

/** Mounts the form over the job, a host applying each edit to the value it shows. */
function mount(props: { baseline?: JobValue; readOnly?: boolean } = {}) {
    const edits: Edit[] = [];
    let tell: (value: JobValue) => void = () => {};
    function Host() {
        const [value, setValue] = useState<JobValue>(JOB);
        tell = setValue;
        return (
            <FieldForm specs={SPECS} value={value} baseline={props.baseline} options={BENCHES} readOnly={props.readOnly}
                onChange={(path, next) => {
                    edits.push({ path: path.join("."), value: next });
                    setValue((v) => setAt(v as unknown as Record<string, unknown>, path, next) as unknown as JobValue);
                }} />
        );
    }
    const utils = render(<ChakraProvider value={system}><I18nProvider locale={LOCALE}><Host /></I18nProvider></ChakraProvider>);
    const field = (key: string) => utils.container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
    return { ...utils, edits, field, host: (value: JobValue) => act(() => { tell(value); }) };
}

/** Let the inputs' microtasks and the renders settle. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/**
 * Types into a number input a key at a time, each key where the caret rests:
 * the shared number input writes what it reads back into the box as a key
 * lands, and user-event's caret, typing several keys in one call, does not
 * follow that write under jsdom (a box cleared to "" and typed "3.5" in one
 * call reads ".53"; Chromium keeps the caret, and reads "3.5").
 */
async function typeKeys(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) {
    for (const key of text) {
        await user.type(el, key);
        await settle();
    }
}

/** The focus leaves the field. */
async function leave(el: HTMLElement) {
    await act(async () => { fireEvent.focusOut(el); });
    await settle();
}

/** Opens a select from its trigger: the choices it offers, in order. */
async function open(field: HTMLElement): Promise<string[]> {
    const trigger = field.querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await act(async () => { fireEvent.click(trigger); });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    return within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent ?? "");
}

/** Picks a choice of the open select by its words; picking closes it. */
async function choose(name: string) {
    await act(async () => { fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name })); });
    await settle();
}

/** The one edit made, its path, and its value as East compares it. */
function expectEdit(edits: readonly Edit[], path: string, equal: (a: never, b: never) => boolean, value: unknown) {
    expect(edits.map((e) => e.path)).toEqual([path]);
    expect(equal(edits[0]!.value as never, value as never)).toBe(true);
}

describe("FieldForm — each field the shared Field around the shared input its type takes (#1147)", () => {
    test("the editor per field, from its type and hint; the hinted fields first; a nested struct's under its name", () => {
        const { container, field } = mount();
        const editors = [...container.querySelectorAll<HTMLElement>("[data-field]")].map((el) => `${el.getAttribute("data-field")}:${el.getAttribute("data-editor")}`);
        expect(editors).toEqual([
            "crew:number", "length:number", "status:select", "finishes:tags", "bench:reference", "batch:number",
            "task:text", "rush:checkbox", "due:datetime", "steps:checklist", "note:text", "stock:readonly",
            "site.room:text", "site.floor:number",
        ]);
        // Each is the shared Field: its label and its help line.
        for (const el of container.querySelectorAll<HTMLElement>("[data-field]")) {
            expect(el.querySelector("[data-scope=field][data-part=root]")).not.toBeNull();
        }
        // A nested struct's fields sit under its name, each by its own label.
        expect(field("site.room").querySelector("label")!.textContent).toBe("Room");
        expect(within(screen.getByRole("group", { name: "Site" })).getAllByText(/^(Room|Floor)$/).map((el) => el.textContent)).toEqual(["Room", "Floor"]);
        // The shared inputs, by type.
        expect(within(field("task")).getByRole("textbox")).toBeTruthy();
        expect(field("crew").querySelector("[data-scope=number-input]")).not.toBeNull();
        expect(field("length").querySelector("[data-scope=number-input]")).not.toBeNull();
        expect(field("rush").querySelector("[data-scope=checkbox]")).not.toBeNull();
        expect(within(field("due")).getAllByRole("spinbutton").length).toBeGreaterThan(0);
        expect(field("status").querySelector("[data-scope=select][data-part=trigger]")!.textContent).toBe("Planned");
        expect(field("finishes").querySelector("[data-scope=tags-input]")).not.toBeNull();
        expect(field("bench").querySelector("[data-scope=select][data-part=trigger]")!.textContent).toBe("Bench 2");
        // A number's help line: the author's, then its bounds and unit.
        expect(field("crew").querySelector("[data-part=helper-text]")!.textContent).toBe("On the job at once · 1–20 people");
        expect(field("length").querySelector("[data-part=helper-text]")!.textContent).toBe("in m · step 0.5");
        // Anything else is printed, as East prints it.
        expect((within(field("stock")).getByRole("textbox") as HTMLInputElement).value).toBe(printFor(DictType(StringType, IntegerType))(JOB.stock));
    });

    test("each control is named by its Field's label, as the shared Ark inputs are; the label holds no key, no word for the people a builder is for", () => {
        const { field } = mount();
        expect(field("crew").querySelector("label")!.textContent).toBe("Crew");
        expect(field("crew").querySelector("[data-field-key]")).toBeNull();
        expect(namesOf(field("task"), "textbox")).toEqual(["Task"]);
        expect(namesOf(field("site.room"), "textbox")).toEqual(["Room"]);
        expect(namesOf(field("stock"), "textbox")).toEqual(["Stock"]);
        expect(namesOf(field("crew"), "spinbutton")).toEqual(["Crew"]);
        expect(namesOf(field("length"), "spinbutton")).toEqual(["Length"]);
        expect(namesOf(field("status"), "combobox")).toEqual(["Status"]);
        expect(namesOf(field("bench"), "combobox")).toEqual(["Bench"]);
        // A date's segments: each named by its own part, then the label (`month, Due`).
        const due = namesOf(field("due"), "spinbutton");
        expect(due.length).toBeGreaterThan(0);
        expect(due.filter((name) => !/^[^,]+, Due$/.test(name))).toEqual([]);
    });

    test("a text is one edit on Enter, never per keystroke; Esc puts it back; leaving the field commits it", async () => {
        const { field, edits } = mount();
        const user = userEvent.setup();
        const input = within(field("task")).getByRole("textbox") as HTMLInputElement;
        await user.clear(input);
        await user.type(input, "Hang doors and frames");
        await settle();
        expect(edits).toEqual([]);
        await user.keyboard("{Enter}");
        await settle();
        expectEdit(edits, "task", equalFor(StringType), "Hang doors and frames");

        await user.type(input, " later");
        await user.keyboard("{Escape}");
        await settle();
        expect((within(field("task")).getByRole("textbox") as HTMLInputElement).value).toBe("Hang doors and frames");
        await leave(within(field("task")).getByRole("textbox"));
        expect(edits).toHaveLength(1);

        const again = within(field("task")).getByRole("textbox");
        await user.type(again, "!");
        await leave(again);
        expect(edits.map((e) => e.path)).toEqual(["task", "task"]);
        expect(equalFor(StringType)(edits[1]!.value as string, "Hang doors and frames!")).toBe(true);
    });

    test("a number is clamped to its bounds and handed back typed: an Integer as a bigint, a Float as a number", async () => {
        const { field, edits } = mount();
        const user = userEvent.setup();
        const crew = within(field("crew")).getByRole("spinbutton");
        await user.clear(crew);
        await user.type(crew, "25");
        await leave(crew);
        expectEdit(edits, "crew", equalFor(IntegerType), 20n);

        edits.length = 0;
        const length = within(field("length")).getByRole("spinbutton");
        await user.clear(length);
        await typeKeys(user, length, "3.5");
        await user.keyboard("{Enter}");
        await settle();
        expectEdit(edits, "length", equalFor(FloatType), 3.5);
    });

    test("a choice is an edit at once: a checkbox, a variant's case, a reference's key", async () => {
        const { field, edits } = mount();
        await act(async () => { fireEvent.click(field("rush").querySelector("[data-scope=checkbox][data-part=root]")!); });
        await settle();
        expectEdit(edits, "rush", equalFor(BooleanType), true);

        edits.length = 0;
        expect(await open(field("status"))).toEqual(["Planned", "Underway", "Done", "Cancelled", "Paused"]);
        await choose("Underway");
        expectEdit(edits, "status", equalFor(Status), variant("underway", null));

        edits.length = 0;
        expect(await open(field("bench"))).toEqual(["Unassigned", "Bench 1", "Bench 2"]);
        await choose("Bench 1");
        expectEdit(edits, "bench", equalFor(OptionType(StringType)), some("B1"));
        edits.length = 0;
        await open(field("bench"));
        await choose("Unassigned");
        expectEdit(edits, "bench", equalFor(OptionType(StringType)), none);
    });

    test("tags: the options suggested; a tag typed and Entered, a tag removed — a Set's values in East's order", async () => {
        const { field, edits } = mount();
        const user = userEvent.setup();
        expect([...field("finishes").querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(["oiled", "waxed", "painted"]);
        const input = field("finishes").querySelector<HTMLInputElement>("[data-scope=tags-input][data-part=input]")!;
        await user.click(input);
        await user.type(input, "painted{Enter}");
        await settle();
        expectEdit(edits, "finishes", equalFor(SetType(StringType)), new SortedSet(["oiled", "painted"], STRINGS));

        edits.length = 0;
        await act(async () => { fireEvent.click(field("finishes").querySelector("[data-part=item-delete-trigger]")!); });
        await settle();
        expectEdit(edits, "finishes", equalFor(SetType(StringType)), new SortedSet(["painted"], STRINGS));
    });

    test("a checklist: each item the shared Checkbox with its remove; an item toggled, removed, and added by its text and Enter", async () => {
        const { field, edits } = mount();
        const user = userEvent.setup();
        const items = () => [...field("steps").querySelectorAll<HTMLElement>("[data-checklist-item]")];
        expect(items().map((el) => el.textContent)).toEqual(["Measure", "Cut"]);
        expect(field("steps").querySelector("[data-part=helper-text]")!.textContent).toBe("1 / 2 done");
        const Steps = ArrayType(Step);

        await act(async () => { fireEvent.click(items()[1]!.querySelector("[data-scope=checkbox][data-part=root]")!); });
        await settle();
        expectEdit(edits, "steps", equalFor(Steps), [{ text: "Measure", done: true }, { text: "Cut", done: true }]);
        expect(field("steps").querySelector("[data-part=helper-text]")!.textContent).toBe("2 / 2 done");

        edits.length = 0;
        await act(async () => { fireEvent.click(within(items()[0]!).getByRole("button", { name: "Remove Measure" })); });
        await settle();
        expectEdit(edits, "steps", equalFor(Steps), [{ text: "Cut", done: true }]);

        edits.length = 0;
        const add = within(field("steps")).getByPlaceholderText("Add item ⏎");
        await user.type(add, "Sand");
        await settle();
        expect(edits).toEqual([]);
        await user.keyboard("{Enter}");
        await settle();
        expectEdit(edits, "steps", equalFor(Steps), [{ text: "Cut", done: true }, { text: "Sand", done: false }]);
        // The box is empty again for the next item.
        expect((within(field("steps")).getByPlaceholderText("Add item ⏎") as HTMLInputElement).value).toBe("");
    });

    test("an Option: Set gives an empty one a value — a number's least — and Clear empties it; an emptied text is none", async () => {
        const { field, edits } = mount();
        const user = userEvent.setup();
        expect((within(field("batch")).getByRole("textbox") as HTMLInputElement).placeholder).toBe("Not set");
        await act(async () => { fireEvent.click(within(field("batch")).getByRole("button", { name: "Set" })); });
        await settle();
        expectEdit(edits, "batch", equalFor(OptionType(IntegerType)), some(1n));
        expect(field("batch").querySelector("[data-scope=number-input]")).not.toBeNull();

        edits.length = 0;
        await act(async () => { fireEvent.click(within(field("batch")).getByRole("button", { name: "Clear Batch" })); });
        await settle();
        expectEdit(edits, "batch", equalFor(OptionType(IntegerType)), none);

        edits.length = 0;
        const note = within(field("note")).getByRole("textbox") as HTMLInputElement;
        expect(note.placeholder).toBe("Not set");
        await user.type(note, "Back door first");
        await leave(note);
        expectEdit(edits, "note", equalFor(OptionType(StringType)), some("Back door first"));
        edits.length = 0;
        const typed = within(field("note")).getByRole("textbox");
        await user.clear(typed);
        await leave(typed);
        expectEdit(edits, "note", equalFor(OptionType(StringType)), none);
        // A text, a select or a reference clears itself: no Set or Clear beside them.
        for (const key of ["note", "status", "bench"]) expect(within(field(key)).queryByRole("button", { name: /^(Set|Clear)/ })).toBeNull();
    });

    test("Set gives the box it makes the keyboard, its start selected: what is typed next replaces it, never the Clear that took Set's place", async () => {
        const { field, edits } = mount();
        const user = userEvent.setup();
        await user.click(within(field("batch")).getByRole("button", { name: "Set" }));
        await settle();
        expectEdit(edits, "batch", equalFor(OptionType(IntegerType)), some(1n));
        const box = within(field("batch")).getByRole("spinbutton") as HTMLInputElement;
        expect(document.activeElement).toBe(box);
        expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
        edits.length = 0;
        await user.keyboard("7{Enter}");
        await settle();
        expectEdit(edits, "batch", equalFor(OptionType(IntegerType)), some(7n));
    });

    test("a field that differs from the baseline is tinted, and one the drafts change becomes so", async () => {
        const { field, container } = mount({ baseline: { ...JOB, crew: 3n } });
        const user = userEvent.setup();
        const tinted = () => [...container.querySelectorAll("[data-field][data-dirty]")].map((el) => el.getAttribute("data-field"));
        expect(tinted()).toEqual(["crew"]);
        const input = within(field("task")).getByRole("textbox");
        await user.type(input, " now");
        await leave(input);
        expect(tinted()).toEqual(["crew", "task"]);
    });

    test("a new value from the host drops what was typed and not yet committed", async () => {
        const { field, edits, host } = mount();
        const user = userEvent.setup();
        await user.type(within(field("task")).getByRole("textbox"), " soon");
        await host({ ...JOB, task: "Fit frames" });
        await settle();
        const input = within(field("task")).getByRole("textbox") as HTMLInputElement;
        expect(input.value).toBe("Fit frames");
        await leave(input);
        expect(edits).toEqual([]);
    });

    test("read-only, every value is printed; tags and a checklist keep their shape without their controls; no Set or Clear", () => {
        const { field, container } = mount({ readOnly: true });
        const words = formatters(LOCALE);
        const printed = (key: string) => {
            const input = within(field(key)).getByRole("textbox") as HTMLInputElement;
            expect(input.readOnly).toBe(true);
            return input.value;
        };
        expect(printed("task")).toBe("Hang doors");
        expect(printed("crew")).toBe("4");
        expect(printed("length")).toBe(words.number(2.5));
        expect(printed("rush")).toBe("No");
        expect(printed("due")).toBe(words.dateTime(JOB.due));
        expect(printed("status")).toBe("Planned");
        expect(printed("bench")).toBe("Bench 2");
        expect(printed("note")).toBe("—");
        expect(printed("batch")).toBe("—");
        expect(printed("site.floor")).toBe("1");
        expect(printed("steps")).toBe("1 / 2 done");
        expect(field("finishes").querySelector("[data-scope=tags-input][data-part=root]")!.hasAttribute("data-readonly")).toBe(true);
        for (const item of field("steps").querySelectorAll("[data-checklist-item]")) {
            expect(item.querySelector("[data-scope=checkbox][data-part=root]")!.hasAttribute("data-disabled")).toBe(true);
            expect(item.querySelector("button")).toBeNull();
        }
        expect(container.querySelector("[data-field-set], [data-field-clear]")).toBeNull();
        expect(container.querySelector("[data-scope=number-input], [data-scope=select]")).toBeNull();
    });
});

describe("FieldForm — a draft's missing field, a date's precision, and a host's own control (#1188)", () => {
    /** A draft of the job: the fields it has given, every other one missing. */
    function mountDraft(given: Partial<JobValue>, extra: { renderControl?: (spec: FieldSpecValue) => ReactNode | undefined; specs?: readonly FieldSpecValue[] } = {}) {
        const edits: Edit[] = [];
        function Host() {
            const [value, setValue] = useState<Record<string, unknown>>(given as Record<string, unknown>);
            return (
                <FieldForm specs={extra.specs ?? SPECS} value={value} options={BENCHES} renderControl={extra.renderControl}
                    onChange={(path, next) => {
                        edits.push({ path: path.join("."), value: next });
                        setValue((v) => setAt(v, path, next));
                    }} />
            );
        }
        const utils = render(<ChakraProvider value={system}><I18nProvider locale={LOCALE}><Host /></I18nProvider></ChakraProvider>);
        const field = (key: string) => utils.container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
        return { ...utils, edits, field };
    }

    test("a field with no value yet shows Not set: a number, a date or a checkbox with Set, a text empty, a select with nothing chosen", async () => {
        const { field, edits } = mountDraft({ task: "Hang doors", bench: none, note: none, batch: none });
        // A number, a date and a checkbox: Not set, and Set beside it — never Clear, the field is required.
        for (const key of ["crew", "due", "rush"]) {
            expect((within(field(key)).getByRole("textbox") as HTMLInputElement).placeholder).toBe("Not set");
            expect(within(field(key)).getByRole("button", { name: "Set" })).toBeTruthy();
            expect(within(field(key)).queryByRole("button", { name: /^Clear/ })).toBeNull();
        }
        // A required select chooses nothing — its placeholder shows — and offers no Not set.
        expect(chosenOf(field, "status")).toBe("Select...");
        expect(await open(field("status"))).toEqual(["Planned", "Underway", "Done", "Cancelled", "Paused"]);
        await choose("Done");
        expectEdit(edits, "status", equalFor(Status), variant("done", null));

        // Set gives a required number its type's start, held to its bounds: the crew's least is 1.
        edits.length = 0;
        await act(async () => { fireEvent.click(within(field("crew")).getByRole("button", { name: "Set" })); });
        await settle();
        expectEdit(edits, "crew", equalFor(IntegerType), 1n);
        expect(field("crew").querySelector("[data-scope=number-input]")).not.toBeNull();
        expect(within(field("crew")).queryByRole("button", { name: /^(Set|Clear)/ })).toBeNull();
    });

    test("a required text with no value starts empty under Not set, and what is typed is its value", async () => {
        const { field, edits } = mountDraft({ crew: 2n, bench: none, note: none, batch: none });
        const user = userEvent.setup();
        const task = within(field("task")).getByRole("textbox") as HTMLInputElement;
        expect(task.value).toBe("");
        expect(task.placeholder).toBe("Not set");
        await user.type(task, "Fit frames");
        await leave(task);
        expectEdit(edits, "task", equalFor(StringType), "Fit frames");
    });

    test("a date's input takes its editor's precision: at a date, its day, month and year alone — no time to set", () => {
        const Visit = StructType({ on: DateTimeType, at: DateTimeType });
        const [on, at] = Fields.specs(Visit);
        const dated: FieldSpecValue = { ...on!, editor: variant("datetime", { precision: some(variant("date", null)) }) };
        const value = { on: new Date(Date.UTC(2026, 9, 12)), at: new Date(Date.UTC(2026, 9, 12, 14, 30)) };
        const { field } = mountDraft(value as unknown as Partial<JobValue>, { specs: [dated, at!] });
        const segments = (key: string) => within(field(key)).getAllByRole("spinbutton").length;
        // en-US: month, day, year — and a time's hour, minute and AM/PM besides.
        expect(segments("on")).toBe(3);
        expect(segments("at")).toBeGreaterThan(3);
    });

    test("a host draws a field's control itself: the field keeps its label, and no input or Set is drawn", () => {
        const { field } = mountDraft({ ...JOB }, {
            renderControl: (spec) => (spec.path[0] === "steps" ? <span data-testid="own">2 steps · Edit in sheet</span> : undefined),
        });
        const steps = field("steps");
        expect(steps.getAttribute("data-editor")).toBe("custom");
        expect(within(steps).getByTestId("own").textContent).toBe("2 steps · Edit in sheet");
        expect(steps.querySelector("label")!.textContent).toBe("Steps");
        expect(steps.querySelector("input, [data-checklist-items], [data-field-set], [data-field-clear]")).toBeNull();
        // Every other field is the form's own.
        expect(field("task").getAttribute("data-editor")).toBe("text");
    });

    test("Enter on a missing checklist's Set gives it its start: the Enter that adds an item is its box's alone (#1220)", async () => {
        const { field, edits } = mountDraft({ task: "Hang doors", bench: none, note: none, batch: none });
        const user = userEvent.setup();
        const set = within(field("steps")).getByRole("button", { name: "Set" });
        act(() => { set.focus(); });
        await user.keyboard("{Enter}");
        await settle();
        expectEdit(edits, "steps", equalFor(ArrayType(Step)), []);
    });
});

describe("FieldForm — one column: each field's control on its line, an Option's Set or Clear at the line's end (#1220)", () => {
    test("every field's control sits on its line, right after its label; a Set or a Clear is the line's own, after the control", async () => {
        const { container, field } = mount();
        for (const el of container.querySelectorAll<HTMLElement>("[data-field]")) {
            const line = el.querySelector(":scope > [data-scope=field][data-part=root] > [data-field-line]");
            expect(line, el.getAttribute("data-field")!).not.toBeNull();
            expect(line!.previousElementSibling!.getAttribute("data-part")).toBe("label");
        }
        // Each input on its line: a text's box, a number, a date's segments, a select, tags, a checkbox.
        const lineOf = (key: string) => field(key).querySelector<HTMLElement>("[data-field-line]")!;
        expect(within(lineOf("task")).getByRole("textbox")).toBeTruthy();
        expect(lineOf("crew").querySelector("[data-scope=number-input]")).not.toBeNull();
        expect(within(lineOf("due")).getAllByRole("spinbutton").length).toBeGreaterThan(0);
        expect(lineOf("status").querySelector("[data-scope=select][data-part=trigger]")).not.toBeNull();
        expect(lineOf("finishes").querySelector("[data-scope=tags-input]")).not.toBeNull();
        expect(lineOf("rush").querySelector("[data-scope=checkbox]")).not.toBeNull();
        // An empty Option's Set, then the Clear of the value it gives, at the end of its line.
        const side = (key: string) => lineOf(key).querySelector<HTMLElement>(":scope > [data-field-side]");
        expect(side("batch")!.getAttribute("data-field-side")).toBe("set");
        expect(side("batch")!.previousElementSibling!.contains(within(lineOf("batch")).getByRole("textbox"))).toBe(true);
        await act(async () => { fireEvent.click(within(side("batch")!).getByRole("button", { name: "Set" })); });
        await settle();
        expect(side("batch")!.getAttribute("data-field-side")).toBe("clear");
        expect(within(side("batch")!).getByRole("button", { name: "Clear Batch" })).toBeTruthy();
        expect(side("batch")!.previousElementSibling!.querySelector("[data-scope=number-input]")).not.toBeNull();
        // A text, a select and a reference clear themselves, and a required field holding its value has neither.
        for (const key of ["task", "note", "status", "bench", "crew"]) expect(side(key)).toBeNull();
        // A nested struct's fields sit together under its head.
        const site = screen.getByRole("group", { name: "Site" });
        expect(site.children[0]!.textContent).toBe("Site");
        expect([...site.children[1]!.querySelectorAll("[data-field]")].map((f) => f.getAttribute("data-field"))).toEqual(["site.room", "site.floor"]);
    });
});

describe("FieldForm — a text or a choice longer than its box (#1250)", () => {
    /** The title of a field's control: the whole text its box holds, where the box may cut it short. */
    const titleOf = (field: (key: string) => HTMLElement, key: string) => field(key).querySelector("[data-field-line] > :first-child")!.getAttribute("title");

    test("a text's control carries its whole text as its title, and a choice's its chosen words, each following each edit; an empty text, a number and tags none", async () => {
        const { field } = mount();
        expect(titleOf(field, "task")).toBe("Hang doors");
        expect(titleOf(field, "site.room")).toBe("Workshop");
        expect(titleOf(field, "status")).toBe("Planned");
        expect(titleOf(field, "bench")).toBe("Bench 2");
        for (const key of ["note", "crew", "finishes"]) expect(titleOf(field, key), key).toBeNull();
        const user = userEvent.setup();
        const input = within(field("task")).getByRole("textbox");
        await user.clear(input);
        await user.type(input, "Hang the doors, then fit their frames and hinges{Enter}");
        await settle();
        expect(titleOf(field, "task")).toBe("Hang the doors, then fit their frames and hinges");
        // Another choice made: its words; an Option's choice taken away — Unassigned — none.
        await open(field("status"));
        await choose("Underway");
        expect(titleOf(field, "status")).toBe("Underway");
        await open(field("bench"));
        await choose("Unassigned");
        expect(titleOf(field, "bench")).toBeNull();
    });

    test("a value printed carries its words as its title, read only and in a read-only field alike; the host's own control none", () => {
        const { field } = mount({ readOnly: true });
        const words = formatters(LOCALE);
        expect(["task", "crew", "due", "status", "bench", "stock"].map((key) => titleOf(field, key)))
            .toEqual(["Hang doors", "4", words.dateTime(JOB.due), "Planned", "Bench 2", printFor(DictType(StringType, IntegerType))(JOB.stock)]);
        cleanup();
        const own = render(
            <ChakraProvider value={system}><I18nProvider locale={LOCALE}>
                <FieldForm specs={SPECS} value={JOB} options={BENCHES} onChange={() => {}}
                    renderControl={(spec) => (spec.path[0] === "steps" ? <span>2 steps</span> : undefined)} />
            </I18nProvider></ChakraProvider>,
        );
        const ownField = (key: string) => own.container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
        expect(titleOf(ownField, "steps")).toBeNull();
        expect(titleOf(ownField, "stock")).toBe(printFor(DictType(StringType, IntegerType))(JOB.stock));
    });
});

describe("FieldForm — a choice of up to four cases is a radio group, past four a select (#1473)", () => {
    const Severity = VariantType({ low: NullType, high: NullType });
    const Alert = StructType({ changes: StringType, severity: Severity, priority: OptionType(Severity), status: Status });
    const ALERT_SPECS = Fields.specs(Alert, { severity: Fields.select({ labels: { low: "Low", high: "High" } }), priority: Fields.select({ labels: { low: "Low", high: "High" } }) });

    function mountAlert(value: Record<string, unknown>, readOnly = false) {
        const edits: Edit[] = [];
        function Host() {
            const [current, setValue] = useState<Record<string, unknown>>(value);
            return (
                <FieldForm specs={ALERT_SPECS} value={current} readOnly={readOnly}
                    onChange={(path, next) => { edits.push({ path: path.join("."), value: next }); setValue((v) => setAt(v, path, next)); }} />
            );
        }
        const utils = render(<ChakraProvider value={system}><I18nProvider locale={LOCALE}><Host /></I18nProvider></ChakraProvider>);
        const field = (key: string) => utils.container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
        return { ...utils, edits, field };
    }
    const radios = (el: HTMLElement) => within(el).getAllByRole("radio") as HTMLInputElement[];
    const labelsOf = (el: HTMLElement) => [...el.querySelectorAll("[data-scope=radio-group][data-part=item-text]")].map((t) => t.textContent);

    test("two cases are radios in the variant's labelled order, the held case checked; five are still a select", () => {
        const { field } = mountAlert({ changes: "Bore over", severity: variant("high", null), priority: none, status: variant("planned", null) });
        expect(field("severity").querySelector("[data-field-choice=radio]")).not.toBeNull();
        expect(field("severity").getAttribute("data-editor")).toBe("select");
        expect(labelsOf(field("severity"))).toEqual(["Low", "High"]);
        expect(radios(field("severity")).map((r) => r.checked)).toEqual([false, true]);
        expect(field("severity").querySelector("[data-scope=select]")).toBeNull();
        // Past four cases, the select.
        expect(field("status").querySelector("[data-field-choice=radio]")).toBeNull();
        expect(field("status").querySelector("[data-scope=select][data-part=trigger]")).not.toBeNull();
    });

    test("a radio picked is one edit at once, typed as the variant; an Option's Not set comes first and empties it", async () => {
        const { field, edits } = mountAlert({ changes: "", severity: variant("low", null), priority: some(variant("low", null)), status: variant("planned", null) });
        await act(async () => { fireEvent.click(radios(field("severity"))[1]!); });
        await settle();
        expectEdit(edits, "severity", equalFor(Severity), variant("high", null));

        edits.length = 0;
        expect(labelsOf(field("priority"))).toEqual(["Not set", "Low", "High"]);
        await act(async () => { fireEvent.click(radios(field("priority"))[0]!); });
        await settle();
        expectEdit(edits, "priority", equalFor(OptionType(Severity)), none);
        // A radio group clears itself: no Set or Clear beside it.
        expect(within(field("priority")).queryByRole("button", { name: /^(Set|Clear)/ })).toBeNull();
    });

    test("a required choice with no value yet checks no radio; read only, the choice is printed", () => {
        const { field } = mountAlert({ changes: "", status: variant("done", null) });
        expect(radios(field("severity")).map((r) => r.checked)).toEqual([false, false]);
        cleanup();
        const { field: printed } = mountAlert({ changes: "", severity: variant("high", null), priority: none, status: variant("done", null) }, true);
        expect((within(printed("severity")).getByRole("textbox") as HTMLInputElement).value).toBe("High");
        expect(printed("severity").querySelector("[data-scope=radio-group]")).toBeNull();
    });
});

describe("FieldForm — a field a host draws on one line, an issue's wash, and the field named to take the keyboard (#1534)", () => {
    // A crew shift: its kind a key of the host's cycle, a Boolean, and an Option of one.
    const Shift = StructType({ name: StringType, kind: StringType, active: BooleanType, lead: OptionType(BooleanType), note: StringType });
    const SHIFT_SPECS = Fields.specs(Shift);
    const YES_NO: readonly FieldLineChoice[] = [{ value: true, label: "Yes" }, { value: false, label: "No" }];
    const LINES: ReadonlyMap<string, readonly FieldLineChoice[]> = new Map([
        ["kind", [{ value: "day", label: "Day" }, { value: "night", label: "Night" }]],
        ["active", YES_NO],
        ["lead", YES_NO],
    ]);

    function mountShift(value: Record<string, unknown>, extra: { readOnly?: boolean; issues?: ReadonlySet<string>; hidden?: boolean; specs?: readonly FieldSpecValue[] } = {}) {
        const edits: Edit[] = [];
        let named: (key: string | undefined) => void = () => {};
        function Host() {
            const [current, setValue] = useState<Record<string, unknown>>(value);
            const [focus, setFocus] = useState<string | undefined>(undefined);
            named = setFocus;
            // A panel around the form, hidden as a tab's is until it is shown.
            return (
                <div data-panel="" hidden={extra.hidden}>
                    <FieldForm specs={extra.specs ?? SHIFT_SPECS} value={current} readOnly={extra.readOnly} lines={LINES} issues={extra.issues} focus={focus}
                        onChange={(path, next) => { edits.push({ path: path.join("."), value: next }); setValue((v) => setAt(v, path, next)); }} />
                </div>
            );
        }
        const utils = render(<ChakraProvider value={system}><I18nProvider locale={LOCALE}><Host /></I18nProvider></ChakraProvider>);
        const field = (key: string) => utils.container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
        return { ...utils, edits, field, focus: (key: string | undefined) => act(() => { named(key); }) };
    }
    const radios = (el: HTMLElement) => within(el).getAllByRole("radio") as HTMLInputElement[];
    const labelsOf = (el: HTMLElement) => [...el.querySelectorAll("[data-scope=radio-group][data-part=item-text]")].map((t) => t.textContent);

    test("a named field is one line — its label, whole in its title, then its choices as one line of radios — and the lines in a run sit together", () => {
        const { container, field } = mountShift({ name: "Early", kind: "night", active: true, lead: none, note: "" });
        expect(field("kind").getAttribute("data-layout")).toBe("line");
        expect(field("kind").getAttribute("title")).toBe("Kind");
        expect(field("kind").firstElementChild!.textContent).toBe("Kind");
        // No shared Field around it: the line is the field.
        expect(field("kind").querySelector("[data-scope=field]")).toBeNull();
        expect(within(field("kind")).getByRole("radiogroup", { name: "Kind" })).toBeTruthy();
        expect(labelsOf(field("kind"))).toEqual(["Day", "Night"]);
        expect(radios(field("kind")).map((r) => r.checked)).toEqual([false, true]);
        expect(radios(field("active")).map((r) => r.checked)).toEqual([true, false]);
        // The three lines are one run, between the name and the note, each still a field of its own.
        const runs = [...container.querySelectorAll<HTMLElement>("[data-field-lines]")];
        expect(runs.map((run) => [...run.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")))).toEqual([["kind", "active", "lead"]]);
        expect([...container.querySelectorAll("[data-field]")].map((el) => `${el.getAttribute("data-field")}:${el.getAttribute("data-layout") ?? "column"}`))
            .toEqual(["name:column", "kind:line", "active:line", "lead:line", "note:column"]);
    });

    test("a choice picked is one edit at once, typed as the field — a key, a Boolean, an Option's some — none checked while it holds no value; an Option's Clear empties it", async () => {
        const { field, edits } = mountShift({ name: "Early", active: true, lead: none, note: "" });
        expect(radios(field("kind")).map((r) => r.checked)).toEqual([false, false]);
        await act(async () => { fireEvent.click(radios(field("kind"))[0]!); });
        await settle();
        expectEdit(edits, "kind", equalFor(StringType), "day");
        expect(radios(field("kind")).map((r) => r.checked)).toEqual([true, false]);
        // A required field holding its value has no Clear.
        expect(within(field("kind")).queryByRole("button", { name: /^Clear/ })).toBeNull();

        edits.length = 0;
        await act(async () => { fireEvent.click(radios(field("active"))[1]!); });
        await settle();
        expectEdit(edits, "active", equalFor(BooleanType), false);

        edits.length = 0;
        expect(radios(field("lead")).map((r) => r.checked)).toEqual([false, false]);
        expect(within(field("lead")).queryByRole("button", { name: /^Clear/ })).toBeNull();
        await act(async () => { fireEvent.click(radios(field("lead"))[0]!); });
        await settle();
        expectEdit(edits, "lead", equalFor(OptionType(BooleanType)), some(true));
        edits.length = 0;
        await act(async () => { fireEvent.click(within(field("lead")).getByRole("button", { name: "Clear Lead" })); });
        await settle();
        expectEdit(edits, "lead", equalFor(OptionType(BooleanType)), none);
        expect(radios(field("lead")).map((r) => r.checked)).toEqual([false, false]);
    });

    test("read only, the choice made is printed where the radios would be, and Not set where it holds none", () => {
        const { container, field } = mountShift({ name: "Early", kind: "night", active: true, lead: none, note: "" }, { readOnly: true });
        expect(["kind", "active", "lead"].map((key) => field(key).querySelector("[data-field-value]")!.textContent)).toEqual(["Night", "Yes", "Not set"]);
        expect(field("kind").getAttribute("data-editor")).toBe("readonly");
        expect(container.querySelector("[data-scope=radio-group], [data-field-clear]")).toBeNull();
    });

    test("a line's help sits under it, after its choices and its Clear, the line still one field — read only too; a line with none has none (#1561)", () => {
        const helped = SHIFT_SPECS.map((spec): FieldSpecValue => (spec.path[0] === "kind" ? { ...spec, help: some("set by the rota") }
            : spec.path[0] === "lead" ? { ...spec, help: some("locked: a lead's own") } : spec));
        const { field } = mountShift({ name: "Early", kind: "night", active: true, lead: some(true), note: "" }, { specs: helped });
        const helpOf = (key: string) => field(key).querySelector<HTMLElement>(":scope > [data-field-help]");
        expect(helpOf("kind")!.textContent).toBe("set by the rota");
        expect(helpOf("kind")!.previousElementSibling!.getAttribute("data-field-choice")).toBe("radio");
        expect(helpOf("lead")!.textContent).toBe("locked: a lead's own");
        expect(helpOf("lead")!.previousElementSibling!.getAttribute("data-field-side")).toBe("clear");
        expect(field("kind").getAttribute("data-layout")).toBe("line");
        expect(radios(field("kind")).map((r) => r.checked)).toEqual([false, true]);
        expect(helpOf("active")).toBeNull();
        cleanup();
        const { field: printed } = mountShift({ name: "Early", kind: "night", active: true, lead: some(true), note: "" }, { specs: helped, readOnly: true });
        const printedHelp = printed("kind").querySelector<HTMLElement>(":scope > [data-field-help]");
        expect(printedHelp!.textContent).toBe("set by the rota");
        expect(printedHelp!.previousElementSibling!.hasAttribute("data-field-value")).toBe(true);
    });

    test("a field an issue names takes the warn wash; the field a host names takes the keyboard as it is named", async () => {
        const { container, field, focus } = mountShift({ name: "", kind: "day", active: true, lead: none, note: "" }, { issues: new Set(["name", "lead"]) });
        expect([...container.querySelectorAll("[data-field][data-issue]")].map((el) => el.getAttribute("data-field"))).toEqual(["name", "lead"]);
        expect(field("name").contains(document.activeElement)).toBe(false);
        await focus("name");
        expect(document.activeElement).toBe(within(field("name")).getByRole("textbox"));
        await focus("kind");
        expect(field("kind").contains(document.activeElement)).toBe(true);
        expect((document.activeElement as HTMLInputElement).type).toBe("radio");
    });

    test("a field named while the form is hidden takes the keyboard once it shows, a later name in its place", async () => {
        // The browser gives the keyboard to nothing hidden; jsdom lays nothing out, so here a hidden ancestor is what hides.
        const prototype = HTMLElement.prototype as { checkVisibility?: (this: HTMLElement) => boolean };
        const was = prototype.checkVisibility;
        prototype.checkVisibility = function (this: HTMLElement) { return this.closest("[hidden]") === null; };
        try {
            const { container, field, focus } = mountShift({ name: "Early", kind: "day", active: true, lead: none, note: "" }, { hidden: true });
            await focus("note");
            await focus("name");
            expect(container.querySelector("[data-field-form]")!.contains(document.activeElement)).toBe(false);
            // The panel shown: the name, never the note named before it.
            await act(async () => { container.querySelector("[data-panel]")!.removeAttribute("hidden"); });
            await settle();
            expect(document.activeElement).toBe(within(field("name")).getByRole("textbox"));
        } finally {
            if (was === undefined) delete prototype.checkVisibility;
            else prototype.checkVisibility = was;
        }
    });

    test("two runs of one group apart — Other before another group and after it — are two sections, each holding its own fields", () => {
        const grouped = SHIFT_SPECS.map((spec): FieldSpecValue => ({ ...spec, group: some(spec.path[0] === "name" || spec.path[0] === "note" ? "Other" : "Rota") }));
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { container } = mountShift({ name: "Early", kind: "day", active: true, lead: none, note: "" }, { specs: grouped });
            const sections = [...container.querySelectorAll<HTMLElement>("[data-field-group]")];
            expect(sections.map((section) => section.getAttribute("data-field-group"))).toEqual(["Other", "Rota", "Other"]);
            expect(sections.map((section) => [...section.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field"))))
                .toEqual([["name"], ["kind", "active", "lead"], ["note"]]);
            // Each section a child of its own: React is told no key twice.
            expect(errors.mock.calls.filter((call) => /same key/.test(String(call[0])))).toEqual([]);
        } finally {
            errors.mockRestore();
        }
    });
});

describe("FieldForm — a variant whose cases hold data, a block under its choice; a reference to a key of any type (#1549)", () => {
    // A joinery piece's finish: bare, a stain of a shade, or a paint — its colour, its coats, and its gloss, matt or a
    // sheen of a level. Its bench and its spare are keyed by number, and its slot by when it starts.
    const Gloss = VariantType({ matt: NullType, sheen: FloatType });
    const Paint = StructType({ colour: StringType, coats: IntegerType, gloss: Gloss });
    const Finish = VariantType({ bare: NullType, stain: StringType, paint: Paint });
    const Piece = StructType({ name: StringType, finish: Finish, bench: IntegerType, spare: OptionType(IntegerType), slot: DateTimeType });
    type PieceValue = ValueTypeOf<typeof Piece>;
    const PIECE_SPECS = Fields.specs(Piece, {
        finish: Fields.select({
            labels: { bare: "Bare", stain: "Stain", paint: "Paint" },
            cases: { stain: Fields.text({ label: "Shade" }), paint: { coats: Fields.number({ min: 2n, max: 4n }) } },
        }),
        bench: Fields.reference({ of: "benches" }),
        spare: Fields.reference({ of: "benches", label: "Spare bench" }),
        slot: Fields.reference({ of: "slots" }),
    });
    const MORNING = new Date(Date.UTC(2026, 10, 9, 8, 0));
    const AFTERNOON = new Date(Date.UTC(2026, 10, 9, 13, 0));
    // The host lists each key by its text: an Integer's, and a DateTime's, as East prints them.
    const OPTIONS = {
        benches: [{ key: "2", label: "Bench 2" }, { key: "9", label: "Bench 9" }, { key: "10", label: "Bench 10" }],
        slots: [{ key: printFor(DateTimeType)(MORNING), label: "Morning" }, { key: printFor(DateTimeType)(AFTERNOON), label: "Afternoon" }],
    };
    const STAINED: PieceValue = { name: "Door", finish: variant("stain", "Walnut"), bench: 9n, spare: none, slot: MORNING };
    const PAINTED: PieceValue = { ...STAINED, finish: variant("paint", { colour: "Teal", coats: 2n, gloss: variant("matt", null) }) };

    function mountPiece(value: PieceValue, extra: { readOnly?: boolean; baseline?: PieceValue } = {}) {
        const edits: Edit[] = [];
        function Host() {
            const [current, setValue] = useState<PieceValue>(value);
            return (
                <FieldForm specs={PIECE_SPECS} value={current} baseline={extra.baseline} options={OPTIONS} readOnly={extra.readOnly}
                    onChange={(path, next) => { edits.push({ path: path.join("."), value: next }); setValue((v) => setAt(v, path, next)); }} />
            );
        }
        const utils = render(<ChakraProvider value={system}><I18nProvider locale={LOCALE}><Host /></I18nProvider></ChakraProvider>);
        const field = (key: string) => utils.container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
        const block = (key: string) => utils.container.querySelector<HTMLElement>(`[data-field-block="${key}"]`);
        return { ...utils, edits, field, block };
    }
    const radios = (el: HTMLElement) => within(el).getAllByRole("radio") as HTMLInputElement[];
    const labelsOf = (el: HTMLElement) => [...el.querySelectorAll("[data-scope=radio-group][data-part=item-text]")].map((t) => t.textContent);
    const keysIn = (el: Element) => [...el.querySelectorAll("[data-field]")].map((f) => f.getAttribute("data-field"));

    test("the case held has its fields in a block right under its choice; another chosen starts its value, each field at its start, and the block follows; an empty case is the choice alone", async () => {
        const { container, edits, field, block } = mountPiece(STAINED);
        expect(labelsOf(field("finish"))).toEqual(["Bare", "Stain", "Paint"]);
        expect(radios(field("finish")).map((r) => r.checked)).toEqual([false, true, false]);
        expect(field("finish").nextElementSibling).toBe(block("finish"));
        expect(keysIn(block("finish")!)).toEqual(["finish.stain"]);
        expect(field("finish.stain").querySelector("label")!.textContent).toBe("Shade");
        expect((within(field("finish.stain")).getByRole("textbox") as HTMLInputElement).value).toBe("Walnut");
        expect(keysIn(container)).toEqual(["finish", "finish.stain", "bench", "spare", "slot", "name"]);

        // A paint: its coats at their least, its colour empty, its gloss East's first case — matt, empty, no block.
        await act(async () => { fireEvent.click(radios(field("finish"))[2]!); });
        await settle();
        expectEdit(edits, "finish", equalFor(Finish), variant("paint", { colour: "", coats: 2n, gloss: variant("matt", null) }));
        expect(keysIn(block("finish")!)).toEqual(["finish.paint.coats", "finish.paint.colour", "finish.paint.gloss"]);
        expect(labelsOf(field("finish.paint.gloss"))).toEqual(["Matt", "Sheen"]);
        expect(block("finish.paint.gloss")).toBeNull();

        // A sheen: a block of its own inside the paint's.
        edits.length = 0;
        await act(async () => { fireEvent.click(radios(field("finish.paint.gloss"))[1]!); });
        await settle();
        expectEdit(edits, "finish.paint.gloss", equalFor(Gloss), variant("sheen", 0));
        expect(block("finish")!.contains(block("finish.paint.gloss"))).toBe(true);
        expect(keysIn(block("finish.paint.gloss")!)).toEqual(["finish.paint.gloss.sheen"]);

        edits.length = 0;
        await act(async () => { fireEvent.click(radios(field("finish"))[0]!); });
        await settle();
        expectEdit(edits, "finish", equalFor(Finish), variant("bare", null));
        expect(container.querySelector("[data-field-block]")).toBeNull();
        expect(keysIn(container)).toEqual(["finish", "bench", "spare", "slot", "name"]);
    });

    test("an edit inside the block reaches onChange along a path through the case, typed as the field and held to its bounds", async () => {
        const { edits, field } = mountPiece(PAINTED);
        const user = userEvent.setup();
        const colour = within(field("finish.paint.colour")).getByRole("textbox");
        await user.clear(colour);
        await user.type(colour, "Sage{Enter}");
        await settle();
        expectEdit(edits, "finish.paint.colour", equalFor(StringType), "Sage");
        expect((within(field("finish.paint.colour")).getByRole("textbox") as HTMLInputElement).value).toBe("Sage");

        edits.length = 0;
        const coats = within(field("finish.paint.coats")).getByRole("spinbutton");
        await user.clear(coats);
        await user.type(coats, "9");
        await leave(coats);
        expectEdit(edits, "finish.paint.coats", equalFor(IntegerType), 4n);
    });

    test("against the baseline, the choice is tinted where its case differs, and a block's field where it does", async () => {
        const { container, field } = mountPiece({ ...PAINTED, finish: variant("paint", { colour: "Sage", coats: 2n, gloss: variant("matt", null) }) }, { baseline: PAINTED });
        const tinted = () => [...container.querySelectorAll("[data-field][data-dirty]")].map((el) => el.getAttribute("data-field"));
        expect(tinted()).toEqual(["finish.paint.colour"]);
        await act(async () => { fireEvent.click(radios(field("finish"))[1]!); });
        await settle();
        expect(tinted()).toEqual(["finish", "finish.stain"]);
    });

    test("read only, the choice prints its case's words and the block its fields", () => {
        const { container, field } = mountPiece({ ...PAINTED, finish: variant("paint", { colour: "Teal", coats: 3n, gloss: variant("sheen", 0.4) }) }, { readOnly: true });
        const printed = (key: string) => (within(field(key)).getByRole("textbox") as HTMLInputElement).value;
        expect(["finish", "finish.paint.colour", "finish.paint.coats", "finish.paint.gloss", "finish.paint.gloss.sheen"].map(printed))
            .toEqual(["Paint", "Teal", "3", "Sheen", formatters(LOCALE).number(0.4)]);
        expect(container.querySelector("[data-scope=radio-group]")).toBeNull();
    });

    test("a reference to a key of any type: the key held chosen by its text, and a choice read back at the field's type — an Integer, an Option of one, a DateTime", async () => {
        const { edits, field } = mountPiece(STAINED);
        expect(chosenOf(field, "bench")).toBe("Bench 9");
        expect(await open(field("bench"))).toEqual(["Bench 2", "Bench 9", "Bench 10"]);
        await choose("Bench 10");
        expectEdit(edits, "bench", equalFor(IntegerType), 10n);

        edits.length = 0;
        expect(await open(field("spare"))).toEqual(["Unassigned", "Bench 2", "Bench 9", "Bench 10"]);
        await choose("Bench 2");
        expectEdit(edits, "spare", equalFor(OptionType(IntegerType)), some(2n));

        edits.length = 0;
        expect(chosenOf(field, "slot")).toBe("Morning");
        await open(field("slot"));
        await choose("Afternoon");
        expectEdit(edits, "slot", equalFor(DateTimeType), AFTERNOON);
        cleanup();
        const { field: printed } = mountPiece(STAINED, { readOnly: true });
        expect(["bench", "spare", "slot"].map((key) => (within(printed(key)).getByRole("textbox") as HTMLInputElement).value)).toEqual(["Bench 9", "—", "Morning"]);
    });
});

describe("FieldForm — a reference's choices in their keys' order, and a choice its field can't hold said so (#1584)", () => {
    // A piece's bench and its spare keyed by number, the host listing the benches out of order and one by no number; its
    // crew keyed by String.
    const Placed = StructType({ bench: IntegerType, spare: OptionType(IntegerType), crew: StringType });
    const PLACED_SPECS = Fields.specs(Placed, {
        bench: Fields.reference({ of: "benches" }),
        spare: Fields.reference({ of: "benches", label: "Spare bench" }),
        crew: Fields.reference({ of: "crews" }),
    });
    const OPTIONS = {
        benches: [{ key: "10", label: "Bench 10" }, { key: "B-1", label: "Back bench" }, { key: "2", label: "Bench 2" }, { key: "9", label: "Bench 9" }],
        crews: [{ key: "north", label: "North" }, { key: "east", label: "East" }],
    };

    function mountPlaced() {
        const edits: Edit[] = [];
        function Host() {
            const [current, setValue] = useState<Record<string, unknown>>({ bench: 9n, spare: none, crew: "north" });
            return (
                <FieldForm specs={PLACED_SPECS} value={current} options={OPTIONS}
                    onChange={(path, next) => { edits.push({ path: path.join("."), value: next }); setValue((v) => setAt(v, path, next)); }} />
            );
        }
        const utils = render(<ChakraProvider value={system}><I18nProvider locale={LOCALE}><Host /></I18nProvider></ChakraProvider>);
        const field = (key: string) => utils.container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
        return { ...utils, edits, field };
    }
    /** What a field says under it of a choice that changed nothing. */
    const refusalOf = (el: HTMLElement) => el.querySelector("[data-scope=field][data-part=error-text]")?.textContent;

    test("an Integer field's choices in number order, never their text's — one keyed by no number after them; a String field's as the host gives them", async () => {
        const { field, edits } = mountPlaced();
        expect(await open(field("bench"))).toEqual(["Bench 2", "Bench 9", "Bench 10", "Back bench"]);
        await choose("Bench 9");
        expect(await open(field("spare"))).toEqual(["Unassigned", "Bench 2", "Bench 9", "Bench 10", "Back bench"]);
        await choose("Unassigned");
        expect(await open(field("crew"))).toEqual(["North", "East"]);
        await choose("North");
        // Each the choice the field held: no edit.
        expect(edits).toEqual([]);
    });

    test("a choice whose key the field can't hold is no edit, and the field says why under it, the key it holds still chosen — until a choice it holds is made", async () => {
        const { field, edits } = mountPlaced();
        expect(refusalOf(field("bench"))).toBeUndefined();
        await open(field("bench"));
        await choose("Back bench");
        expect(edits).toEqual([]);
        expect(refusalOf(field("bench"))).toBe("Can't choose Back bench — Bench holds whole numbers");
        expect(field("bench").querySelector("[data-scope=field][data-part=root]")!.hasAttribute("data-invalid")).toBe(true);
        expect(chosenOf(field, "bench")).toBe("Bench 9");
        expect(field("bench").contains(document.activeElement)).toBe(true);
        await open(field("bench"));
        await choose("Bench 10");
        expectEdit(edits, "bench", equalFor(IntegerType), 10n);
        expect(refusalOf(field("bench"))).toBeUndefined();
    });
});

describe("FieldForm — an edit the host refuses: the field shows what it holds again, and says why under it (#1585)", () => {
    // The host holds the job's due time to the morning, its crew to six, its status short of cancelled and its task to
    // some text, refusing past them in its own words; every other edit it takes.
    const NOON = new Date(Date.UTC(2026, 9, 6, 12, 0));
    const MORNING = "Due by noon: the workshop closes for the afternoon";
    const SIX = "Six at most fit the workshop";
    const SCHEDULE = "A planned job is cancelled from the schedule";
    const TASK = "A job needs its task";
    const compareDates = compareFor(DateTimeType);
    const compareIntegers = compareFor(IntegerType);
    const statusEqual = equalFor(Status);

    function mountRefusing(extra: { live?: boolean } = {}) {
        const edits: Edit[] = [];
        function Host() {
            const [value, setValue] = useState<JobValue>(JOB);
            return (
                <FieldForm specs={SPECS} value={value} options={BENCHES} live={extra.live}
                    onChange={(path, next) => {
                        edits.push({ path: path.join("."), value: next });
                        const [name] = path;
                        if (name === "due" && compareDates(next as Date, NOON) >= 0) return MORNING;
                        if (name === "crew" && compareIntegers(next as bigint, 6n) > 0) return SIX;
                        if (name === "status" && statusEqual(next as never, variant("cancelled", null) as never)) return SCHEDULE;
                        if (name === "task" && equalFor(StringType)(next as string, "")) return TASK;
                        setValue((v) => setAt(v, path, next));
                        return undefined;
                    }} />
            );
        }
        const utils = render(<ChakraProvider value={system}><I18nProvider locale={LOCALE}><Host /></I18nProvider></ChakraProvider>);
        const field = (key: string) => utils.container.querySelector<HTMLElement>(`[data-field="${key}"]`)!;
        return { ...utils, edits, field };
    }
    /** What a field says under it of an edit it shows what it holds in place of. */
    const refusalOf = (el: HTMLElement) => el.querySelector("[data-scope=field][data-part=error-text]")?.textContent;
    /** A date's segment, by the part it names. */
    const segment = (el: HTMLElement, name: string) => within(el).getAllByRole("spinbutton").find((s) => s.getAttribute("aria-label")?.startsWith(name))!;

    test("a time it refuses as the keyboard moves on to another field: the box shows the time the field holds, and the field says why — until an edit it takes — the keyboard left where it went", async () => {
        const { field, edits } = mountRefusing();
        const user = userEvent.setup();
        const length = () => within(field("length")).getByRole("spinbutton");
        // 9 AM on to 9 PM, past noon, and on to the length.
        act(() => { segment(field("due"), "AM/PM").focus(); });
        await act(async () => { fireEvent.keyDown(segment(field("due"), "AM/PM"), { key: "ArrowUp" }); });
        await settle();
        expect(segment(field("due"), "AM/PM").textContent).toBe("PM");
        await user.click(length());
        await settle();
        expect(edits.map((e) => e.path)).toEqual(["due"]);
        expect([segment(field("due"), "hour").textContent, segment(field("due"), "AM/PM").textContent]).toEqual(["9", "AM"]);
        expect(refusalOf(field("due"))).toBe(MORNING);
        expect(field("due").querySelector("[data-scope=field][data-part=root]")!.hasAttribute("data-invalid")).toBe(true);
        expect(document.activeElement).toBe(length());
        // 9 AM on to 10 AM: taken, and the words go.
        act(() => { segment(field("due"), "hour").focus(); });
        await act(async () => { fireEvent.keyDown(segment(field("due"), "hour"), { key: "ArrowUp" }); });
        await settle();
        await user.click(length());
        await settle();
        expect(edits.map((e) => e.path)).toEqual(["due", "due"]);
        expect(compareDates(edits[1]!.value as Date, new Date(Date.UTC(2026, 9, 6, 10, 0)))).toBe(0);
        expect(segment(field("due"), "hour").textContent).toBe("10");
        expect(refusalOf(field("due"))).toBeUndefined();
    });

    test("a number it refuses, Entered: the box shows the number the field holds, the keyboard still in it, and the field says why", async () => {
        const { field, edits } = mountRefusing();
        const user = userEvent.setup();
        const crew = within(field("crew")).getByRole("spinbutton");
        await user.clear(crew);
        await user.type(crew, "9");
        await user.keyboard("{Enter}");
        await settle();
        expectEdit(edits, "crew", equalFor(IntegerType), 9n);
        expect((within(field("crew")).getByRole("spinbutton") as HTMLInputElement).value).toBe("4");
        expect(refusalOf(field("crew"))).toBe(SIX);
        expect(field("crew").querySelector("[data-scope=field][data-part=root]")!.hasAttribute("data-invalid")).toBe(true);
        expect(document.activeElement).toBe(within(field("crew")).getByRole("spinbutton"));
    });

    test("a choice it refuses — a case, a line's — shows the choice the field holds, and the field says why under it", async () => {
        const { field, edits } = mountRefusing();
        await open(field("status"));
        await choose("Cancelled");
        expectEdit(edits, "status", statusEqual, variant("cancelled", null));
        expect(chosenOf(field, "status")).toBe("Planned");
        expect(refusalOf(field("status"))).toBe(SCHEDULE);
        expect(field("status").contains(document.activeElement)).toBe(true);
        cleanup();
        // Drawn on one line: its radios as the field holds them, and the words under the line.
        const Shift = StructType({ name: StringType, night: BooleanType });
        const lines: ReadonlyMap<string, readonly FieldLineChoice[]> = new Map([["night", [{ value: true, label: "Night" }, { value: false, label: "Day" }]]]);
        const nights: Edit[] = [];
        const { container } = render(
            <ChakraProvider value={system}><I18nProvider locale={LOCALE}>
                <FieldForm specs={Fields.specs(Shift)} value={{ name: "Early", night: false }} lines={lines}
                    onChange={(path, next) => { nights.push({ path: path.join("."), value: next }); return "Nights need a lead"; }} />
            </I18nProvider></ChakraProvider>,
        );
        const night = container.querySelector<HTMLElement>('[data-field="night"]')!;
        await act(async () => { fireEvent.click(within(night).getAllByRole("radio")[0]!); });
        await settle();
        expectEdit(nights, "night", equalFor(BooleanType), true);
        expect((within(night).getAllByRole("radio") as HTMLInputElement[]).map((r) => r.checked)).toEqual([false, true]);
        expect(night.querySelector("[data-field-error]")!.textContent).toBe("Nights need a lead");
    });

    test("typed into a live form, its words come at once, and the box shows what the field holds once the keyboard leaves it, never under the keys", async () => {
        const { field, edits } = mountRefusing({ live: true });
        const user = userEvent.setup();
        await user.clear(within(field("task")).getByRole("textbox"));
        await settle();
        expectEdit(edits, "task", equalFor(StringType), "");
        expect(refusalOf(field("task"))).toBe(TASK);
        expect((within(field("task")).getByRole("textbox") as HTMLInputElement).value).toBe("");
        await leave(within(field("task")).getByRole("textbox"));
        expect((within(field("task")).getByRole("textbox") as HTMLInputElement).value).toBe("Hang doors");
        expect(refusalOf(field("task"))).toBe(TASK);
    });

    test("a control the host draws hands the field its edit: one the host refuses is said under the field, the control drawn afresh with the keyboard on it", async () => {
        const BOOKED = "Bench 1 is booked all week";
        const benchEqual = equalFor(OptionType(StringType));
        const edits: Edit[] = [];
        function Host() {
            const [value, setValue] = useState<JobValue>(JOB);
            return (
                <FieldForm specs={SPECS} value={value} options={BENCHES}
                    renderControl={(spec, change) => (spec.path[0] !== "bench" ? undefined : (
                        <span data-testid="own">
                            <button type="button" onClick={() => change("B1")}>Bench 1</button>
                            <button type="button" onClick={() => change(undefined)}>Nobody</button>
                        </span>
                    ))}
                    onChange={(path, next) => {
                        edits.push({ path: path.join("."), value: next });
                        if (benchEqual(next as never, some("B1") as never)) return BOOKED;
                        setValue((v) => setAt(v, path, next));
                        return undefined;
                    }} />
            );
        }
        const { container } = render(<ChakraProvider value={system}><I18nProvider locale={LOCALE}><Host /></I18nProvider></ChakraProvider>);
        const bench = () => container.querySelector<HTMLElement>('[data-field="bench"]')!;
        const drawn = within(bench()).getByTestId("own");
        await act(async () => { fireEvent.click(within(bench()).getByRole("button", { name: "Bench 1" })); });
        await settle();
        expectEdit(edits, "bench", benchEqual, some("B1"));
        expect(refusalOf(bench())).toBe(BOOKED);
        expect(bench().querySelector("[data-scope=field][data-part=root]")!.hasAttribute("data-invalid")).toBe(true);
        expect(within(bench()).getByTestId("own")).not.toBe(drawn);
        expect(document.activeElement).toBe(within(bench()).getByRole("button", { name: "Bench 1" }));
        // Nobody: taken, and the words go.
        edits.length = 0;
        await act(async () => { fireEvent.click(within(bench()).getByRole("button", { name: "Nobody" })); });
        await settle();
        expectEdit(edits, "bench", benchEqual, none);
        expect(refusalOf(bench())).toBeUndefined();
    });
});

/**
 * The names a field's controls of a role are given, as assistive technology reads them: of the controls the query
 * returns — its name test also sees the ones it then drops as hidden, a select's native `<select>`.
 */
function namesOf(field: HTMLElement, role: "textbox" | "spinbutton" | "combobox"): string[] {
    const named = new Map<Element, string>();
    return within(field).queryAllByRole(role, { name: (name, el) => { named.set(el, name); return true; } }).map((el) => named.get(el)!);
}

/** A select's chosen words — its placeholder while it holds no value. */
function chosenOf(field: (key: string) => HTMLElement, key: string): string {
    return field(key).querySelector("[data-scope=select][data-part=trigger]")!.textContent ?? "";
}
