/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * Where a builder's Autosave begins is its author's (`autosave`, ruled 11 Nov
 * 2026), on e3 itself. The Calendar's `calendarAutosave` reads it from an input
 * of the app's: the switch in Save's menu begins on with nothing kept for the
 * viewer, follows the input as another session writes it, and gives way to the
 * viewer's own flick, which is kept. A Calendar that says nothing begins off.
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { act, calendarHarness, settle, slot } from "./harness.test-utils.js";

const h = calendarHarness();
async function press(node: Element) { await act(async () => { fireEvent.click(node); }); await settle(); }
/** Save's chevron: on while the Calendar's changes are saved by themselves. */
const chevron = (c: HTMLElement) => slot(c, "toolbar").querySelector<HTMLElement>("[data-history-autosave]")!;
const on = (c: HTMLElement) => chevron(c).hasAttribute("data-on");

describe("where Autosave begins is its author's (`autosave`)", () => {
    test("a Calendar that says nothing begins off", async () => {
        const { container } = await h.mount(ex.calendarQuickstart);
        expect(on(container)).toBe(false);
    });

    test("it begins on where the app's setting says so, follows the setting as another session writes it, and gives way to the viewer's own flick, which stands over whatever the setting says after", async () => {
        const { container } = await h.mount(ex.calendarAutosave);
        expect(on(container)).toBe(true);
        // The setting is data: another session writes it off, and a choice never made follows it.
        await h.write(ex.calendarAutosaveSetting, false);
        await waitFor(() => expect(on(container)).toBe(false));
        await h.write(ex.calendarAutosaveSetting, true);
        await waitFor(() => expect(on(container)).toBe(true));
        // The viewer's own: the switch, on as the setting has it, flicked off.
        await press(chevron(container));
        const flick = await screen.findByRole<HTMLInputElement>("switch", { name: editingMessages.autosave() });
        expect(flick.checked).toBe(true);
        await press(flick);
        await waitFor(() => expect(on(container)).toBe(false));
        // The setting written again, off and on: the viewer's choice stands.
        await h.write(ex.calendarAutosaveSetting, false);
        await h.write(ex.calendarAutosaveSetting, true);
        await settle();
        expect(on(container)).toBe(false);
    });
});
