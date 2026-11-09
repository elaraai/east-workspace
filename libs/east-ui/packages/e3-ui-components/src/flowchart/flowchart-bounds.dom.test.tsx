/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A step's number outside its field's bounds (#1585), over the bakery's line
 * on e3 itself (`flowchartBakery`): an app's write leaves Cool sliced into 0,
 * under the least its Slices field allows, 1. Stored, its card wears the warn
 * ring, Details says it under the field and Issues warns of it — `Slices: at
 * least 1` — and Save holds for no such row: Mix renamed saves. Cool renamed
 * holds Save, Issues saying it among what blocks, and keeps its ring.
 */

import { expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { IntegerType, SortedMap, StringType, compareFor, equalFor, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/flowchart/flowchart";
import { slot } from "../e3-web-mount.test-utils.js";
import { act, enabled, flowchartHarness, settle } from "./flowchart.test-utils.js";
import { flowchartMessages } from "./messages.js";

const h = flowchartHarness();

const m = flowchartMessages;
const SAVE = editingMessages.apply();
const keyEqual = equalFor(StringType);
const integerEqual = equalFor(IntegerType);

/** A step's card, by its key's text. */
const node = (c: HTMLElement, key: string): HTMLElement | null =>
    [...c.querySelectorAll<HTMLElement>("[data-flowchart-node]")].find((el) => keyEqual(el.getAttribute("data-flowchart-node") ?? "", key)) ?? null;

/** The inspector's open tab. */
const panel = (c: HTMLElement): HTMLElement => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;

/** Issues, each as it reads: what it names, what it says, and whether it blocks or warns. */
const issues = (c: HTMLElement): (string | null)[][] => [...panel(c).querySelectorAll("[data-inspector-issue]")].map((el) => {
    const said = el.querySelector("[data-kind]");
    return [el.querySelector("span:first-child")?.textContent ?? null, said?.textContent ?? null, said?.getAttribute("data-kind") ?? null];
});

/** Fires a gesture's events, and lets the sessions and the renders settle. */
async function gesture(fire: () => void): Promise<void> {
    await act(async () => { fire(); });
    await settle();
}

/** Opens one of the inspector's tabs, by its name. */
async function openTab(c: HTMLElement, name: string): Promise<void> {
    const tab = [...slot(c, "end").querySelectorAll("[role='tab']")].find((t) => t.textContent === name || t.textContent?.startsWith(`${name} `) === true);
    if (tab === undefined) throw new Error(`no inspector tab ${name}`);
    await gesture(() => { fireEvent.click(tab); });
}

/** A step double-clicked into its editor, a label typed, and ⏎. */
async function renameStep(c: HTMLElement, key: string, label: string): Promise<void> {
    await gesture(() => { fireEvent.doubleClick(node(c, key)!); });
    const input = c.querySelector<HTMLInputElement>("[data-flowchart-stateeditor] [data-flowchart-label]")!;
    await gesture(() => { fireEvent.change(input, { target: { value: label } }); });
    await gesture(() => { fireEvent.keyDown(input, { key: "Enter" }); });
}

test("a stored step sliced under its Slices' least: its card wears the warn ring, Details says it under the field, Issues warns of it and Save holds for no such row; renamed, it holds Save, Issues saying it among what blocks (#1585)", async () => {
    const steps = new SortedMap(await h.read(ex.bakerySteps), compareFor(IntegerType));
    const cool = [...steps].find(([key]) => integerEqual(key, 40n))![1];
    steps.set(40n, { ...cool, portion: variant("sliced", 0n) });
    await h.patch(ex.bakerySteps, steps);
    const { container: c } = await h.mountExample(ex.flowchartBakery);
    await waitFor(() => expect(node(c, "40")).not.toBeNull());
    await settle();
    const where = m.issueWhere({ kind: "State", name: "40" });
    const said = m.issueText({ issue: "bounds", field: "Slices", bound: "at least 1" });
    expect(said).toBe("Slices: at least 1");
    // Stored: its card wears the warn ring — Mix's none — Details says it under the field, and Issues warns of it.
    expect([node(c, "40")!.hasAttribute("data-bounds"), node(c, "10")!.hasAttribute("data-bounds")]).toEqual([true, false]);
    await gesture(() => { fireEvent.click(node(c, "40")!); });
    const slices = panel(c).querySelector('[data-field="portion.sliced"]');
    expect(slices?.querySelector("[data-scope=field][data-part=error-text]")?.textContent).toBe("at least 1");
    await openTab(c, "Issues");
    expect(issues(c)).toEqual([[where, said, "warning"]]);
    // It holds no Save: Mix renamed saves.
    await renameStep(c, "10", "Mixing");
    expect(enabled(SAVE)).toBe(true);
    // Cool renamed: Save waits, and Issues says it among what blocks.
    await renameStep(c, "40", "Cooling");
    await openTab(c, "Issues");
    expect(enabled(SAVE)).toBe(false);
    expect(issues(c)).toEqual([[where, said, "invalid"]]);
    expect(node(c, "40")!.hasAttribute("data-bounds")).toBe(true);
});
