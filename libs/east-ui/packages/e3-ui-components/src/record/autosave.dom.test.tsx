/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Where a Record's Autosave begins is its author's (`autosave`, ruled 11 Nov
 * 2026), on e3 itself: a Record that says nothing begins off, and one given
 * `autosave` begins on — the switch in Save's menu, with nothing kept for the
 * viewer.
 */

import { describe, expect, test } from "vitest";
import { East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record";
import { sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

const h = sheetHarness({ modules: { "record/record": ex }, frame: 2000 });

/** The crew, as a Record whose author says where its Autosave begins — or says nothing. */
const crew = (autosave: boolean | undefined) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const members = $.let(Record.bind(ex.recordCrew));
    return Record({
        record: members,
        columns: { name: Record.column.title(ex.Crew, { header: "Name" }) },
        // No column sets a member's other fields: this Record adds no one.
        edits: { insertRows: false },
        ...(autosave === undefined ? {} : { autosave }),
    });
}))) });

/** Whether Save's chevron says the Record's changes are saved by themselves. */
const autosaves = (container: HTMLElement) => slot(container, "toolbar")!.querySelector<HTMLElement>("[data-history-autosave]")!.hasAttribute("data-on");

describe("where a Record's Autosave begins is its author's (`autosave`)", () => {
    test("said nothing, it begins off", async () => {
        const { container } = await h.mount(crew(undefined), { storageKey: "record-autosave-silent" });
        expect(autosaves(container)).toBe(false);
    });

    test("given `autosave`, it begins on", async () => {
        const { container } = await h.mount(crew(true), { storageKey: "record-autosave-on" });
        expect(autosaves(container)).toBe(true);
    });
});
