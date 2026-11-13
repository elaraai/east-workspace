/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A row the upstream system owns (`owned`): its cells that step in place take
 * no click there (T9), so ⌫ and a paste leave them as they are too, and each
 * says why (#1585). Over the Record's operators deployed to e3 itself, A.
 * Morgan's row owned.
 */

import { expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** The operators, A. Morgan's row owned upstream: each a name and their nights, a toggle. */
const operatorsOwned = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const operators = $.let(Record.bind(ex.recordOperators));
    return Record({
        record: operators,
        title: "Operators",
        noun: { singular: "operator", plural: "operators" },
        // The operators come from the Gatehouse: this Record edits them, and adds none.
        edits: { insertRows: false },
        columns: {
            name: Record.column.title(ex.Operator, { header: "Name" }),
            night: Record.column.toggle(ex.Operator, { header: "Nights", on: "yes", off: "no" }),
        },
        owned: (o) => o.name.equal("A. Morgan"),
        name: "operatorsOwned",
    });
})));

/** A row's cell, by the row's key and the column's. */
const cell = (container: HTMLElement, id: string, key: string) =>
    container.querySelector<HTMLElement>(`[data-record] [data-slot="row"][data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`)!;
/** The grid: what takes the keys and the pastes. */
const grid = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** The status line's words. */
const status = (container: HTMLElement) => slot(container, "toolbar")!.querySelector('[data-slot="status"]')?.textContent;

test("an owned row's toggle takes no click, so ⌫ and a paste leave it as it is too, each saying it is owned upstream — and a paste down past it lands on the row below, which no system owns (#1585)", async () => {
    const { container } = await h.mount({ fn: operatorsOwned }, { storageKey: "record-owned" });
    const nights = (id: string) => cell(container, id, "night").textContent;
    // A press on A. Morgan's Nights places the ring there, and takes no step.
    fireEvent.mouseDown(cell(container, "P-0401", "night"), { button: 0 });
    fireEvent.click(cell(container, "P-0401", "night"));
    await settle();
    expect(nights("P-0401")).toBe("no");
    fireEvent.keyDown(grid(container), { key: "Backspace" });
    await settle();
    expect([status(container), nights("P-0401")]).toEqual(["Nothing cleared — Nights is owned upstream", "no"]);
    await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => "yes" } }); });
    await settle();
    expect([status(container), nights("P-0401")]).toEqual(["Nothing pasted — Nights is owned upstream", "no"]);
    // Down both rows: B. Ellis's takes it.
    await act(async () => { fireEvent.paste(grid(container), { clipboardData: { getData: () => "yes\nno" } }); });
    await settle();
    expect([status(container), nights("P-0401"), nights("P-0408")]).toEqual(["Pasted 2×1 from clipboard · 1 skipped — Nights is owned upstream", "no", "no"]);
});
