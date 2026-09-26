/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The history bar (#879) is every collection's: it speaks the words its
 * collection hands it, reads its session, and leaves each action to the
 * collection to run — here over a projection that is not a sheet's.
 */

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { IntegerType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { formatters } from "../format/index.js";
import { liftDraft } from "./draft.js";
import { HistoryBar, type HistoryAction } from "./HistoryBar.js";
import { editingMessages, SESSION_TEXT, type EditingMessages, type EditingWords } from "./messages.js";
import { EditSession, type EditIssue, type EntryVersion } from "./session.js";

afterEach(cleanup);

const Run = StructType({ id: StringType, end: IntegerType });
const Draft = Editing.Types.Draft(Run);
/** The English table with every message marked `⟦` — a word without the mark did not come from the words handed in. */
const MARKED = Object.fromEntries(Object.entries(editingMessages).map(([k, f]) =>
    [k, (p: never) => `⟦${(f as (p: never) => string)(p)}`])) as unknown as EditingMessages;
const WORDS: EditingWords = { ...formatters("en-US"), m: MARKED };
const start = some(variant("ordered", variant("start", null)));
const version = (end: bigint): EntryVersion<string> => ({ draft: liftDraft(Draft, { id: "a", end }), wire: `a to ${end}`, place: start });

function setup() {
    const session = new EditSession<string>({
        sourceId: "runs", entryType: Run, draftType: Draft, idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    session.observeBase(variant("snapshot", [{ id: "a", end: 1n }]));
    const onAction = vi.fn<(action: HistoryAction) => void>();
    const onIssue = vi.fn<(issue: EditIssue) => void>();
    const bar = () => <ChakraProvider value={system}><HistoryBar session={session} words={WORDS} editing={false} onAction={onAction} onIssue={onIssue} /></ChakraProvider>;
    const utils = render(bar());
    return { ...utils, session, onAction, onIssue, refresh: () => utils.rerender(bar()) };
}

test("the bar speaks the words its collection hands it, and each action is the collection's to run", () => {
    const ui = setup();
    for (const name of ["⟦Undo", "⟦Redo", "⟦Discard", "⟦Apply changes"]) expect(ui.getByRole("button", { name })).toBeTruthy();
    expect((ui.getByRole("button", { name: "⟦Undo" }) as HTMLButtonElement).disabled).toBe(true);
    // No issues: the issues button keeps its place, hidden.
    expect(ui.container.querySelector('[data-slot="historyIssues"]')!.hasAttribute("data-empty")).toBe(true);
    ui.session.record([{ id: "a", before: version(1n), after: version(4n) }], "resize", "Resize a");
    ui.refresh();
    fireEvent.click(ui.getByRole("button", { name: "⟦Undo" }));
    fireEvent.click(ui.getByRole("button", { name: "⟦Apply changes" }));
    expect(ui.onAction.mock.calls.map(([action]) => action)).toEqual(["undo", "apply"]);
});

test("an incomplete draft counts as an issue the bar goes to; the status and the session's own error are worded, a host's error shown as written", () => {
    const ui = setup();
    const incomplete: EntryVersion<string> = { draft: { id: variant("value", "a"), end: variant("missing", null) }, wire: "a to ?", place: start };
    ui.session.record([{ id: "a", before: version(1n), after: incomplete }], "typed", "Clear the end");
    ui.refresh();
    expect((ui.getByRole("button", { name: "⟦Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ui.getByRole("button", { name: "⟦1 issue" }));
    expect(ui.onIssue).toHaveBeenCalledWith(expect.objectContaining({ entry: "a", field: some("end") }));
    ui.session.status = "applying";
    ui.session.error = SESSION_TEXT.noRevision;
    ui.refresh();
    expect(ui.getByRole("status").textContent).toBe("⟦Applying changes…");
    expect(ui.getByRole("alert").textContent).toBe(`⟦${SESSION_TEXT.noRevision}`);
    ui.session.error = "Refused by the host";
    ui.refresh();
    expect(ui.getByRole("alert").textContent).toBe("Refused by the host");
});
