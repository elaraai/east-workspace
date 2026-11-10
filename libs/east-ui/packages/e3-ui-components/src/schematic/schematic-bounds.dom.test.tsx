/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A number outside its field's bounds (#1585), over the data centre's racks
 * and their loads on e3 itself, in a test's own Schematic whose loads' form
 * holds a rack's load to at most 10 kW: A04's is stored at 11.6. Stored, its
 * card wears the warn ring, Issues warns of it, Details says it under the
 * field and it holds no Save — another rack's change saves; A04's capacity
 * changed, Save waits, Issues saying it among what blocks, by the field's
 * label and the bound in its hint's own words, and the ring stays.
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

/** The racks beside their loads, both bound with their patch doors, the loads' form holding a rack's load to at most 10 kW. */
const bounded = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Record.bind(ex.schematicRacks, ["patch"]));
    const loads = $.let(Record.bind(ex.schematicRackLoads, ["patch"]));
    return Schematic({
        id: "boundedLoads",
        inspector: true,
        extent: { width: 28, height: 14 },
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name", layer: "system",
                details: Schematic.details(loads, { meter: (l) => ({ value: l.kw, max: l.capacity }), fields: { kw: Fields.number({ label: "Load", max: 10.0 }) } }),
            }),
        },
    });
}))) };

/** The canvas. */
const canvasOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-schematic-canvas]")!;
/** The inspector's open tab's panel. */
const panel = (c: HTMLElement): HTMLElement => slot(c, "end").querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
/** A field of Details' loads, by its key. */
const field = (c: HTMLElement, key: string): HTMLElement => panel(c).querySelector<HTMLElement>(`[data-inspector-fields="details"] [data-field="${key}"]`)!;
/** Whether Save is off. */
const saveOff = (c: HTMLElement) => within(slot(c, "toolbar")).getByRole<HTMLButtonElement>("button", { name: editingMessages.apply() }).disabled;
/** Issues, each as it reads: what it says, and whether it blocks or warns. */
const issues = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-inspector-issue] [data-kind]")].map((el) => [el.textContent, el.getAttribute("data-kind")]);
/** Whether a rack's card wears the warn ring of a broken bound. */
const ringed = (c: HTMLElement, key: string) => card(c, "racks", key)?.hasAttribute("data-bounds") === true;

/** Opens a tab of the inspector, by the words it starts with. */
async function openTab(c: HTMLElement, name: "Details" | "Issues"): Promise<void> {
    const tab = [...slot(c, "end").querySelectorAll("[role='tab']")].find((t) => t.textContent?.startsWith(name) === true)!;
    await act(async () => { fireEvent.click(tab); });
    await settle();
}

/** Types a number field's new value, a key at a time — the shared input writes back on a frame — and commits it with ⏎. */
async function retypeNumber(c: HTMLElement, key: string, text: string): Promise<void> {
    const user = userEvent.setup();
    const input = within(field(c, key)).getByRole("spinbutton");
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

test("a stored load over its most: A04's card wears the warn ring, Issues warns of it and Details says it under the field, holding no Save — another rack's change saves; A04's capacity changed, Save waits, Issues says it among what blocks and the ring stays (#1585)", async () => {
    const { container: c } = await h.mount(bounded);
    await settle();
    await waitFor(() => expect(card(c, "racks", "A01")).not.toBeNull());
    const found = CENTRES.flatMap(([key, x, y]) => {
        const el = card(c, "racks", key);
        return el === null ? [] : [[el, x, y] as const];
    });
    canvasLayout.hits((px, py) => found.find(([, x, y]) => near(CAM, px, py, x, y))?.[0] ?? (px >= 0 && px < 1080 && py >= 0 && py < 540 ? canvasOf(c) : null));
    fireEvent.pointerEnter(canvasOf(c));
    // Stored: A04's card wears the warn ring, and Issues warns of it — nothing blocks.
    await waitFor(() => expect([ringed(c, "A04"), ringed(c, "A03")]).toEqual([true, false]));
    await openTab(c, "Issues");
    expect(issues(c)).toEqual([["Load: at most 10", "warning"]]);
    await openTab(c, "Details");
    // Another rack's change saves: the stored breach holds nothing.
    await tap(canvasOf(c), CAM, 9.6, 2.9);
    await settle();
    await retypeNumber(c, "capacity", "9");
    expect(saveOff(c)).toBe(false);
    // Stored: the line under the field.
    await tap(canvasOf(c), CAM, 13.2, 2.9);
    await settle();
    expect(field(c, "kw").querySelector("[data-scope=field][data-part=error-text]")?.textContent).toBe("at most 10");
    // A04's capacity changed: Save waits, Issues says why among what blocks — no longer a warning — and the ring stays.
    await retypeNumber(c, "capacity", "14");
    expect(saveOff(c)).toBe(true);
    await openTab(c, "Issues");
    expect(issues(c)).toEqual([["Load: at most 10", "invalid"]]);
    expect(ringed(c, "A04")).toBe(true);
});
