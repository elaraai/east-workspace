/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The DecisionQueue's grouped sections (#1263), over the grouped example on
 * e3 (#1376), its inputs' declared values deployed with it: each collapsible
 * section's head leads with Font Awesome's caret — down while the section is
 * open, right while it is collapsed — hidden from a reader and never a text
 * glyph; a click on the head turns it.
 */

import { describe, test, expect } from "vitest";
import { fireEvent } from "@testing-library/react";
import { loneGlyphs, markOf } from "@elaraai/east-ui-components/testing";
import * as ex from "@elaraai/e3-ui/examples/decision/queue";
import { act, e3Harness } from "../e3-web-mount.test-utils.js";
// The queue is an extension: its renderer registers as it loads.
import "./queue.js";

const h = e3Harness({ "decision/queue": ex }, { measure: false });

describe("DecisionQueue — a section's caret is Font Awesome's (#1263)", () => {
    test("each collapsible head leads with the caret: down while open, right while collapsed, hidden from a reader; a click turns it", async () => {
        const { container } = await h.mount(ex.decisionQueueGrouped, { storageKey: "decision-queue", drag: false });
        /** Each head: its words, and its caret — hidden from a reader, and what it draws. */
        const heads = () => [...container.querySelectorAll<HTMLElement>("[data-collapsible]")].map((head) => {
            const caret = head.firstElementChild!;
            return [head.children[1]!.textContent, caret.getAttribute("aria-hidden"), markOf(caret)];
        });
        // The urgency grouping's routine tail ships collapsed.
        expect(heads()).toEqual([
            ["Overdue · 1", "true", "fas caret-down"],
            ["Due today · 1", "true", "fas caret-down"],
            ["Routine · 3", "true", "fas caret-right"],
        ]);
        expect(loneGlyphs(container)).toEqual([]);
        await act(async () => { fireEvent.click(container.querySelectorAll<HTMLElement>("[data-collapsible]")[2]!); });
        expect(heads()[2]).toEqual(["Routine · 3", "true", "fas caret-down"]);
        await act(async () => { fireEvent.click(container.querySelectorAll<HTMLElement>("[data-collapsible]")[0]!); });
        expect(heads()[0]).toEqual(["Overdue · 1", "true", "fas caret-right"]);
    });
});
