/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A record Slice's window (#1344): written in one validated write that keeps
 * every choice an index takes beside it — and a preset that names no window
 * stays selected while the window moves, as a builder's navigation moves it.
 */
import { expect, test } from "vitest";
import { DateTimeType, StringType, decodeBeast2For, encodeBeast2For, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceConfigType, type RecordSliceBindType, type RecordSliceStateType } from "@elaraai/east-ui/internal";
import { recordSliceWindow, recordSliceWindowFits, setRecordSliceWindow } from "./range.js";

type Bind = ValueTypeOf<RecordSliceBindType>;
type State = ValueTypeOf<RecordSliceStateType>;
type Config = ValueTypeOf<RecordSliceConfigType>;

const text = printFor(StringType);
const time = printFor(DateTimeType);
const READY = variant("values", [text("Ready")]);
const JOB = variant("prefix", "J-1");
const FROM = new Date("2026-10-05T00:00:00Z");
const TO = new Date("2026-10-19T00:00:00Z");
const WINDOW = variant("range", { from: time(FROM), to: time(TO) });

/** Work orders by status then due, by due, and by job: a status holds a window beside it, a job's prefix none. */
const config: Config = decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)({
    fields: [
        { fieldId: "status", label: "Status", kind: "string", optional: false, multiple: true, set: false, values: [{ value: text("Ready"), label: "Ready" }], format: none },
        { fieldId: "due", label: "Due", kind: "datetime", optional: false, multiple: true, set: false, values: [], format: none },
        { fieldId: "job", label: "Job", kind: "string", optional: false, multiple: true, set: false, values: [], format: none },
    ],
    indexes: [
        { name: "by_status_due", fields: ["status", "due"], sets: new Set(), structured: false, interval: none, area: none },
        { name: "by_due", fields: ["due"], sets: new Set(), structured: false, interval: none, area: none },
        { name: "by_job", fields: ["job"], sets: new Set(), structured: false, interval: none, area: none },
    ],
    range: some("due"), search: ["job"],
    presets: [
        { id: "ready", name: "Ready", where: new Map([["status", READY]]) },
        { id: "jobs", name: "J-1 jobs", where: new Map([["job", JOB]]) },
        { id: "fortnight", name: "This fortnight", where: new Map([["due", WINDOW]]) },
    ],
}));

/** A record Slice holding `state`: what a window write reads and writes, nothing else of it called. */
function sliceOf(state: State): { slice: Bind; state: () => State } {
    let held = state;
    const slice = { key: "spec.window", config, sourceId: "orders", read: () => held, write: (next: State) => { held = next; return null; } } as unknown as Bind;
    return { slice, state: () => held };
}

test("a window keeps every choice an index takes beside it, and a preset that names no window stays selected", () => {
    const { slice, state } = sliceOf({ where: new Map([["status", READY]]), preset: some("ready"), resolution: none });
    expect(recordSliceWindowFits(slice)).toBe(true);
    setRecordSliceWindow(slice, FROM.getTime(), TO.getTime());
    expect(state().preset).toEqual(some("ready"));
    expect([...state().where.keys()]).toEqual(["status", "due"]);
    expect(state().where.get("due")).toEqual(WINDOW);
    expect(recordSliceWindow(slice)).toEqual({ kind: "datetime", min: FROM.getTime(), max: TO.getTime() });
    // Moved again, it holds still.
    setRecordSliceWindow(slice, TO.getTime(), TO.getTime() + 86_400_000);
    expect(state().preset).toEqual(some("ready"));
});

test("a window that replaces a choice no index takes beside it leaves the preset, and is no fit for a host's own sync", () => {
    const { slice, state } = sliceOf({ where: new Map([["job", JOB]]), preset: some("jobs"), resolution: none });
    expect(recordSliceWindowFits(slice)).toBe(false);
    setRecordSliceWindow(slice, FROM.getTime(), TO.getTime());
    expect(state().preset).toEqual(none);
    expect([...state().where.keys()]).toEqual(["due"]);
});

test("a preset that names the window is that window's: moving the window leaves it", () => {
    const { slice, state } = sliceOf({ where: new Map([["due", WINDOW]]), preset: some("fortnight"), resolution: none });
    setRecordSliceWindow(slice, TO.getTime(), TO.getTime() + 86_400_000);
    expect(state().preset).toEqual(none);
});

test("a source with no choices fits a window; one with no range has none to take", () => {
    expect(recordSliceWindowFits(sliceOf({ where: new Map(), preset: none, resolution: none }).slice)).toBe(true);
    const ranged = { ...config, range: none };
    const { slice } = sliceOf({ where: new Map(), preset: none, resolution: none });
    expect(recordSliceWindowFits({ ...slice, config: ranged } as Bind)).toBe(false);
});
