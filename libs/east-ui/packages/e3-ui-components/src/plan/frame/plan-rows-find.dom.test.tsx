/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * Search Records over a Plan's `rows` source (#1513), on e3, over the works:
 * the box finds a row the rail hides, its line names the choices hiding it, and
 * a pick clears just those and goes to the row where the narrowing left holds
 * it, in that narrowing's index's order, its row taking the keyboard.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceStateType } from "@elaraai/east-ui/internal";
import { getStore } from "@elaraai/east-ui-components/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-nested";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { act, planHarness, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-nested": ex });
const KEY = "ex.planNestedAll.rows";

const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
type State = ValueTypeOf<typeof RecordSliceStateType>;
const compareString = compareFor(StringType);
const text = printFor(StringType);

let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(700), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

/** The works' source narrowed, as the rail writes it. */
async function narrow(choices: Readonly<Record<string, string>>) {
    const was = decodeState(getStore().read(KEY)!);
    const where: State["where"] = new SortedMap([], compareString);
    for (const [field, value] of Object.entries(choices)) where.set(field, variant("values", [text(value)]));
    await act(async () => { getStore().write(KEY, encodeState({ ...was, preset: none, where })); });
    await settle();
}
/** The narrowing's fields, and each one's choice as the rail holds it. */
const narrowing = () => [...decodeState(getStore().read(KEY)!).where.keys()];

const box = (c: HTMLElement) => slot(c, "toolbar")!.querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
const input = (c: HTMLElement) => box(c).querySelector<HTMLInputElement>("input")!;
async function paste(c: HTMLElement, typed: string) {
    await act(async () => { input(c).focus(); fireEvent.input(input(c), { target: { value: typed } }); });
    await settle();
}
const lines = (c: HTMLElement) => {
    const list = document.getElementById(input(c).getAttribute("aria-controls") ?? "");
    return list === null ? [] : [...list.querySelectorAll('[role="option"]')].map((option) => option.textContent ?? "");
};
const labels = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll("[role='treegrid'] [role='row'] [data-plan-gutter-label], [role='treegrid'] [role='row']")]
    .map((row) => row.textContent ?? "");

describe("Search Records over a Plan's rows source (#1513)", () => {
    test("finds a row the rail hides, names what hides it, and a pick clears just that and goes to the row", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        // North's works: 10001, 10005, … — 10002 stands in the south.
        await narrow({ site: "north" });
        expect(labels(c).some((label) => label.includes("Works 10002"))).toBe(false);
        await paste(c, "Works 10002");
        await waitFor(() => expect(lines(c)[0]).toBe("Works 10002 · hidden by Site: north — picking it clears that filter"));
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(narrowing()).toEqual([]), { timeout: 4000 });
        await waitFor(() => expect(labels(c).some((label) => label.includes("Works 10002"))).toBe(true));
        // Its row takes the keyboard, as every builder's pick hands it over.
        await waitFor(() => expect(document.activeElement?.closest("[role='row']")?.textContent ?? "").toContain("Works 10002"));
    });

    test("a row the narrowing holds, past every row sharing its index key's start, is gone to where the narrowing lays it, nothing cleared", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        // North's rows run by status, then key: the last by key among the `running` ones is far from where the record has it.
        await narrow({ site: "north" });
        await paste(c, "Works 10097");
        await waitFor(() => expect(lines(c)[0]).toBe("Works 10097"));
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        expect(narrowing()).toEqual(["site"]);
        await waitFor(() => expect(labels(c).some((label) => label.includes("Works 10097"))).toBe(true));
    });

    test("a pick of a row two choices narrow goes to it, whichever of them hide it", async () => {
        const { container: c } = await h.mount(ex.planNestedAll);
        await settle();
        // Works 10002: south, idle (its number's remainders).
        await narrow({ site: "north", status: "idle" });
        await paste(c, "Works 10002");
        await waitFor(() => expect(lines(c)[0]).toContain("hidden by Site: north"));
        fireEvent.keyDown(input(c), { key: "Enter" });
        await settle();
        await waitFor(() => expect(labels(c).some((label) => label.includes("Works 10002"))).toBe(true));
    });
});
