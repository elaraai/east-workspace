/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pages record in e3 (#992): a solution declares `e3.record("pages",
 * Studio.Types.Pages, …)` and `e3.mutation.patch(pages)`, and every operator
 * action is one patch commit through it — a save (R1), a publish and a revert
 * (R3), a new page and a saved template (R8). A save drafted on a stale page
 * is a conflict, and nothing is overwritten (R2). A redeploy
 * that adds a component keeps the record as it is: no migration runs (R7).
 * The canvas's own Apply, `Studio.save`, commits and conflicts the same way
 * (B12, #995). The page library's new page and the builder's Save as template
 * are each one commit, and a name another write took first is refused in the
 * words their popovers show (D5, D7, #997).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";

import {
    AsyncFunctionType, East, FunctionType, OptionType, PatchType, SortedMap, StringType, StructType, compareFor, diffFor,
    encodeBeast2For, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import type { RecordPlan } from "@elaraai/e3-types";
import {
    LocalStorage, packageImport, recordHistory, recordMutate, summarizeDelta, workspaceCreate, workspaceDeploy, workspaceGetDataset,
    type TaskRunner,
} from "@elaraai/e3-core";
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from "@elaraai/e3-core/test";
import { Editing, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { RecordOutcomeType, Studio, StudioKeyType, StudioPagesType, ui } from "@elaraai/e3-ui";
import { RecordBindHandleType, nameWriteRefusal } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Pages = ValueTypeOf<typeof Studio.Types.Pages>;

const keys = compareFor(StudioKeyType);
const diffPages = diffFor(StudioPagesType);
const encodePatch = encodeBeast2For(PatchType(StudioPagesType));
const pagesPath = [variant("field", "records"), variant("field", "pages")];
/** The pages record, bound with its patch door — what the builder's canvas commits through. */
const HandleType = RecordBindHandleType(StudioPagesType, { patch: [PatchType(StudioPagesType)] });
/** The pages record as the page library and the builder's Save as template hold it: its read, and its patch awaited. */
const WriterType = StructType({
    read: FunctionType([], StudioPagesType),
    commit: StructType({ patch: AsyncFunctionType([StringType, PatchType(StudioPagesType)], RecordOutcomeType) }),
});

const publish = East.compile(Studio.publish, []);
const revert = East.compile(Studio.revert, []);
const newPage = East.compile(Studio.newPage, []);
const saveTemplate = East.compile(Studio.saveTemplate, []);

/** The patch door of a record with no index runs no program, so nothing may start one. */
const noProgram = { execute: async () => { throw new Error("the patch door ran a program"); } } as unknown as TaskRunner;

const OVERVIEW_KEY: Key = { project: "ops", page: "overview" };

/** A component the surface lists, and one a later deploy adds. */
const kpiRail = Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" },
    East.function([], UIComponentType, (_$) => Text.Root("KPIs")));
const revenueTrend = Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
    East.function([], UIComponentType, (_$) => Text.Root("Revenue")));

/** The pages record, holding the Overview — never published — and its one write. */
const pages = e3.record("pages", StudioPagesType, new SortedMap<Key, Entry>([
    [OVERVIEW_KEY, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "fp-trend" },
            ],
        },
        live: none,
    })],
], keys));
const pagesPatch = e3.mutation.patch(pages);

describe("the pages record in e3 (#992)", () => {
    let repo: string;
    let tempDir: string;
    let storage: LocalStorage;

    beforeEach(async () => {
        repo = createTestRepo();
        tempDir = createTempDir();
        storage = new LocalStorage(dirname(repo));
        const surface = ui("studio", [], East.function([], UIComponentType, ($) => {
            const components = $.let([kpiRail]);
            return Studio.dispatch(components, "kpi_rail");
        }));
        const zip = join(tempDir, "studio-1.0.0.zip");
        await e3.export(e3.package("studio", "1.0.0", pages, pagesPatch, surface), zip);
        await packageImport(storage, repo, zip);
        await workspaceCreate(storage, repo, "main");
        await workspaceDeploy(storage, repo, "main", "studio", "1.0.0");
    });

    afterEach(() => {
        removeTestRepo(repo);
        removeTempDir(tempDir);
    });

    /** The record as it stands. */
    const current = async (): Promise<Pages> => await workspaceGetDataset(storage, repo, "main", pagesPath) as Pages;
    /** One patch through the record's patch door, by an actor. */
    const commit = (patch: unknown, actor: string) =>
        recordMutate(storage, noProgram, repo, "main", "pages", "patch", [encodePatch(patch as never)], { actor });

    it("R1: a save is one commit on the page, with its actor, its time and its delta", async () => {
        const before = (await current()).get(OVERVIEW_KEY)!;
        if (before.type !== "page") assert.fail("expected a page");
        // The canvas's Apply: the page alone, before and after its draft's cells changed.
        const after: Entry = variant("page", {
            draft: { ...before.value.draft, cells: [{ ...before.value.draft.cells[0]!, span: 8n }, before.value.draft.cells[1]!] },
            live: before.value.live,
        });
        const saved = await commit(diffPages(new SortedMap([[OVERVIEW_KEY, before]], keys), new SortedMap([[OVERVIEW_KEY, after]], keys)), "ana");
        assert.equal(saved.kind, "committed");

        const history = await recordHistory(storage, repo, "main", "pages");
        assert.equal(history.length, 2, "the deploy's commit, and the save's one");
        const head = history[0]!.commit;
        assert.equal(head.mutation, "patch");
        assert.equal(head.actor, "ana");
        assert.ok(Math.abs(head.at.getTime() - Date.now()) < 60_000, "committed just now");
        if (head.delta.type !== "some") assert.fail("the save's commit carries its delta");
        assert.deepEqual(await summarizeDelta(storage, repo, head.delta.value), [{ target: "primary", insert: 0, update: 1, delete: 0 }]);
        assert.deepEqual((await current()).get(OVERVIEW_KEY), after);
    });

    it("R2: a save drafted before another landed is a conflict, and the other stands", async () => {
        const before = (await current()).get(OVERVIEW_KEY)!;
        if (before.type !== "page") assert.fail("expected a page");
        const first: Entry = variant("page", {
            draft: { ...before.value.draft, cells: [before.value.draft.cells[0]!, { ...before.value.draft.cells[1]!, span: 6n }] },
            live: before.value.live,
        });
        const second: Entry = variant("page", {
            draft: { ...before.value.draft, cells: [before.value.draft.cells[0]!, { ...before.value.draft.cells[1]!, span: 10n }] },
            live: before.value.live,
        });
        assert.equal((await commit(diffPages(new SortedMap([[OVERVIEW_KEY, before]], keys), new SortedMap([[OVERVIEW_KEY, first]], keys)), "ana")).kind, "committed");
        const stale = await commit(diffPages(new SortedMap([[OVERVIEW_KEY, before]], keys), new SortedMap([[OVERVIEW_KEY, second]], keys)), "ben");
        if (stale.kind !== "conflict") assert.fail(`expected a conflict, got ${stale.kind}`);

        assert.deepEqual((await current()).get(OVERVIEW_KEY), first, "the first save stands");
        assert.deepEqual((await recordHistory(storage, repo, "main", "pages")).map((entry) => entry.commit.actor)[0], "ana", "the refused save made no commit");
    });

    it("R3: a publish and a revert are one commit each, exact, and the version counts up from 1", async () => {
        assert.equal((await commit(publish(await current(), OVERVIEW_KEY), "ana")).kind, "committed");
        const published = (await current()).get(OVERVIEW_KEY)!;
        if (published.type !== "page" || published.value.live.type !== "some") assert.fail("expected a published page");
        assert.equal(published.value.live.value.version, 1n);
        assert.deepEqual(published.value.live.value.page, published.value.draft);

        // A save, then a revert back to version 1's layout.
        const edited: Entry = variant("page", {
            draft: { ...published.value.draft, cells: published.value.draft.cells.slice(1) },
            live: published.value.live,
        });
        assert.equal((await commit(diffPages(new SortedMap([[OVERVIEW_KEY, published]], keys), new SortedMap([[OVERVIEW_KEY, edited]], keys)), "ana")).kind, "committed");
        assert.equal((await commit(revert(await current(), OVERVIEW_KEY), "ben")).kind, "committed");
        assert.deepEqual((await current()).get(OVERVIEW_KEY), published, "the draft is version 1's layout again");

        assert.equal((await commit(publish(await current(), OVERVIEW_KEY), "ben")).kind, "committed");
        const again = (await current()).get(OVERVIEW_KEY)!;
        if (again.type !== "page" || again.value.live.type !== "some") assert.fail("expected a published page");
        assert.equal(again.value.live.value.version, 2n);

        const history = await recordHistory(storage, repo, "main", "pages");
        assert.deepEqual(history.map((entry) => entry.commit.actor), ["ben", "ben", "ana", "ana", history.at(-1)!.commit.actor], "one commit each");
    });

    it("B12 (#995): the canvas's Apply — Studio.save — is one patch commit on the page, and one drafted before another landed is a conflict that leaves the first standing", async () => {
        const Cell = Studio.Types.Cell;
        const entryPatch = diffFor(OptionType(Cell));
        const save = East.compileAsync(East.asyncFunction([HandleType, Editing.Types.ChangeSet(Cell)], Editing.Types.ApplyResult, ($, record, batch) => {
            const apply = $.const(Studio.save(record, OVERVIEW_KEY));
            return apply(batch);
        }), []) as unknown as (handle: unknown, batch: unknown) => Promise<ValueTypeOf<typeof Editing.Types.ApplyResult>>;
        const read = await current();
        const overview = read.get(OVERVIEW_KEY)!;
        if (overview.type !== "page") assert.fail("expected a page");
        const cells = overview.value.draft.cells;
        // The bound record over the repository: its read is what the canvas
        // read, and its patch door commits through e3, as the ui task's would.
        const handle = {
            read: () => read,
            status: () => variant("up-to-date", null),
            history: () => none,
            mutate: { pending: () => false, status: () => variant("idle", null), error: () => none, cancel: () => null, patch: () => null },
            commit: {
                patch: async (_requestId: string, patch: unknown) => {
                    const outcome = await commit(patch, "ana");
                    switch (outcome.kind) {
                        case "committed": return variant("committed", { commitHash: outcome.commitHash, stateHash: outcome.stateHash });
                        case "conflict": return variant("conflict", { attempts: BigInt(outcome.attempts), detail: outcome.detail === undefined ? none : some(outcome.detail) });
                        case "invalid": return variant("invalid", { message: outcome.message });
                        case "failed": return variant("failed", { exitCode: BigInt(outcome.exitCode), stderr: outcome.stderr });
                        case "timed_out": return variant("timed_out", { ms: BigInt(outcome.ms), stderr: outcome.stderr });
                    }
                },
            },
            start: () => null,
            binding: { name: "pages", mutations: ["patch"] },
        };

        // The trend resized to 6 over the cells the canvas read: one commit.
        const applied = await save(handle, {
            requestId: "resize-6", base: variant("snapshot", [...cells]), label: "Resize Revenue trend",
            changes: [{ id: "c-trend", patch: entryPatch(some(cells[1]!), some({ ...cells[1]!, span: 6n })), place: none }],
        });
        assert.equal(applied.type, "applied");
        const history = await recordHistory(storage, repo, "main", "pages");
        assert.deepEqual(history.map((entry) => [entry.commit.mutation, entry.commit.actor]).slice(0, 1), [["patch", "ana"]]);
        const saved = (await current()).get(OVERVIEW_KEY)!;
        if (saved.type !== "page") assert.fail("expected a page");
        assert.deepEqual(saved.value.draft.cells.map((c) => [c.key, c.span]), [["c-kpi", 12n], ["c-trend", 6n]]);

        // A canvas still holding the cells it read before that save resizes
        // the trend to 10: its Apply reaches e3, which refuses it, and the
        // first save stands.
        const stale = await save(handle, {
            requestId: "resize-10", base: variant("snapshot", [...cells]), label: "Resize Revenue trend",
            changes: [{ id: "c-trend", patch: entryPatch(some(cells[1]!), some({ ...cells[1]!, span: 10n })), place: none }],
        });
        assert.equal(stale.type, "conflict");
        assert.deepEqual((stale.value as { message: string }[]).map((issue) => issue.message), ["The entry changed since this edit began"]);
        const after = (await current()).get(OVERVIEW_KEY)!;
        if (after.type !== "page") assert.fail("expected a page");
        assert.deepEqual(after.value.draft.cells.map((c) => c.span), [12n, 6n]);
        assert.equal((await recordHistory(storage, repo, "main", "pages")).length, history.length, "the refused save made no commit");
    });

    it("R8: a saved template and a new page from it are one commit each", async () => {
        const templateKey: Key = { project: "ops", page: "tpl-overview" };
        const detailKey: Key = { project: "ops", page: "detail" };
        assert.equal((await commit(saveTemplate(await current(), OVERVIEW_KEY, templateKey, "Overview layout"), "ana")).kind, "committed");
        assert.equal((await commit(newPage(await current(), detailKey, "Detail", some(templateKey)), "ana")).kind, "committed");

        const now = await current();
        const template = now.get(templateKey)!;
        const detail = now.get(detailKey)!;
        if (template.type !== "template" || detail.type !== "page") assert.fail("expected a template and a page");
        assert.deepEqual(detail.value, { draft: { title: "Detail", cells: template.value.cells }, live: none });
        assert.equal((await recordHistory(storage, repo, "main", "pages")).length, 3, "the deploy's commit and one each");
    });

    it("D5, D7 (#997): Save as template and a new page from it are one commit each, as the builder and the page library write them; a name another write took first is refused in their popovers' words", async () => {
        // The builder's Save as template and the page library's Create, over
        // what the screen read: one patch commit, and what refused it.
        const saveAs = East.compileAsync(East.asyncFunction([WriterType, StringType], OptionType(StringType), ($, record, name) => {
            const outcome = $.let(record.commit.patch("", Studio.saveTemplate(record.read(), OVERVIEW_KEY, { project: "ops", page: name }, name)));
            return nameWriteRefusal(outcome, name);
        }), []) as unknown as (handle: unknown, name: string) => Promise<ValueTypeOf<OptionType<typeof StringType>>>;
        const create = East.compileAsync(East.asyncFunction([WriterType, StringType, OptionType(StringType)], OptionType(StringType), ($, record, name, template) => {
            const from = $.let(template.match({
                some: (_$2, found) => East.value(some({ project: "ops", page: found }), OptionType(StudioKeyType)),
                none: (_$2) => East.value(none, OptionType(StudioKeyType)),
            }), OptionType(StudioKeyType));
            const outcome = $.let(record.commit.patch("", Studio.newPage(record.read(), { project: "ops", page: name }, name, from)));
            return nameWriteRefusal(outcome, name);
        }), []) as unknown as (handle: unknown, name: string, template: ValueTypeOf<OptionType<typeof StringType>>) => Promise<ValueTypeOf<OptionType<typeof StringType>>>;
        // The record over the repository, its read what the screen last read.
        let read = await current();
        const handle = {
            read: () => read,
            commit: {
                patch: async (_requestId: string, patch: unknown) => {
                    const outcome = await commit(patch, "ana");
                    switch (outcome.kind) {
                        case "committed": return variant("committed", { commitHash: outcome.commitHash, stateHash: outcome.stateHash });
                        case "conflict": return variant("conflict", { attempts: BigInt(outcome.attempts), detail: outcome.detail === undefined ? none : some(outcome.detail) });
                        case "invalid": return variant("invalid", { message: outcome.message });
                        case "failed": return variant("failed", { exitCode: BigInt(outcome.exitCode), stderr: outcome.stderr });
                        case "timed_out": return variant("timed_out", { ms: BigInt(outcome.ms), stderr: outcome.stderr });
                    }
                },
            },
        };

        assert.deepEqual(await saveAs(handle, "Overview template"), none, "D7: saved");
        const stale = read;
        read = await current();
        assert.deepEqual(await create(handle, "Q3 review", some("Overview template")), none, "D5: made");
        const now = await current();
        const template = now.get({ project: "ops", page: "Overview template" })!;
        const overview = now.get(OVERVIEW_KEY)!;
        if (template.type !== "template" || overview.type !== "page") assert.fail("expected a template and a page");
        assert.deepEqual(template.value, { title: "Overview template", cells: overview.value.draft.cells }, "the page as last saved");
        assert.deepEqual(now.get({ project: "ops", page: "Q3 review" }), variant("page", { draft: { title: "Q3 review", cells: overview.value.draft.cells }, live: none }));
        const history = await recordHistory(storage, repo, "main", "pages");
        assert.deepEqual(history.map((entry) => entry.commit.mutation).slice(0, 2), ["patch", "patch"], "one commit each");

        // Screens still holding what they read before those writes landed.
        read = stale;
        assert.deepEqual(await saveAs(handle, "Overview template"), some("Another write took the name Overview template first — choose another"));
        assert.deepEqual(await create(handle, "Q3 review", none), some("Another write took the name Q3 review first — choose another"));
        assert.equal((await recordHistory(storage, repo, "main", "pages")).length, history.length, "the refused writes made no commit");
        assert.deepEqual((await current()).get({ project: "ops", page: "Q3 review" }), now.get({ project: "ops", page: "Q3 review" }), "the first write stands");
    });

    it("R7: a redeploy that adds a component keeps the record as it is — no migration runs", async () => {
        assert.equal((await commit(publish(await current(), OVERVIEW_KEY), "ana")).kind, "committed");
        const before = await recordHistory(storage, repo, "main", "pages");

        const surface = ui("studio", [], East.function([], UIComponentType, ($) => {
            const components = $.let([kpiRail, revenueTrend]);
            return Studio.dispatch(components, "kpi_rail");
        }));
        const zip = join(tempDir, "studio-1.0.1.zip");
        await e3.export(e3.package("studio", "1.0.1", pages, pagesPatch, surface), zip);
        await packageImport(storage, repo, zip);
        const plans: RecordPlan[] = [];
        await workspaceDeploy(storage, repo, "main", "studio", "1.0.1", { onRecordPlan: (plan) => plans.push(plan) });

        // The record keeps its type, so the deploy keeps it: it notes the new
        // package in a commit of its own, and the state is the one it held.
        assert.deepEqual(plans.map((plan) => plan.action), [variant("keep", { deploy: true })]);
        const after = await recordHistory(storage, repo, "main", "pages");
        assert.deepEqual([after[0]!.commit.mutation, after[0]!.commit.actor], ["$deploy", "system:deploy"]);
        assert.equal(after[0]!.commit.state, before[0]!.commit.state, "the record holds the state it held");
        assert.deepEqual(after.slice(1).map((entry) => entry.hash), before.map((entry) => entry.hash), "on the chain it had");
    });
});
