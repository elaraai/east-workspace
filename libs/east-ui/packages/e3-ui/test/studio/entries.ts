/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the pages record's specs hold a write to (#1759): an entry with each
 * of its fields written out — never built by the write under test — and the
 * entry a write left compared with it whole, through East.
 */

import assert from "node:assert/strict";

import { SortedSet, StringType, compareFor, equalFor, none, printFor, variant, type ValueTypeOf } from "@elaraai/east";

import { Studio } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Page = ValueTypeOf<typeof Studio.Types.Page>;

const sameEntry = equalFor(Studio.Types.Entry);
const printEntry = printFor(Studio.Types.Entry);

/** Tags, as an entry holds them. */
export const tagged = (...tags: string[]): Entry["tags"] => new SortedSet(tags, compareFor(StringType));

/** A page as the record holds it, each field written out: what a write is held to. */
export const pageEntry = (key: Key, draft: Page, live: Entry["live"] = none, tags: Entry["tags"] = tagged()): Entry =>
    ({ kind: variant("page", null), project: key.project, title: draft.title, tags, draft, live });

/** A template as the record holds it, each field written out. */
export const templateEntry = (key: Key, layout: Page, tags: Entry["tags"] = tagged()): Entry =>
    ({ kind: variant("template", null), project: key.project, title: layout.title, tags, draft: layout, live: none });

/** Holds the entry a write left to the one expected, field for field. */
export function assertEntry(actual: Entry | undefined, expected: Entry, message?: string): void {
    if (actual === undefined) assert.fail(`${message ?? "the entry"}: the record holds none`);
    assert.ok(sameEntry(actual, expected), `${message ?? "the entry"}: got ${printEntry(actual)}, expected ${printEntry(expected)}`);
}
