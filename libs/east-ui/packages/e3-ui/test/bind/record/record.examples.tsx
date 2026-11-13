/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, BooleanType, DictType, East, IntegerType, NullType, StringType, StructType, example } from "@elaraai/east";
import { Box, Button, Editing, HStack, Reactive, Stat, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Func, Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// The package-side record + mutation definitions. `Record.bind` takes the
// record def + its mutations — the state type, mutation names and arg types
// all come from them, so the binding can never drift from the deployed record.
export const counter = e3.record("counter", IntegerType, {
    initial: 0n,
    mutations: (mutation) => ({
        increment: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))),
        reset: mutation.reduce(East.function([IntegerType], IntegerType, (_$, _state) => 0n)),
        // What the record runtime's specs write beside them (#1378): a take off the
        // counter that refuses to leave it below zero, so a mutation fails as a
        // reducer's program does.
        take: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, (_$, state, n) =>
            East.less(state, n).ifElse(() => East.error("the counter holds fewer than that"), () => state.subtract(n)))),
    }),
});

export const recordBindMutate = example({
    keywords: ["Record", "bind", "mutate", "Reactive", "Button", "read", "pending", "status", "system of record"],
    description: "Bind an e3.record + its mutations; buttons apply typed mutations, a stat shows the current state, and the mutate lifecycle status is rendered",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const r = $.let(Record.bind(counter, ["increment", "reset"]));
            const status = $.let(r.mutate.status().getTag().upperCase());
            // Surface the failure detail so a failed mutation shows WHY, not just
            // that it failed.
            const detail = $.let(r.mutate.error().match({
                some: (_$, e) => e.message,
                none: _$ => East.str``,
            }));
            const bump = $.const(East.function([], NullType, $ => {
                $(r.mutate.increment(1n));
            }));
            const clear = $.const(East.function([], NullType, $ => {
                $(r.mutate.reset());
            }));
            // A mutation commits the record but does not propagate; `start`
            // launches the workspace dataflow so tasks consuming the record
            // recompute. Queued behind any in-flight mutation.
            const run = $.const(East.function([], NullType, $ => {
                $(r.start());
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Stat label="Counter" value={East.print(r.read())} />
                    <HStack gap="2">
                        <Button onClick={bump} loading={r.mutate.pending()}>Increment</Button>
                        <Button variant="outline" onClick={clear}>Reset</Button>
                        <Button variant="ghost" onClick={run}>Run downstream</Button>
                    </HStack>
                    <Text.MonoLabel>{status}</Text.MonoLabel>
                    <Text color="fg.muted">{detail}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const recordBindStatus = example({
    keywords: ["Record", "bind", "status", "error", "lifecycle", "mutate"],
    description: "Render the mutation lifecycle (idle / running / committed / failed / cancelled) and any failure",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const r = $.let(Record.bind(counter, ["increment"]));
            const bump = $.const(East.function([], NullType, $ => { $(r.mutate.increment(1n)); }));
            const statusLine = $.let(r.mutate.status().getTag().upperCase());
            const detail = $.let(r.mutate.error().match({
                some: (_$, e) => e.message,
                none: _$ => East.print(r.read()),
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Button onClick={bump} loading={r.mutate.pending()}>Increment</Button>
                    <Text.MonoLabel>{statusLine}</Text.MonoLabel>
                    <Text color="fg.muted">{detail}</Text>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// Whether the counter is within a limit (#1620). The function reads the
// counter, and lists it in `drafts`: a call may lay drafts of the counter's
// mutations over what it reads, so a page asks about an edit before it commits
// it.
export const withinLimitFn = e3.function("within_limit", {
    inputs: [counter],
    drafts: [counter],
    args: [IntegerType],
    output: BooleanType,
}, (_$, count, limit) => East.lessEqual(count, limit));

export const recordBindDraft = example({
    keywords: ["Record", "bind", "draft", "unsaved edit", "not committed", "what-if", "check before commit", "Func", "drafts", "FuncDraftType"],
    description: "A mutation as a draft: draft.<name> takes what mutate.<name> takes and commits nothing — a function that lists the record reads it with the draft laid over it, so a page asks about an edit before it commits it, and the record stays as saved",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const r = $.let(Record.bind(counter, ["increment"]));
            // `withinLimitFn` lists `drafts: [counter]`, so its call takes drafts after its arguments.
            const within = $.let(Func.bind(withinLimitFn));
            const ask = $.const(East.function([], NullType, $ => {
                // The arguments `r.mutate.increment` takes, not committed: nobody else sees the edit.
                $(within.call(10n, [r.draft.increment(25n)]));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Stat label="Counter, as saved" value={East.print(r.read())} />
                    <Stat label="Within 10 after 25 more" value={East.print(within.read())} />
                    <Button onClick={ask} loading={within.pending()}>Ask about 25 more</Button>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// A keyed record a Sheet edits — each job's key is its id — and its patch
// door, which every Save commits through.
export const JobType = StructType({ task: StringType, qty: IntegerType });
export const jobs = e3.record("jobs", DictType(StringType, JobType), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

// The records `Record.onApply`'s specs commit through beside the jobs (#1378),
// each through its patch door: jobs whose index refuses a quantity below zero,
// so a write fails as an index's program does; a page whose cells a layout
// edits inside its one entry; and a week whose groups and loose tasks a Sheet
// edits inside its entry.
export const checkedJobs = e3.record("checked_jobs", DictType(StringType, JobType), {
    initial: new Map(),
    indexes: (index) => ({
        checked_jobs_by_qty: index.key(East.function([StringType, JobType], IntegerType, (_$, _id, job) =>
            East.less(job.qty, 0n).ifElse(() => East.error("a job's quantity is never below zero"), () => job.qty))),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
export const CellType = StructType({ key: StringType, span: IntegerType });
export const PageType = StructType({ title: StringType, cells: ArrayType(CellType) });
export const layoutPages = e3.record("layout_pages", DictType(StringType, PageType), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
export const WeekLineType = StructType({ id: StringType, task: StringType });
export const WeekGroupType = StructType({ id: StringType, name: StringType, lines: ArrayType(WeekLineType) });
export const WeekEntryType = Editing.Types.Entry(WeekGroupType, "lines");
export const WeekType = StructType({ title: StringType, entries: ArrayType(WeekEntryType) });
export const plannedWeeks = e3.record("planned_weeks", DictType(StringType, WeekType), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

export const recordSheetApply = example({
    keywords: ["Record", "onApply", "Sheet", "Save", "patch", "commit", "conflict", "discard", "bindPaged", "editing", "system of record"],
    description: "A Sheet over a record: its rows paged from the record, each Save one commit through the record's patch door — a stale Save is a conflict naming the entry, and nothing is overwritten",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const rows = $.let(Data.bindPaged(jobs));
            const record = $.let(Record.bind(jobs));
            return (
                <Box height="360px">
                    <Sheet
                        data={rows}
                        columns={{
                            task: Sheet.column.text(JobType, { header: "Task", width: "220px" }),
                            qty:  Sheet.column.integer(JobType, { header: "Qty", width: "96px" }),
                        }}
                        onApply={Record.onApply(record)}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const recordBindHistory = example({
    keywords: ["Record", "bind", "history", "audit", "commit", "chain"],
    description: "Read the record's commit history (the audit trail) alongside its current value",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const r = $.let(Record.bind(counter, ["increment"]));
            const count = $.let(r.history().match({
                some: (_$, commits) => commits.size(),
                none: _$ => 0n,
            }));
            return (
                <VStack gap="3" align="stretch">
                    <Stat label="Counter" value={East.print(r.read())} />
                    <Text.MonoLabel>{East.str`${count} COMMITS`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
