/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Calendar's public JSX documentation mirrors the tested quickstart", () => {
    const root = new URL("../../../", import.meta.url);
    const source = readFileSync(new URL("src/calendar/index.ts", root), "utf8");
    const examples = readFileSync(new URL("test/calendar/calendar.examples.tsx", root), "utf8");
    const start = examples.indexOf("export const calendarQuickstart = example({");
    const fn = examples.indexOf("    fn: ", start);
    const end = examples.indexOf("\n});", fn);
    const expected = examples.slice(fn + "    fn: ".length, end).replace(/,$/, "").split("\n").map((line, i) => i === 0 ? line : line.slice(4)).join("\n") + ";";
    const doc = source.slice(source.indexOf(" * @example")).split("\n").map(line => line.replace(/^ \* ?/, "")).join("\n");
    assert.ok(doc.includes("const appointmentsCalendar = " + expected));
    assert.ok(doc.includes('import { Calendar, Record } from "@elaraai/e3-ui";'));
    assert.ok(readFileSync(new URL("test/calendar/calendar.spec.ts", root), "utf8").includes("calendarQuickstart: ex.calendarQuickstart"));
});
