/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A row's tags as a popover's form edits them (#1758, #1762): the type both
 * records hold their tags at, and the form whose one field they are.
 */

import { describe, test, expect } from "vitest";
import { isTypeEqual } from "@elaraai/east";
import { SavedQueryType, StudioEntryType } from "@elaraai/e3-ui/internal";
import { TagsFormType, TagsType } from "./tags-form.js";

describe("a row's tags as a form edits them (#1758, #1762)", () => {
    test("the tags are the type a saved query and a page hold theirs at, and the form's one field is them", () => {
        expect([isTypeEqual(TagsType, SavedQueryType.fields.tags), isTypeEqual(TagsType, StudioEntryType.fields.tags)]).toEqual([true, true]);
        expect(Object.keys(TagsFormType.fields)).toEqual(["tags"]);
        expect(isTypeEqual(TagsFormType.fields.tags, TagsType)).toBe(true);
    });
});
