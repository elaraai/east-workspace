/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Sheet>` as its frame crosses a phone's width (`Mobile Sheet Spec.md` SH4),
 * over the Sheet's examples and their records on e3 itself
 * (`harness.test-utils.tsx`): the column the sheet pins on a phone goes
 * first, and an editor open across the crossing stays on its own cell — what
 * was typed in it written to its own column.
 */

import { test, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import { East } from "@elaraai/east";
import { Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/sheet/sheet";
import { width } from "../../e3-web-mount.test-utils.js";
import { touchFrame } from "../frame.test-utils.js";
import { sheetHarness, settle, slot } from "./harness.test-utils.js";

const h = sheetHarness();

/** The jobs, their quantity first and their task the column a phone pins: on a phone the second column goes first. */
const pinnedPayload = East.function([], SheetPayloadType, ($) => {
    const jobs = $.let(Record.bind(ex.sheetJobs, ["patch"]));
    return Sheet.Payload({ record: jobs, name: "pinned", narrow: { pin: "task" }, columns: {
        qty:  Sheet.column.quantity(ex.SheetJob, { header: "Qty", width: "96px" }),
        task: Sheet.column.text(ex.SheetJob, { header: "Task", width: "240px" }),
    } });
});

/** The grid's rows as it mounts them. */
const rows = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll<HTMLElement>('[data-slot="row"]')];
/** A cell of the grid's rows, by its row and its column. */
const cell = (c: HTMLElement, row: number, key: string) => rows(c)[row]!.querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;
/** A row's columns, in the order the grid draws them. */
const order = (c: HTMLElement) => [...rows(c)[0]!.querySelectorAll<HTMLElement>('[data-slot="cell"]')].map((el) => el.getAttribute("data-key"));
/** The open editor's input, if one is open. */
const input = (c: HTMLElement) => slot(c, "main")!.querySelector<HTMLInputElement>('[data-slot="editorInput"]');
/** The card the grid's keys reach. */
const card = (c: HTMLElement) => slot(c, "main")!.querySelector<HTMLElement>("[data-sheet-card]")!;

test("an editor open as the frame narrows to a phone's stays on its cell as the pinned column goes first, and what was typed is written to its own column", async () => {
    let restore = touchFrame(900);
    // A resize reports the frame's box, which jsdom lays out nowhere: as wide and as tall as the frame is laid out, or
    // the rows' virtualizer would see a frame with no room for a row.
    const measured = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (!(this instanceof HTMLElement) || this.getAttribute("data-virtual-rows") !== "bounded") return measured.call(this);
        const { offsetWidth: across, offsetHeight: down } = this;
        return { x: 0, y: 0, top: 0, left: 0, right: across, bottom: down, width: across, height: down, toJSON: () => ({}) } as DOMRect;
    };
    try {
        const { container } = await h.mountPayload(pinnedPayload);
        expect(order(container)).toEqual(["qty", "task"]);
        fireEvent.mouseDown(cell(container, 0, "qty"), { button: 0 });
        await settle();
        fireEvent.keyDown(card(container), { key: "7" });
        await settle();
        expect(cell(container, 0, "qty").contains(input(container))).toBe(true);
        // The frame narrows to a phone's: Task, pinned, goes first.
        restore();
        restore = touchFrame(390);
        await width(390);
        expect(order(container)).toEqual(["task", "qty"]);
        expect(cell(container, 0, "qty").contains(input(container))).toBe(true);
        expect(input(container)!.value).toBe("7");
        fireEvent.keyDown(input(container)!, { key: "Enter" });
        await settle();
        expect(cell(container, 0, "qty").textContent).toContain("7");
        expect(cell(container, 0, "task").textContent).toBe("Panel cutting");
    } finally {
        Element.prototype.getBoundingClientRect = measured;
        restore();
    }
});
