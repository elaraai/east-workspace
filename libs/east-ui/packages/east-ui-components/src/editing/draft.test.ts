/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * How a draft presents (#879) — an entry's, or one child row of a group —
 * in the words of the surface that shows it.
 */

import { expect, test } from "vitest";
import { ArrayType, IntegerType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { liftDraft, presentDraft, raiseIssue, type BatchReadiness } from "./draft.js";
import { DRAFT_ISSUE_TEXT } from "./messages.js";

const Row = StructType({ id: StringType, qty: IntegerType });
const Draft = Editing.Types.Draft(Row);
const Group = StructType({ id: StringType, rows: ArrayType(Row) });
const GroupDraft = Editing.Types.DraftGroup(Group, "rows");
/** The surface's words: every issue marked, so a text that bypassed them shows. */
const text = (message: string) => `⟦${message}`;

test("an entry's own issues show by field, in the surface's words; a new draft is discardable while the session can take it", () => {
    const current = { id: variant("value", "n"), qty: variant("missing", null) };
    const fresh = presentDraft({ type: Draft, current, before: undefined, entry: "n", writable: true, text });
    expect(fresh).toMatchObject({ pending: true, incomplete: true, invalid: false, discardable: true });
    expect(fresh.issues.get("qty")).toBe(`⟦${DRAFT_ISSUE_TEXT.required}`);
    expect(presentDraft({ type: Draft, current, before: undefined, entry: "n", writable: false, text }).discardable).toBe(false);
    const applied = liftDraft(Draft, { id: "a", qty: 1n });
    const unchanged = presentDraft({ type: Draft, current: applied, before: applied, entry: "a", writable: true, text });
    expect(unchanged).toMatchObject({ pending: false, incomplete: false, invalid: false, discardable: false });
});

test("a batch issue addressed to a child row shows on that row alone, and an author's refusal makes it invalid", () => {
    const group = liftDraft(GroupDraft, { id: "g", rows: [{ id: "r0", qty: 1n }, { id: "r1", qty: 2n }] }) as { rows: unknown[] };
    const readiness: BatchReadiness = variant("invalid", [{ entry: "g", row: some(1n), field: some("qty"), message: "Too many" }]);
    const second = presentDraft({ type: Draft, current: group.rows[1], before: group.rows[1], entry: "g", row: 1, readiness, writable: true, text });
    expect(second).toMatchObject({ invalid: true, incomplete: false });
    expect(second.issues.get("qty")).toBe("⟦Too many");
    const first = presentDraft({ type: Draft, current: group.rows[0], before: group.rows[0], entry: "g", row: 0, readiness, writable: true, text });
    expect(first).toMatchObject({ invalid: false, incomplete: false });
    expect(first.issues.size).toBe(0);
    // The entry's own presentation takes only the entry's issues — not a child row's.
    const whole = presentDraft({ type: GroupDraft, current: group, before: group, entry: "g", readiness: variant("incomplete", [{ entry: "g", row: none, field: some("id"), message: "Name it" }]), writable: true, text });
    expect(whole.issues.get("id")).toBe("⟦Name it");
});

test("each draft is marked for its OWN issues' kind — an incomplete entry stays incomplete beside an invalid one (#880)", () => {
    const a = liftDraft(Draft, { id: "a", qty: 1n });
    const b = liftDraft(Draft, { id: "b", qty: 2n });
    // One batch, one kind on the wire — but each issue raised with its own.
    const readiness: BatchReadiness = variant("invalid", [
        raiseIssue("invalid", { entry: "a", row: none, field: some("qty"), message: "Refused" }),
        raiseIssue("incomplete", { entry: "b", row: none, field: some("qty"), message: "Needs review" }),
    ]);
    expect(presentDraft({ type: Draft, current: a, before: a, entry: "a", readiness, writable: true, text })).toMatchObject({ invalid: true, incomplete: false });
    expect(presentDraft({ type: Draft, current: b, before: b, entry: "b", readiness, writable: true, text })).toMatchObject({ invalid: false, incomplete: true });
    // An issue raised without a kind — a host's, read back — takes its batch's.
    const hosts: BatchReadiness = variant("invalid", [{ entry: "b", row: none, field: some("qty"), message: "Refused upstream" }]);
    expect(presentDraft({ type: Draft, current: b, before: b, entry: "b", readiness: hosts, writable: true, text })).toMatchObject({ invalid: true });
});
