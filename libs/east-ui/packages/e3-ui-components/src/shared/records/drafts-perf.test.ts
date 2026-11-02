/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The drafts benchmark (#1437) — `E3_UI_PERF=1`, never in CI: a timing on a
 * shared runner is no deterministic signal, and CI keeps `drafts.test.ts`'
 * proofs against what e3 keeps. Two rows a page would preview a change of,
 * each written through its record's patch door:
 *
 * - a ledger of eighteen measures, each read every day for three years, its
 *   subtotals kept by four rollups from the week to the year: a reading typed;
 * - a machine of 10,000 jobs: one job dragged to the next week.
 *
 * For each it records the time to preview the change, at the revision the
 * drafts began from, and again with the row read at a later one.
 *
 * Run: `E3_UI_PERF=1 pnpm exec vitest run src/shared/records/drafts-perf.test.ts`.
 */

import { describe, expect, test } from "vitest";
import { DateTimeType, East, SortedMap, StringType, compareFor, none, some, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { EditSession, getRegisteredPlatformImplementations, liftDraft, type EntryVersion } from "@elaraai/east-ui-components";
import { Data } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/fixtures/bind/data/data-drafts";
import * as nested from "@elaraai/e3-ui/fixtures/bind/data/data-nested";
import { e3Harness, settle } from "../../e3-web-mount.test-utils.js";
import { RecordDrafts, type RecordDraftsBinding } from "./drafts.js";

/** Whether the benchmark runs: `E3_UI_PERF=1`, as the Plan's series benchmark is asked for. */
const PERF = process.env["E3_UI_PERF"] === "1";

/** e3 with the records deployed — only for the benchmark. */
const h = PERF ? e3Harness({ "bind/data/data-drafts.fixtures": ex, "bind/data/data-nested.fixtures": nested }, { measure: false }) : undefined;

const keyOrder = compareFor(StringType);
const instantOrder = compareFor(DateTimeType);
const DAY = 86_400_000;
/** Monday 5 October 2026. */
const MONDAY = Date.UTC(2026, 9, 5);

/** A record as the fixtures declare it. */
type Rec = typeof ex.draftLedgers | typeof nested.nestedMachines;
/** A record's row. */
type RowOf<R extends Rec> = R extends { type: { value: infer V extends EastType } } ? ValueTypeOf<V> : never;

/** A record's binding, its runtimes installed and its revision heard. */
async function bound(fn: ReturnType<typeof East.function>): Promise<RecordDraftsBinding> {
    await h!.install({ fn });
    const binding = East.compile(fn, getRegisteredPlatformImplementations())() as unknown as RecordDraftsBinding;
    binding.revision();
    await settle();
    return binding;
}

/** The record's editing session at the revision the binding reads, with one row drafted from its row as e3 holds it to its draft. */
function drafted<R extends Rec>(record: R, binding: RecordDraftsBinding, id: string, before: RowOf<R>, after: RowOf<R>) {
    const row = record.type.value as never;
    const draftType = Editing.Types.Draft(row);
    const session = new EditSession<undefined>({
        sourceId: record.name, entryType: row, draftType, keyType: StringType, auto: false,
        apply: () => variant("applied", { revision: none }), patch: undefined, refresh: undefined,
    });
    const revision = binding.revision();
    if (revision.type !== "some") throw new Error("the binding's revision has not resolved");
    session.observeBase(variant("revision", revision.value));
    const version = (value: RowOf<R>): EntryVersion<undefined> => ({ draft: liftDraft(draftType, value), wire: undefined, place: some(variant("keyOrder", null)) });
    expect(session.record([{ id, before: version(before), after: version(after) }], "typed", "Edit")).toBe(true);
    return session;
}

/** A Dict with one key's value set, the rest as they are. */
function withEntry<V>(dict: ReadonlyMap<string, V>, key: string, value: V): SortedMap<string, V> {
    const next = new SortedMap<string, V>([...dict], keyOrder);
    next.set(key, value);
    return next;
}

/** Previews a drafted row: its time at the revision the drafts began from, and with the row read at a later one. */
async function timed(binding: RecordDraftsBinding, session: EditSession<undefined>, id: string, move: () => Promise<void>) {
    const drafts = new RecordDrafts(binding, session);
    const start = performance.now();
    const preview = drafts.preview().get(id);
    const atBase = Math.round(performance.now() - start);
    expect(preview?.state).toBe("previewed");
    await move();
    drafts.preview();
    await settle();
    const read = performance.now();
    const again = drafts.preview().get(id);
    const atLater = Math.round(performance.now() - read);
    expect(again?.state).toBe("previewed");
    return { atBase, atLater, changes: [...preview!.changes.values()].reduce((sum, ops) => sum + ops.size, 0) };
}

describe.skipIf(!PERF)("a record's drafts previewed over large rows (E3_UI_PERF=1; not a CI gate)", () => {
    test("a reading typed in a ledger of eighteen measures read daily for three years", async () => {
        const harness = h!;
        const readings = new SortedMap(Array.from({ length: 3 * 365 }, (_u, d) => [new Date(MONDAY + d * DAY), d / 10] as const), instantOrder);
        const big = {
            name: "Ledger big",
            measures: new SortedMap(Array.from({ length: 18 }, (_u, m) => [`m${String(m).padStart(2, "0")}`, { name: `Measure ${m}`, readings }] as const), keyOrder),
        };
        const writing = performance.now();
        await harness.patch(ex.draftLedgers, withEntry(await harness.read(ex.draftLedgers), "L-big", big));
        const writeMs = Math.round(performance.now() - writing);
        const binding = await bound(East.function([], undefined, () => Data.bindPaged(ex.draftLedgers, { indexes: ["draft_ledgers_by_name", "draft_ledgers_in_time"] })));
        const m07 = big.measures.get("m07")!;
        const typed = new SortedMap([...m07.readings], instantOrder);
        typed.set(new Date(MONDAY + 400 * DAY), 99.5);
        const session = drafted(ex.draftLedgers, binding, "L-big", big, { ...big, measures: withEntry(big.measures, "m07", { ...m07, readings: typed }) });
        const result = await timed(binding, session, "L-big", async () => {
            await harness.patch(ex.draftLedgers, withEntry(await harness.read(ex.draftLedgers), "L-1", { ...(await harness.read(ex.draftLedgers)).get("L-1")!, name: "Ledger 1, audited" }));
        });
        console.log(`[drafts perf] ledger of 18 measures x ${readings.size} days: written ${writeMs} ms; a typed reading previewed in ${result.atBase} ms ` +
            `(${result.changes} index changes), and with its row read at a later revision in ${result.atLater} ms`);
    }, 600_000);

    test("a job dragged on a machine of 10,000 jobs", async () => {
        const harness = h!;
        const machine = nested.nestedMachine(0);
        const job = [...machine.jobs.values()][0]!;
        const jobs = new SortedMap(Array.from({ length: 10_000 }, (_u, j) => {
            const start = new Date(MONDAY + j * 3_600_000);
            return [`J-${String(j).padStart(5, "0")}`, { ...job, start, end: new Date(start.getTime() + 2 * 3_600_000) }] as const;
        }), keyOrder);
        const big = { ...machine, name: "Machine big", jobs };
        const writing = performance.now();
        await harness.patch(nested.nestedMachines, withEntry(await harness.read(nested.nestedMachines), "M-big", big));
        const writeMs = Math.round(performance.now() - writing);
        const binding = await bound(East.function([], undefined, () => Data.bindPaged(nested.nestedMachines, { indexes: ["machines_by_site_status", "machines_in_time"] })));
        const dragged = jobs.get("J-05000")!;
        const moved = { ...dragged, start: new Date(dragged.start.getTime() + 7 * DAY), end: new Date(dragged.end.getTime() + 7 * DAY) };
        const session = drafted(nested.nestedMachines, binding, "M-big", big, { ...big, jobs: withEntry(jobs, "J-05000", moved) });
        const result = await timed(binding, session, "M-big", async () => {
            const machines = await harness.read(nested.nestedMachines);
            await harness.patch(nested.nestedMachines, withEntry(machines, "M-000", { ...machines.get("M-000")!, status: "idle" }));
        });
        console.log(`[drafts perf] machine of 10,000 jobs: written ${writeMs} ms; a dragged job previewed in ${result.atBase} ms ` +
            `(${result.changes} index changes), and with its row read at a later revision in ${result.atLater} ms`);
    }, 600_000);
});
