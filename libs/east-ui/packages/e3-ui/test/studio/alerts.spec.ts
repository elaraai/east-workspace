/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's alerts (#1674): what a check does to an alert's firing —
 * every firing an alert can hold, against rows that meet it and none — and
 * the writes: a Save, a pause, a delete and a firing are each one patch by
 * the alert's name, through a record that applies it as e3 does; one drafted
 * over an alert another write changed is refused naming it, and the other
 * stands.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, East, FloatType, OptionType, StringType, StructType, applyFor, decodeBeast2, diffFor, encodeBeast2For, equalFor, none, parseJq, some, variant,
    type JqNode, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";

import { Studio, StudioAlertsType, studioAlertOpenedKey } from "@elaraai/e3-ui/internal";

type Alert = ValueTypeOf<typeof Studio.Types.Alert>;
type Alerts = ValueTypeOf<typeof Studio.Types.Alerts>;
type Firing = ValueTypeOf<typeof Studio.Types.AlertFiring>;
type Result = ValueTypeOf<typeof Editing.Types.ApplyResult>;

const firingOf = East.compile(Studio.alertFiring, []);
const save = East.compileAsync(Studio.saveAlerts, []) as unknown as (handle: unknown, batch: unknown) => Promise<Result>;
const applyAlerts = applyFor(StudioAlertsType);
const alertPatch = diffFor(OptionType(Studio.Types.Alert));
const sameAlerts = equalFor(StudioAlertsType);

/** A visual's rows, as a check finds them. */
const RowType = ArrayType(StructType({ region: StringType, revenue: FloatType }));
const rowsBlob = encodeBeast2For(RowType);

/** The rows of South Australia, over the line. */
const MET = { count: 1n, rows: rowsBlob([{ region: "SA", revenue: 170 }]) };
/** No row over the line. */
const NONE_MET = { count: 0n, rows: rowsBlob([]) };

const FIRED_AT = new Date("2026-09-01T08:00:00Z");
const CHECKED_AT = new Date("2026-09-15T12:00:00Z");

/** Firing since the first of September: Victoria's rows met it then. */
const FIRING: Firing = { at: FIRED_AT, count: 2n, rows: rowsBlob([{ region: "VIC", revenue: 90 }, { region: "WA", revenue: 80 }]), cleared: none };
/** The same, cleared on the tenth. */
const CLEARED: Firing = { ...FIRING, cleared: some(new Date("2026-09-10T08:00:00Z")) };

/** A jq condition over one row, parsed. */
function jq(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") assert.fail(`does not parse: ${text}`);
    return parsed.program.value;
}

/** An alert on the Visuals page's revenue by region: a region over 100. */
const OVER: Alert = {
    page: { project: "Sales desk", page: "Visuals" }, cell: "v-regions", condition: jq(".revenue > 100"),
    filters: [{ source: "orders", where: jq(`.ordered_at >= "2026-07-01" and .ordered_at < "2026-10-01"`), from: none }],
    paused: false, firing: none,
};

describe("alertFiring (#1674)", () => {
    test("an alert never fired fires once rows meet it: at the check's instant, with how many and which", () => {
        assert.deepEqual(firingOf(none, MET, CHECKED_AT), variant("fired", { at: CHECKED_AT, count: 1n, rows: MET.rows, cleared: none }));
    });

    test("an alert never fired, that no row meets, is as it was", () => {
        assert.deepEqual(firingOf(none, NONE_MET, CHECKED_AT), variant("unchanged", null));
    });

    test("a firing alert stays as it fired while rows meet it: it fires once until it clears", () => {
        assert.deepEqual(firingOf(some(FIRING), MET, CHECKED_AT), variant("unchanged", null));
    });

    test("a firing alert clears once no row meets it, stamped with the check's instant, what fired kept", () => {
        assert.deepEqual(firingOf(some(FIRING), NONE_MET, CHECKED_AT), variant("cleared", { ...FIRING, cleared: some(CHECKED_AT) }));
    });

    test("a cleared alert fires again once rows meet it: the new firing replaces the cleared one", () => {
        assert.deepEqual(firingOf(some(CLEARED), MET, CHECKED_AT), variant("fired", { at: CHECKED_AT, count: 1n, rows: MET.rows, cleared: none }));
    });

    test("a cleared alert that no row meets is as it was", () => {
        assert.deepEqual(firingOf(some(CLEARED), NONE_MET, CHECKED_AT), variant("unchanged", null));
    });

    test("a firing's rows are self-describing: they decode to the rows that met it, with their type", () => {
        const step = firingOf(none, MET, CHECKED_AT);
        if (step.type !== "fired") assert.fail(`expected it to fire, got ${step.type}`);
        const decoded = decodeBeast2(step.value.rows);
        assert.deepEqual(decoded.value, [{ region: "SA", revenue: 170 }]);
    });
});

