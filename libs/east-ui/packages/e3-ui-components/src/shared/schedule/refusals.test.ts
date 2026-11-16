/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The refusals holding a builder's Save, as an entry's panel reads them (#1525, #1541 U5): what a session refuses of
 * one entry while its drafts' readiness refuses them — any session, a Plan's rows' among them — the refusals of one
 * entry of a kind among a builder's own list, and an entry's refusals in words, each field by its form's label or
 * spelled out, as every builder's banner says them.
 */

import { describe, expect, test } from "vitest";
import { StringType, StructType, none, some, variant } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import type { BatchReadiness, EditIssue } from "@elaraai/east-ui-components";
import { refusalText, refusalsOfEntry, refusalsText, refusedFields, sessionEntryRefusals } from "./refusals.js";

/** An issue of an entry, naming a field or none. */
const issue = (entry: string, field: string | undefined, message: string): EditIssue =>
    ({ entry, row: none, field: field === undefined ? none : some(field), message });

/** A session as its readiness holds it. */
const holding = (readiness: BatchReadiness) => ({ readiness });

const crowded = issue("hall3", "jobs", "H3-P11 holds 5 jobs — at most 4");
const late = issue("hall3", undefined, "Due before it starts");
const other = issue("p03", "jobs", "H1-P03 holds 6 jobs — at most 4");

describe("sessionEntryRefusals (#1541, U5)", () => {
    test("a refusing session's issues naming the entry, in their order — none of another entry's", () => {
        expect(sessionEntryRefusals(holding(variant("invalid", [crowded, other, late])), "hall3")).toEqual([crowded, late]);
        expect(sessionEntryRefusals(holding(variant("incomplete", [other])), "p03")).toEqual([other]);
        expect(sessionEntryRefusals(holding(variant("invalid", [other])), "hall3")).toEqual([]);
    });

    test("a ready session, and no session, refuse nothing", () => {
        expect(sessionEntryRefusals(holding(variant("ready", null)), "hall3")).toEqual([]);
        expect(sessionEntryRefusals(undefined, "hall3")).toEqual([]);
    });
});

describe("refusalsOfEntry (#1525)", () => {
    test("of a builder's refusals, those of one entry of one kind, in their order, each as the builder holds it", () => {
        const refusals = [
            { kind: "duty", issue: crowded, title: "A. Morgan · Thu 9 Mar · Early" },
            { kind: "duty", issue: other, title: "B. Lee · Fri 10 Mar · Late" },
            { kind: "cover", issue: late, title: "hall3" },
            { kind: "duty", issue: late, title: "A. Morgan · Thu 9 Mar · Early" },
        ];
        expect(refusalsOfEntry(refusals, "duty", "hall3")).toEqual([refusals[0], refusals[3]]);
        expect(refusalsOfEntry(refusals, "cover", "hall3")).toEqual([refusals[2]]);
        expect(refusalsOfEntry(refusals, "duty", "nowhere")).toEqual([]);
    });
});

describe("an entry's refusals in words (#1525)", () => {
    /** A form whose `jobs` field is labelled `Jobs held`. */
    const form = Fields.specs(StructType({ jobs: StringType }), { jobs: Fields.text({ label: "Jobs held" }) });

    test("each refusal's field by its form's label, else spelled out where no form names it; a refusal naming none is its message", () => {
        expect(refusalText(crowded, form)).toBe("Jobs held: H3-P11 holds 5 jobs — at most 4");
        expect(refusalText(crowded, [])).toBe("Jobs: H3-P11 holds 5 jobs — at most 4");
        expect(refusalText(late, form)).toBe("Due before it starts");
    });

    test("the banner's words: each refusal's, in their order, `; ` between them — nothing for none", () => {
        expect(refusalsText([crowded, late], form)).toBe("Jobs held: H3-P11 holds 5 jobs — at most 4; Due before it starts");
        expect(refusalsText([crowded], [])).toBe("Jobs: H3-P11 holds 5 jobs — at most 4");
        expect(refusalsText([], form)).toBe("");
    });

    test("the fields they name ring with the app's words, each in its order", () => {
        const second = issue("hall3", "jobs", "One press is down");
        expect([...refusedFields([crowded, late, second])]).toEqual([["jobs", ["H3-P11 holds 5 jobs — at most 4", "One press is down"]]]);
        expect(refusedFields([late]).size).toBe(0);
    });
});
