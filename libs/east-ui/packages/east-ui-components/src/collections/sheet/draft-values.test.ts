/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { expect, test } from "vitest";
import { ArrayType, BooleanType, IntegerType, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Sheet } from "@elaraai/east-ui/internal";
import { liftDraft, normalizeDraft } from "./draft-values.js";

const Row = StructType({ id: StringType, qty: IntegerType, enabled: BooleanType, text: StringType, tags: ArrayType(StringType), note: OptionType(StringType) });
const Draft = Sheet.Types.Draft(Row);
const value = { id: "a", qty: 0n, enabled: false, text: "", tags: [], note: none };

test("schema completeness accepts zero, false, empty strings, and empty arrays without an author callback", () => {
    expect(normalizeDraft(Draft, liftDraft(Draft, value), "a")).toEqual({ domain: value, readiness: variant("ready", null) });
});

test("every missing required field is reported, independently of visible columns", () => {
    const draft = {
        id: variant("value", "a"), qty: variant("missing", null), enabled: variant("missing", null),
        text: variant("missing", null), tags: variant("missing", null), note: variant("missing", null),
    };
    const checked = normalizeDraft(Draft, draft, "a");
    expect(checked.domain).toBeUndefined();
    expect(checked.readiness).toEqual(variant("incomplete", ["qty", "enabled", "text", "tags"].map(field => ({
        entry: "a", row: none, field: some(field), message: "A value is required",
    }))));
});

test("missing optional fields become none but malformed optional input is never discarded", () => {
    const draft = {
        id: variant("value", "a"), qty: variant("value", 0n), enabled: variant("value", false),
        text: variant("value", ""), tags: variant("value", []), note: variant("missing", null),
    };
    expect(normalizeDraft(Draft, draft, "a").domain).toEqual(value);
    const checked = normalizeDraft(Draft, { ...draft, note: variant("invalid", "unparsed") }, "a");
    expect(checked.domain).toBeUndefined();
    expect(checked.readiness).toEqual(variant("invalid", [{ entry: "a", row: none, field: some("note"), message: "Invalid input: unparsed" }]));
});