/**
 * The alerts record in memory, as e3 holds it and `Record.bind` reads it: its
 * read is what the screen last read, and its patch door applies each patch to
 * the record as it stands — refusing one that no longer applies, as e3's
 * check does, and reading the record again before it answers, as a bound
 * record does on a conflict.
 */
function recordOf(initial: Alerts) {
    let state = initial;
    let read = initial;
    const commits: unknown[] = [];
    return {
        /** The record as it stands. */
        state: () => state,
        /** The screen reads the record again. */
        reread: () => { read = state; },
        commits,
        handle: {
            read: () => read,
            history: () => none,
            commit: {
                patch: async (_requestId: string, patch: unknown) => {
                    try {
                        state = applyAlerts(state, patch as never);
                    } catch (err) {
                        read = state;
                        return variant("conflict", { attempts: 1n, detail: some(err instanceof Error ? err.message : String(err)) });
                    }
                    commits.push(patch);
                    return variant("committed", { commitHash: `c${commits.length}`, stateHash: `s${commits.length}` });
                },
            },
        },
    };
}

/** A batch of one write to an alert, by its name: what it was as the edit began, and what it is now. */
function batchOf(name: string, before: Alert | undefined, after: Alert | undefined) {
    return {
        requestId: `${name}-${after === undefined ? "delete" : "save"}`, base: variant("snapshot", before === undefined ? [] : [before]), label: "Save alert",
        changes: [{ id: name, patch: alertPatch(before === undefined ? none : some(before), after === undefined ? none : some(after)), place: none }],
    };
}

describe("saveAlerts (#1674)", () => {
    test("a new alert's Save is one patch on the record, under its name", async () => {
        const record = recordOf(new Map());
        assert.equal((await save(record.handle, batchOf("Region over 100", undefined, OVER))).type, "applied");
        assert.equal(record.commits.length, 1);
        assert.ok(sameAlerts(record.state(), new Map([["Region over 100", OVER]])));
    });

    test("a pause, a firing and a delete are one patch each, by the alert's name", async () => {
        const record = recordOf(new Map([["Region over 100", OVER]]));
        const paused = { ...OVER, paused: true };
        assert.equal((await save(record.handle, batchOf("Region over 100", OVER, paused))).type, "applied");
        record.reread();
        const fired = { ...paused, firing: some(FIRING) };
        assert.equal((await save(record.handle, batchOf("Region over 100", paused, fired))).type, "applied");
        assert.ok(sameAlerts(record.state(), new Map([["Region over 100", fired]])));
        record.reread();
        assert.equal((await save(record.handle, batchOf("Region over 100", fired, undefined))).type, "applied");
        assert.equal(record.state().size, 0);
        assert.equal(record.commits.length, 3);
    });

    test("a write drafted over an alert another write changed since is refused naming it, and the other stands", async () => {
        const record = recordOf(new Map([["Region over 100", OVER]]));
        // One reader pauses it; another, still holding it as it was, deletes it.
        const paused = { ...OVER, paused: true };
        assert.equal((await save(record.handle, batchOf("Region over 100", OVER, paused))).type, "applied");
        const stale = await save(record.handle, batchOf("Region over 100", OVER, undefined));
        if (stale.type !== "conflict") assert.fail(`expected a conflict, got ${stale.type}`);
        assert.deepEqual(stale.value.map((issue) => issue.entry), ["Region over 100"]);
        assert.ok(sameAlerts(record.state(), new Map([["Region over 100", paused]])), "the pause stands");
        assert.equal(record.commits.length, 1, "the refused write made no commit");
    });

    test("a new alert under a name another write took first is refused naming it", async () => {
        const record = recordOf(new Map());
        assert.equal((await save(record.handle, batchOf("Region over 100", undefined, OVER))).type, "applied");
        const second = await save(record.handle, batchOf("Region over 100", undefined, { ...OVER, condition: jq(".revenue > 150") }));
        if (second.type !== "conflict") assert.fail(`expected a conflict, got ${second.type}`);
        assert.deepEqual(second.value.map((issue) => issue.entry), ["Region over 100"]);
        assert.ok(sameAlerts(record.state(), new Map([["Region over 100", OVER]])), "the first alert stands");
    });
});

describe("the Studio's alerts types (#1674)", () => {
    test("the record holds every alert by its name, and a page keeps the alert it was opened for under its own key", () => {
        assert.equal(Studio.Types.Alerts.type, "Dict");
        assert.equal(studioAlertOpenedKey({ project: "Sales desk", page: "Visuals" }), `studio.alert.(project="Sales desk", page="Visuals")`);
    });
});
