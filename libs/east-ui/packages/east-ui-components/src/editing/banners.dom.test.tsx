/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The session's banners (#1184): what the history bar says under its buttons,
 * for a host that leaves it to its banners. Each is driven from a real
 * session put in its state — a Save's conflicts and its refusal, a write
 * with no answer, a confirmation read that failed, drafts the source moved
 * under — and each leaves when its state does, without the host rendering
 * again.
 */

import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { IntegerType, StringType, StructType, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { formatters } from "../format/index.js";
import { liftDraft } from "./draft.js";
import { SessionBanners } from "./banners.js";
import type { HistoryAction } from "./HistoryBar.js";
import { editingMessages, type EditingWords } from "./messages.js";
import { EditSession, type EditIssue, type EditSessionBinding, type EntryVersion } from "./session.js";

afterEach(cleanup);

const Run = StructType({ id: StringType, end: IntegerType });
const Draft = Editing.Types.Draft(Run);
type RunValue = ValueTypeOf<typeof Run>;
const WORDS: EditingWords = { ...formatters("en-US"), m: editingMessages };
const a: RunValue = { id: "a", end: 1n };
const place = some(variant("ordered", variant("start", null)));
const version = (run: RunValue): EntryVersion<string> => ({ draft: liftDraft(Draft, run), wire: run.id, place });
const issue = (entry: string, message: string): EditIssue => ({ entry, row: none, field: none, message });

/** A session over one run, its first gesture drafted, its Save answering as given. */
function drafted(overrides: Partial<EditSessionBinding<string>> = {}): EditSession<string> {
    const session = new EditSession<string>({
        sourceId: "runs", entryType: Run, draftType: Draft, idField: "id", auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: () => null, ...overrides,
    });
    session.observeBase(variant("snapshot", [a]));
    session.record([{ id: "a", before: version(a), after: version({ ...a, end: 2n }) }], "typed", "Edit a");
    return session;
}

function mount(session: EditSession<string>, props: { where?: (issue: EditIssue) => string; issueText?: (message: string) => string } = {}) {
    const actions: HistoryAction[] = [];
    const view = render(
        <ChakraProvider value={system}>
            <SessionBanners session={session} words={WORDS} onAction={(action) => actions.push(action)} {...props} />
        </ChakraProvider>,
    );
    return { ...view, actions };
}

const kinds = (container: HTMLElement) => [...container.querySelectorAll("[data-session-banner]")].map((el) => el.getAttribute("data-session-banner"));
const banner = (container: HTMLElement, kind: string) => container.querySelector<HTMLElement>(`[data-session-banner="${kind}"]`);

test("a session with nothing to report shows no banner", () => {
    const { container } = mount(drafted());
    expect(kinds(container)).toEqual([]);
});

test("a Save's conflict names each issue's place, the first three of them and a count of the rest, in the collection's words", async () => {
    const issues = ["a", "b", "c", "d", "e"].map((id) => issue(id, `Changed since this edit began — last changed by ops`));
    const session = drafted({ apply: () => variant("conflict", issues) });
    await act(() => session.apply());
    const { container } = mount(session, { where: (i) => `Run ${i.entry}`, issueText: (message) => message.toUpperCase() });
    expect(kinds(container)).toEqual(["conflict"]);
    const conflict = banner(container, "conflict")!;
    expect(conflict.textContent).toContain("Save stopped — 5 conflicts with the source");
    expect([...conflict.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
        "Run a: CHANGED SINCE THIS EDIT BEGAN — LAST CHANGED BY OPS",
        "Run b: CHANGED SINCE THIS EDIT BEGAN — LAST CHANGED BY OPS",
        "Run c: CHANGED SINCE THIS EDIT BEGAN — LAST CHANGED BY OPS",
        "and 2 more issues",
    ]);
});

test("a refusal gives its reasons; an issue about the source as a whole names no place", async () => {
    const session = drafted({ apply: () => variant("rejected", [issue("", "The write ran out of time after 30000 ms and wrote nothing")]) });
    await act(() => session.apply());
    const { container } = mount(session);
    expect(kinds(container)).toEqual(["rejected"]);
    expect(banner(container, "rejected")!.textContent).toContain("The source refused these changes");
    expect([...banner(container, "rejected")!.querySelectorAll("li")].map((li) => li.textContent))
        .toEqual(["The write ran out of time after 30000 ms and wrote nothing"]);
});

test("a write with no answer says so with its error, and its Retry sends the same request", async () => {
    const session = drafted({ apply: () => { throw new Error("The write got no answer"); } });
    await act(() => session.apply());
    const { container, actions } = mount(session);
    expect(kinds(container)).toEqual(["unknown"]);
    expect(banner(container, "unknown")!.textContent).toContain("No answer from the source — the changes may have been saved");
    expect(banner(container, "unknown")!.textContent).toContain("The write got no answer");
    fireEvent.click(banner(container, "unknown")!.querySelector("[data-banner-action]")!);
    expect(actions).toEqual(["apply"]);
});

test("a Save whose result could not be read back says why, and its Retry reads it again", async () => {
    const session = drafted();
    await act(() => session.apply());
    expect(session.status).toBe("reconciling");
    const { container, actions } = mount(session);
    // Confirming, nothing has gone wrong: no banner.
    expect(kinds(container)).toEqual([]);
    act(() => session.confirmFailed("The record could not be read"));
    expect(kinds(container)).toEqual(["confirm"]);
    expect(banner(container, "confirm")!.textContent).toContain("Saved — the result could not be read back");
    expect(banner(container, "confirm")!.textContent).toContain("The record could not be read");
    fireEvent.click(banner(container, "confirm")!.querySelector("[data-banner-action]")!);
    expect(actions).toEqual(["refresh"]);
    // The read gets through: the banner leaves.
    act(() => session.confirmFailed(undefined));
    expect(kinds(container)).toEqual([]);
});

test("drafts the source moved under are out of date, with Discard; after a conflict's banner, in that order", async () => {
    const session = drafted({ apply: () => variant("conflict", [issue("a", "Changed since this edit began")]) });
    await act(() => session.apply());
    act(() => session.observeBase(variant("snapshot", [{ ...a, end: 9n }])));
    const { container, actions } = mount(session);
    expect(kinds(container)).toEqual(["conflict", "stale"]);
    expect(banner(container, "stale")!.textContent).toContain("The source changed under these drafts");
    fireEvent.click(banner(container, "stale")!.querySelector("[data-banner-action]")!);
    expect(actions).toEqual(["discard"]);
});

test("a banner leaves when what it reports does, following the session itself", async () => {
    const session = drafted({ apply: () => variant("conflict", [issue("a", "Changed since this edit began")]) });
    await act(() => session.apply());
    const { container } = mount(session);
    expect(kinds(container)).toEqual(["conflict"]);
    // The next gesture clears the conflict: the banners follow the session, with no render of their host.
    act(() => { session.record([{ id: "a", before: version({ ...a, end: 2n }), after: version({ ...a, end: 3n }) }], "typed", "Edit a"); });
    expect(kinds(container)).toEqual([]);
    act(() => session.observeBase(variant("snapshot", [{ ...a, end: 9n }])));
    expect(kinds(container)).toEqual(["stale"]);
    act(() => session.discard());
    expect(kinds(container)).toEqual([]);
});
