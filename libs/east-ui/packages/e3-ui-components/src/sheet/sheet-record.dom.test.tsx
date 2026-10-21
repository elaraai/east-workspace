/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Sheet over the host's rows, read from one entry of an e3 record (#1180):
 * the configurator's sheet, its rows `data` read with `Record.bind`, and Save
 * handing the checked batch to `onApply` — `Record.onApply` over the entry's
 * rows, which commits it through the record's patch door. The example itself
 * is mounted, in its frame (#1216), as a surface mounts it, over its record on
 * e3 itself (`frame/harness.test-utils.tsx`, #1376).
 */

import { test, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import { SortedMap, StringType, compareFor, equalFor, none, some } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { act, settle, sheetHarness } from "./frame/harness.test-utils.js";

const h = sheetHarness({ frame: 2000 });
const PLANS = ex.sheetVariantsPlans;
/** The plans' commits, newest first, by the mutation that made each. */
const commits = async () => (await h.history(PLANS)).commits.map((c) => c.mutation);

test("an edited task, saved, is one commit through the record's patch door, and the drafts retire", async () => {
    const utils = await h.mount(ex.sheetVariants, { storageKey: "sheet-record" });
    const deployed = await commits();
    const row = () => utils.container.querySelector('[data-slot="row"]')!;
    const task = () => row().querySelector('[data-key="task"]')!;
    expect(task().textContent).toContain("Routing");

    fireEvent.doubleClick(task());
    await settle();
    const input = utils.container.querySelector('[data-slot="editorInput"]')!;
    fireEvent.input(input, { target: { value: "Spraying" } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    const save = utils.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(row().hasAttribute("data-draft")).toBe(true);
    await act(async () => {
        fireEvent.mouseDown(save, { button: 0 });
        fireEvent.click(save);
    });
    await settle();

    // The record holds the edit, and nothing else of it moved — one patch commit.
    const expected = new SortedMap([["week", { jobs: [
        { id: "j1", start: some(new Date("2026-02-16T00:00:00Z")), task: "Spraying", qty: some(1200.0), notes: "Nest the C-18 panels" },
        { id: "j2", start: some(new Date("2026-03-09T00:00:00Z")), task: "Spraying", qty: some(250.0), notes: "" },
        { id: "j3", start: none, task: "Wrapping", qty: none, notes: "" },
    ] }]], compareFor(StringType));
    expect(equalFor(PLANS.type)(await h.read(PLANS), expected)).toBe(true);
    expect(await commits()).toEqual(["patch", ...deployed]);

    // The drafts retired against the rows the record read back: no error, Save
    // off, and the cell shows the record's task, no longer a draft over it.
    expect(utils.queryByRole("alert")).toBeNull();
    expect((utils.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(task().textContent).toContain("Spraying");
    expect(row().hasAttribute("data-draft")).toBe(false);
});
