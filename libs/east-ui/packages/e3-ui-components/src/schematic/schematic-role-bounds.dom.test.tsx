/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A role's number outside the bounds a hint gives it (#1585), over the data
 * centre's racks on e3 itself, in a test's own Schematic whose racks' centres
 * are roles — a move writes them, and Details draws them as the rack's
 * position, never in its form — a hint holding a rack's x to at most 15 m:
 * A05 stands at 16.8. Stored, Details says it under the position's x and it
 * holds no Save — another rack's move saves; A05's y retyped, Save waits,
 * Issues saying it among what blocks, by the hint's label and the bound in its
 * own words.
 */

import { expect, test } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { East } from "@elaraai/east";
import { Fields, Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { card, fitted, layOutCanvas, near, tap } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The camera the canvas fits a 28 × 14 m drawing with — the data centre's. */
const CAM = fitted(28, 14);

/** The racks' centres, each where its card answers a press. */
const CENTRES: readonly (readonly [key: string, x: number, y: number])[] = [["A01", 2.4, 2.9], ["A02", 6.0, 2.9], ["A03", 9.6, 2.9], ["A04", 13.2, 2.9], ["A05", 16.8, 2.9]];

/** The racks, bound with their patch door, a hint holding a rack's x — its centre's, a role — to at most 15 m. */
const bounded = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    return Schematic({
        id: "boundedRacks",
        inspector: true,
        extent: { width: 28, height: 14 },
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                fields: { x: Fields.number({ label: "Across", max: 15.0 }) },
            }),
        },
    });
}))) };

/** The canvas. */
const canvasOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-schematic-canvas]")!;
/** The inspector's open tab's panel. */
const panel = (c: HTMLElement): HTMLElement => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** A field of Details' position, by its key. */
const position = (c: HTMLElement, key: string): HTMLElement => panel(c).querySelector<HTMLElement>(`[data-inspector-fields="position"] [data-field="${key}"]`)!;
/** What Details says under a field of its position: the bound its coordinate breaks; `undefined` for none. */
const said = (c: HTMLElement, key: string) => position(c, key).querySelector("[data-scope=field][data-part=error-text]")?.textContent;
/** Whether Save is off. */
const saveOff = (c: HTMLElement) => within(slot(c, "toolbar")).getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() }).disabled;
/** Issues, each as it reads: what it says, and whether it blocks or warns. */
const issues = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-inspector-issue] [data-kind]")].map((el) => [el.textContent, el.getAttribute("data-kind")]);

/** Types a coordinate of the selected rack's position, a key at a time — the shared input writes back on a frame — and commits it with ⏎. */
async function retype(c: HTMLElement, key: string, text: string): Promise<void> {
    const user = userEvent.setup();
    const input = within(position(c, key)).getByRole("spinbutton");
    await user.clear(input);
    await settle();
    for (const ch of text) {
        await user.type(input, ch);
        await settle();
        await act(async () => { for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    }
    await user.type(input, "{Enter}");
    await settle();
}

test("a stored rack's centre past its most: Details says it under its position and it holds no Save — another rack's move saves; A05's y retyped, Save waits and Issues says it among what blocks (#1585)", async () => {
    const { container: c } = await h.mount(bounded);
    await settle();
    await waitFor(() => expect(card(c, "racks", "A01")).not.toBeNull());
    const found = CENTRES.flatMap(([key, x, y]) => {
        const el = card(c, "racks", key);
        return el === null ? [] : [[el, x, y] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y]) => near(CAM, px, py, x, y))?.[0] ?? (px >= 0 && px < 1080 && py >= 0 && py < 540 ? canvasOf(c) : null));
    fireEvent.pointerEnter(canvasOf(c));
    // Another rack's move saves: the stored breach holds nothing.
    await tap(canvasOf(c), CAM, 13.2, 2.9);
    await settle();
    expect(said(c, "x")).toBeUndefined();
    await retype(c, "y", "4");
    expect(saveOff(c)).toBe(false);
    // Stored: the line under its position's x, its centre no field of its form.
    await tap(canvasOf(c), CAM, 16.8, 2.9);
    await settle();
    expect(said(c, "x")).toBe("at most 15");
    expect(panel(c).querySelector('[data-inspector-fields="row"] [data-field="x"]')).toBeNull();
    // A05's y retyped: Save waits, and Issues says why among what blocks.
    await retype(c, "y", "4");
    expect(saveOff(c)).toBe(true);
    const tab = [...slot(c, "end").querySelectorAll("[role='tab']")].find((t) => t.textContent?.startsWith("Issues") === true)!;
    await act(async () => { fireEvent.click(tab); });
    await settle();
    expect(issues(c)).toEqual([["Across: at most 15", "invalid"]]);
});
