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
 * printed. Every value handed back is asserted with East's `equalFor`.
 */

import { describe, test, expect, afterEach } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import {
    ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet,
    StringType, StructType, VariantType, compareFor, equalFor, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { system } from "../../theme/index.js";
import { formatters } from "../../format/index.js";
import { FieldForm } from "./index.js";

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

const Status = VariantType({ planned: NullType, underway: NullType, done: NullType });
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

/** The job with one field set, along its path — a host's draft. */
function setAt(value: Record<string, unknown>, path: readonly string[], next: unknown): Record<string, unknown> {
    const [head, ...rest] = path;
    return { ...value, [head!]: rest.length === 0 ? next : setAt(value[head!] as Record<string, unknown>, rest, next) };
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
        // Each is the shared Field: its label, its key in mono beside it, its help line.
        for (const el of container.querySelectorAll<HTMLElement>("[data-field]")) {
            expect(el.querySelector("[data-scope=field][data-part=root]")).not.toBeNull();
        }
        expect(field("site.room").querySelector("label")!.textContent).toBe("Roomsite.room");
        expect(within(screen.getByRole("group", { name: "Site" })).getAllByText(/^site\./).map((el) => el.textContent)).toEqual(["site.room", "site.floor"]);
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

    test("a date and a time are named by their Field's label, as the shared Ark inputs are", () => {
        const { field } = mount();
        const segments = within(field("due")).getAllByRole("spinbutton");
        expect(segments.length).toBeGreaterThan(0);
        expect(within(field("due")).getAllByRole("spinbutton", { name: /Due/ })).toHaveLength(segments.length);
        expect(within(field("crew")).getByRole("spinbutton", { name: /Crew/ })).toBeTruthy();
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
        await user.type(length, "3.5");
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
        expect(await open(field("status"))).toEqual(["Planned", "Underway", "Done"]);
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
