/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { BooleanType, East, NullType, none, some, variant, type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { DragEventType, Gantt, Text, Badge, Table, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./gantt.examples.js";

describeEast("Gantt", (test) => {
    Assert.examples(test, {
        ganttBasic: ex.ganttBasic,
        ganttVariants: ex.ganttVariants,
        ganttReactiveDrag: ex.ganttReactiveDrag,
        ganttReview: ex.ganttReview,
        ganttLibraryDnd: ex.ganttLibraryDnd,
    });

    test("ganttVariants is the live configurator", $ => {
        // The preset / variant / density / row-height tables live inside the
        // Reactive body, which TestImpl does not execute, so they cannot be
        // asserted from here; `Assert.examples` above still compiles and
        // evaluates the outer function. Style / axis shape coverage lives in
        // the Gantt.Root tests below, which construct each configuration
        // directly.
        const panel = $.const(ex.ganttVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Time axis
    // =========================================================================

    test("axis config carries range, format, and tier", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "A", start: new Date("2024-02-01"), end: new Date("2024-03-01") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            { axis: { range: { min: new Date("2024-01-01"), max: new Date("2024-12-31") }, format: "MMM", tier: "month" } },
        ));
        const axis = $.let(gantt.unwrap().unwrap("Gantt").axis.unwrap("some"));
        $(Assert.equal(axis.range.unwrap("some").min, new Date("2024-01-01")));
        $(Assert.equal(axis.format.unwrap("some"), "MMM"));
        $(Assert.equal(axis.tier.unwrap("some").hasTag("month"), true));
    });

    test("axis is none when omitted", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "A", start: new Date("2024-02-01"), end: new Date("2024-03-01") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
        ));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").axis.hasTag("none"), true));
    });

    // =========================================================================
    // Basic Gantt Creation
    // =========================================================================

    test("creates gantt with array of field names", $ => {
        const gantt = $.let(Gantt.Root(
            [
                { name: "Design", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                { name: "Development", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
            ],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        $(Assert.equal(gantt.unwrap().getTag(), "Gantt"));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").columns.size(), 1n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.size(), 2n));
    });

    test("creates gantt with object column config", $ => {
        const gantt = $.let(Gantt.Root(
            [
                { name: "Design", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
            ],
            {
                name: { header: "Task" },
                owner: { header: "Owner" },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").columns.size(), 2n));
    });

    // =========================================================================
    // Task Events
    // =========================================================================

    test("creates task with start and end dates", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Task 1", start: new Date("2024-01-01"), end: new Date("2024-01-31") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        const tasks = gantt.unwrap().unwrap("Gantt").rows.get(0n).tasks;
        $(Assert.equal(tasks.size(), 1n));
    });

    test("creates task with label", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Design", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end, label: "Design Phase" })] })
        ));

        const task = gantt.unwrap().unwrap("Gantt").rows.get(0n).tasks.get(0n);
        $(Assert.equal(task.label.unwrap("some").value, "Design Phase"));
    });

    test("creates task with progress", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Development", start: new Date("2024-01-01"), end: new Date("2024-02-01") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end, progress: 0.75 })] })
        ));

        const task = gantt.unwrap().unwrap("Gantt").rows.get(0n).tasks.get(0n);
        $(Assert.equal(task.progress.unwrap("some"), 0.75));
    });

    test("creates task with the shared lifecycle state + risk status (#262)", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Testing", start: new Date("2024-02-01"), end: new Date("2024-02-15") }],
            ["name"],
            // The old status:"atRisk" migrates to the two-axis grammar:
            // lifecycle state (here a model proposal) + risk tint danger.
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end, state: "model", status: "danger" })] })
        ));

        const task = gantt.unwrap().unwrap("Gantt").rows.get(0n).tasks.get(0n);
        $(Assert.equal(task.state.unwrap("proposed").hasTag("model"), true));
        $(Assert.equal(task.status.unwrap("some").hasTag("danger"), true));
    });

    test("task state defaults to committed with no risk status", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Testing", start: new Date("2024-02-01"), end: new Date("2024-02-15") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        const task = gantt.unwrap().unwrap("Gantt").rows.get(0n).tasks.get(0n);
        $(Assert.equal(task.state.hasTag("committed"), true));
        $(Assert.equal(task.status.hasTag("none"), true));
    });

    test("review chrome + row accessors encode via the shared contract (#263)", $ => {
        const onApprove = $.const(East.function([Gantt.Types.ApproveEvent], NullType, _$ => null));
        const gantt = $.let(Gantt.Root(
            [
                { name: "A", flagged: false, start: new Date("2024-01-01"), end: new Date("2024-01-10") },
                { name: "B", flagged: true, start: new Date("2024-01-05"), end: new Date("2024-01-15") },
            ],
            ["name"],
            row => ({
                tasks: [Gantt.Task({ start: row.start, end: row.end, state: "model" })],
                status: row.flagged.ifElse(() => some(variant("warning", null)), () => none),
                approval: row.flagged.ifElse(() => some(variant("pending", null)), () => some(variant("approved", null))),
            }),
            { review: { onApprove, onApproveAll: East.function([], NullType, _$ => null) } },
        ));
        const root = $.let(gantt.unwrap().unwrap("Gantt"));

        const review = $.let(root.review.unwrap("some"));
        $(Assert.equal(review.columnLabel, "Decision"));
        $(Assert.equal(review.rerunLabel, "Rerun"));
        $(Assert.equal(review.onApprove.hasTag("some"), true));
        $(Assert.equal(review.onReject.hasTag("none"), true));
        $(Assert.equal(review.onApproveAll.hasTag("some"), true));
        $(Assert.equal(root.rows.get(0n).status.hasTag("none"), true));
        $(Assert.equal(root.rows.get(0n).approval.unwrap("some").hasTag("approved"), true));
        $(Assert.equal(root.rows.get(1n).status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(root.rows.get(1n).approval.unwrap("some").hasTag("pending"), true));
    });

    test("DnD target trio encodes; drops validate through canDrop (#268)", $ => {
        const onDrag = $.const(East.function([DragEventType], NullType, _$ => null));
        const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) =>
            event.match({
                add: (_$, add) => add.into.row.notEqual("0"),
                move: (_$) => East.value(true),
                remove: (_$) => East.value(true),
                resize: (_$, rz) => rz.edge.hasTag("end"),
            })));
        const gantt = $.let(Gantt.Root(
            [{ name: "A", start: new Date("2024-01-01"), end: new Date("2024-01-10") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end, state: "added" })] }),
            { id: "schedule", sources: ["crews"], onDrag, canDrop },
        ));
        const root = $.let(gantt.unwrap().unwrap("Gantt"));

        $(Assert.equal(root.id, "schedule"));
        $(Assert.equal(root.sources.get(0n), "crews"));
        $(Assert.equal(root.onDrag.hasTag("some"), true));
        const veto = $.let(root.canDrop.unwrap("some"));
        $(Assert.equal(veto(variant("add", {
            from: { library: "crews", key: "crew-a" },
            into: { surface: "schedule", row: "0", slot: "2024-01-05T00:00:00.000Z", event: none },
            duplicate: false,
        })), false));
        $(Assert.equal(veto(variant("add", {
            from: { library: "crews", key: "crew-a" },
            into: { surface: "schedule", row: "1", slot: "2024-01-05T00:00:00.000Z", event: none },
            duplicate: false,
        })), true));
        // The grammar resize round-trips (edge + destination slot in the ref).
        $(Assert.equal(veto(variant("resize", {
            event: { surface: "schedule", row: "1", slot: "2024-01-14T00:00:00.000Z", event: some("t0") },
            edge: variant("end", null),
        })), true));
        $(Assert.equal(veto(variant("resize", {
            event: { surface: "schedule", row: "1", slot: "2024-01-14T00:00:00.000Z", event: some("t0") },
            edge: variant("start", null),
        })), false));
    });

    // =========================================================================
    // Milestone Events
    // =========================================================================

    test("creates milestone with date", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Release", date: new Date("2024-03-01"), start: new Date("2024-01-01"), end: new Date("2024-01-01") }],
            ["name"],
            row => ({ milestones: [Gantt.Milestone({ date: row.date })] })
        ));

        const milestones = gantt.unwrap().unwrap("Gantt").rows.get(0n).milestones;
        $(Assert.equal(milestones.size(), 1n));
    });

    test("creates milestone with label", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Launch", date: new Date("2024-03-15"), start: new Date("2024-01-01"), end: new Date("2024-01-01") }],
            ["name"],
            row => ({ milestones: [Gantt.Milestone({ date: row.date, label: "Product Launch" })] })
        ));

        const milestone = gantt.unwrap().unwrap("Gantt").rows.get(0n).milestones.get(0n);
        $(Assert.equal(milestone.label.unwrap("some").value, "Product Launch"));
    });

    test("creates milestone with kind", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Deadline", date: new Date("2024-04-01"), start: new Date("2024-01-01"), end: new Date("2024-01-01") }],
            ["name"],
            row => ({ milestones: [Gantt.Milestone({ date: row.date, kind: "interim" })] })
        ));

        const milestone = gantt.unwrap().unwrap("Gantt").rows.get(0n).milestones.get(0n);
        $(Assert.equal(milestone.kind.unwrap("some").hasTag("interim"), true));
    });

    // =========================================================================
    // Multiple Events per Row
    // =========================================================================

    test("creates row with both tasks and milestones", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Project", start: new Date("2024-01-01"), end: new Date("2024-02-01"), milestone: new Date("2024-02-01") }],
            ["name"],
            row => ({
                tasks: [Gantt.Task({ start: row.start, end: row.end })],
                milestones: [Gantt.Milestone({ date: row.milestone, label: "Complete" })],
            })
        ));

        const row = gantt.unwrap().unwrap("Gantt").rows.get(0n);
        $(Assert.equal(row.tasks.size(), 1n));
        $(Assert.equal(row.milestones.size(), 1n));
    });

    // =========================================================================
    // Styling
    // =========================================================================

    test("creates gantt with line variant", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Task", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            { variant: "line" }
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").style.unwrap("some").variant.unwrap("some").hasTag("line"), true));
    });

    test("creates gantt with showToday", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Task", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            { showToday: true }
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").style.unwrap("some").showToday.unwrap("some"), true));
    });

    test("creates gantt with all style options", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "Task", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            {
                variant: "outline",
                size: "md",
                density: "compact",
                striped: true,
                stickyHeader: true,
                showToday: true,
            }
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").style.unwrap("some").density.unwrap("some").hasTag("compact"), true));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").style.unwrap("some").striped.unwrap("some"), true));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").style.unwrap("some").showToday.unwrap("some"), true));
    });

    // =========================================================================
    // Real-World Examples
    // =========================================================================

    test("creates project timeline gantt", $ => {
        const gantt = $.let(Gantt.Root(
            [
                { phase: "Planning", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                { phase: "Design", owner: "Bob", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
                { phase: "Development", owner: "Charlie", start: new Date("2024-01-20"), end: new Date("2024-03-15") },
                { phase: "Testing", owner: "Diana", start: new Date("2024-03-01"), end: new Date("2024-03-30") },
            ],
            {
                phase: { header: "Phase" },
                owner: { header: "Owner" },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            { variant: "line", striped: true, showToday: true }
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.size(), 4n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").columns.size(), 2n));
    });

    test("creates gantt with tasks and milestones split into separate arrays", $ => {
        const gantt = $.let(Gantt.Root(
            [
                { name: "Sprint 1", start: new Date("2024-01-01"), end: new Date("2024-01-14"), release: new Date("2024-01-14") },
                { name: "Sprint 2", start: new Date("2024-01-15"), end: new Date("2024-01-28"), release: new Date("2024-01-28") },
            ],
            { name: { header: "Sprint" } },
            row => ({
                tasks: [Gantt.Task({ start: row.start, end: row.end })],
                milestones: [Gantt.Milestone({ date: row.release, label: "Release", kind: "release" })],
            })
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.size(), 2n));
        // Each row has its own tasks + milestones arrays.
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.get(0n).tasks.size(), 1n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.get(0n).milestones.size(), 1n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.get(1n).tasks.size(), 1n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.get(1n).milestones.size(), 1n));
    });

    // =========================================================================
    // Column Render with Row Field Access
    // =========================================================================

    test("column render function receives row parameter to access other fields", $ => {
        const data = $.let(East.value([
            { name: "Design", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-15") },
            { name: "Development", owner: "Bob", start: new Date("2024-01-10"), end: new Date("2024-02-01") },
        ]));
        const gantt = $.let(Gantt.Root(
            data,
            {
                name: {
                    header: "Task",
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`${row.name} (${row.owner})`);
                    }),
                },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.size(), 2n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").columns.size(), 1n));
    });

    test("column render function uses row field for conditional styling", $ => {
        const gantt = $.let(Gantt.Root(
            [
                { task: "Critical Bug", priority: "high", start: new Date("2024-01-01"), end: new Date("2024-01-05") },
                { task: "Minor Fix", priority: "low", start: new Date("2024-01-06"), end: new Date("2024-01-10") },
            ],
            {
                task: { header: "Task" },
                priority: {
                    header: "Priority",
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) =>
                        Badge.Root(ctx.cellValue.match({ String: (_$, v) => v }, _$ => ""))
                    ),
                },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.size(), 2n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").columns.size(), 2n));
    });

    test("column render function accesses multiple row fields", $ => {
        const data = $.let(East.value([
            { firstName: "Alice", lastName: "Smith", dept: "Eng", start: new Date("2024-01-01"), end: new Date("2024-02-01") },
        ]));
        const gantt = $.let(Gantt.Root(
            data,
            {
                firstName: {
                    header: "Full Name",
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`${row.firstName} ${row.lastName}`);
                    }),
                },
                dept: { header: "Department" },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.size(), 1n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").columns.size(), 2n));
    });

    // =========================================================================
    // Complex Type Columns (require value function)
    // =========================================================================

    test("creates gantt with array field using value function", $ => {
        const data = $.let(East.value([
            { name: "Design", tags: ["ui", "frontend"], start: new Date("2024-01-01"), end: new Date("2024-01-15") },
            { name: "Backend", tags: ["api", "db"], start: new Date("2024-01-10"), end: new Date("2024-02-01") },
        ]));
        const gantt = $.let(Gantt.Root(
            data,
            {
                name: { header: "Task" },
                tags: {
                    header: "Tags",
                    value: (tags) => tags.size(),
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`${row.tags.size()} tags`);
                    }),
                },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").columns.size(), 2n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.size(), 2n));
    });

    test("creates gantt with struct field using value function", $ => {
        const data = $.let(East.value([
            { name: "Sprint 1", metadata: { priority: 1n, status: "active" }, start: new Date("2024-01-01"), end: new Date("2024-01-14") },
            { name: "Sprint 2", metadata: { priority: 3n, status: "pending" }, start: new Date("2024-01-15"), end: new Date("2024-01-28") },
        ]));
        const gantt = $.let(Gantt.Root(
            data,
            {
                name: { header: "Sprint" },
                metadata: {
                    header: "Priority",
                    value: (meta) => meta.priority,
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(East.str`Priority: ${row.metadata.priority}`);
                    }),
                },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").columns.size(), 2n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.size(), 2n));
    });

    test("creates gantt mixing primitive and complex columns", $ => {
        const data = $.let(East.value([
            { id: 1n, name: "Project A", team: { lead: "Alice", size: 5n }, start: new Date("2024-01-01"), end: new Date("2024-02-01") },
            { id: 2n, name: "Project B", team: { lead: "Bob", size: 3n }, start: new Date("2024-02-01"), end: new Date("2024-03-01") },
        ]));
        const gantt = $.let(Gantt.Root(
            data,
            {
                id: { header: "ID" },
                name: { header: "Project" },
                team: {
                    header: "Team Lead",
                    value: (team) => team.lead,
                    render: East.function([Table.Types.CellRenderContext], UIComponentType, ($, ctx) => {
                        const row = $.let(data.get(ctx.rowIndex));
                        return Text.Root(row.team.lead);
                    }),
                },
            },
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })
        ));

        $(Assert.equal(gantt.unwrap().unwrap("Gantt").columns.size(), 3n));
        $(Assert.equal(gantt.unwrap().unwrap("Gantt").rows.size(), 2n));
    });

    // =========================================================================
    // Per-task / per-milestone popover — IR coverage
    // =========================================================================

    test("task without popover is none", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "T", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
        ));
        const task = $.let(gantt.unwrap().unwrap("Gantt").rows.get(0n).tasks.get(0n));
        $(Assert.equal(task.popover.hasTag("none"), true));
    });

    test("task with popover slot round-trips as some(UIComp)", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "T", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({
                start: row.start,
                end: row.end,
                popover: Text.Root("popover content"),
            })] }),
        ));
        const task = $.let(gantt.unwrap().unwrap("Gantt").rows.get(0n).tasks.get(0n));
        $(Assert.equal(task.popover.hasTag("some"), true));
        $(Assert.equal(task.popover.unwrap("some").unwrap().hasTag("Text"), true));
    });

    test("milestone with popover round-trips", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "M", date: new Date("2024-01-15") }],
            ["name"],
            row => ({ milestones: [Gantt.Milestone({
                date: row.date,
                popover: Text.Root("click"),
            })] }),
        ));
        const ms = $.let(gantt.unwrap().unwrap("Gantt").rows.get(0n).milestones.get(0n));
        $(Assert.equal(ms.popover.hasTag("some"), true));
    });

    test("creates milestone with release kind", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "M", date: new Date("2024-01-15") }],
            ["name"],
            row => ({ milestones: [Gantt.Milestone({ date: row.date, kind: "release" })] }),
        ));
        const ms = $.let(gantt.unwrap().unwrap("Gantt").rows.get(0n).milestones.get(0n));
        $(Assert.equal(ms.kind.unwrap("some").hasTag("release"), true));
    });

    test("creates gantt with density", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "T", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] }),
            { density: "comfortable" },
        ));
        $(Assert.equal(
            gantt.unwrap().unwrap("Gantt").style.unwrap("some").density.unwrap("some").hasTag("comfortable"),
            true,
        ));
    });

    test("rich label on task round-trips align/verticalAlign/color/fontWeight/fontStyle/fontSize", $ => {
        const gantt = $.let(Gantt.Root(
            [{ name: "T", start: new Date("2024-01-01"), end: new Date("2024-01-15") }],
            ["name"],
            row => ({ tasks: [Gantt.Task({
                start: row.start,
                end: row.end,
                label: {
                    value: "Rich",
                    align: "center",
                    verticalAlign: "end",
                    color: "fg.warning",
                    fontWeight: "bold",
                    fontStyle: "italic",
                    fontSize: "lg",
                },
            })] }),
        ));
        const task = $.let(gantt.unwrap().unwrap("Gantt").rows.get(0n).tasks.get(0n));
        const label = $.let(task.label.unwrap("some"));
        $(Assert.equal(label.value, "Rich"));
        $(Assert.equal(label.align.unwrap("some").hasTag("center"), true));
        $(Assert.equal(label.verticalAlign.unwrap("some").hasTag("end"), true));
        $(Assert.equal(label.color.unwrap("some"), "fg.warning"));
        $(Assert.equal(label.fontWeight.unwrap("some").hasTag("bold"), true));
        $(Assert.equal(label.fontStyle.unwrap("some").hasTag("italic"), true));
        $(Assert.equal(label.fontSize.unwrap("some").hasTag("lg"), true));
    });
}, {   platformFns: TestImpl,});
