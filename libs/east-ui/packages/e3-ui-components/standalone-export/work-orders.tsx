/** @jsxImportSource @elaraai/east-ui */

/**
 * `sheetActionsWorkOrders` as a page with no e3 behind it: the same columns, band, registers and actions, its orders
 * bound whole (`record={orders}`) rather than paged through a slice, so the in-memory record stands in for e3.
 */

import { ArrayType, BooleanType, East, OptionType, StringType, none, some, variant } from "@elaraai/east";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Record, Sheet } from "@elaraai/e3-ui";
import { Step, StepAction, WorkOrder, WorkStatus, sheetWorkOrders } from "../../e3-ui/test/sheet/sheet-actions.examples.tsx";

export const workOrders = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const orders = $.let(Record.bind(sheetWorkOrders));
        const statuses = $.let([
            { word: "in_progress", label: "In progress", tone: variant("info", null) },
            { word: "on_hold", label: "On hold", tone: variant("warning", null) },
            { word: "done", label: "Done", tone: variant("success", null) },
        ], ArrayType(WorkStatus));
        const finished = $.const(East.function([Step], BooleanType, (_$2, step) =>
            step.action.match({ some: (_$3, a) => a.hasTag("completed").or(() => a.hasTag("verified")) }, () => false)));
        return (
            <Box width="100%" height="100%">
                <Sheet
                    record={orders}
                    name="sheetActionsWorkOrders"
                    group={Sheet.group(WorkOrder, "steps", {
                        title: "name", sub: o => o.id, noun: { singular: "order", plural: "orders" },
                        cells: { action: Sheet.group.cell.enum(WorkOrder, "statuses", "status", { editable: false }) },
                    })}
                    registers={{
                        statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.label, tone: s => some(s.tone) }),
                    }}
                    columns={{
                        step: Sheet.column.text(Step, { header: "Step", width: "158px", editable: false }),
                        good: Sheet.column.integer(Step, { header: "Good", width: "56px" }),
                        action: Sheet.column.action(Step, StepAction, {
                            header: "Action", width: "304px",
                            name: s => East.str`step ${s.op}`,
                            title: s => s.step,
                            start: ["started"],
                            blocked: (ctx) => ctx.index.equal(0n).ifElse(() => East.value(none, OptionType(StringType)), () =>
                                ctx.rows.get(ctx.index.subtract(1n)).match({
                                    some: (_$2, before) => finished(before).ifElse(() => East.value(none, OptionType(StringType)), () => East.value(some(East.str`waits for ${before.op}`), OptionType(StringType))),
                                }, () => East.value(some("waits for the step before"), OptionType(StringType)))),
                            cases: {
                                started: {
                                    label: "Start", state: "Started", tone: "info", icon: "play",
                                    next: ["completed", "reported", "held", "alerted"],
                                    updates: () => ({ group: Sheet.patch(WorkOrder, { status: "in_progress" }) }),
                                },
                                completed: {
                                    label: "Complete", state: "Completed", tone: "success", icon: "check",
                                    summary: (_v, s) => s.good.match({ some: (_$2, g) => East.str`${g} good` }, () => ""),
                                    updates: (_v, ctx, at) => ({
                                        row: Sheet.patch(Step, { good: some(ctx.row.good.match({ some: (_$2, g) => g }, () => ctx.row.plan)), done: some(at) }),
                                        group: Sheet.patch(WorkOrder, { status: ctx.rows.every((_$2, r, i) =>
                                            i.equal(ctx.index).or(() => r.match({ some: (_$3, s) => finished(s) }, () => false)))
                                            .ifElse(() => "done", () => "in_progress") }),
                                    }),
                                },
                                reported: {
                                    label: "Report", state: "Reported", tone: "info", icon: "hashtag",
                                    next: ["completed", "reported", "held", "alerted"],
                                    take: Sheet.action.form({
                                        fields: Sheet.field.number({ label: "Good parts", unit: "pcs", min: 0n }),
                                        initial: (ctx) => ctx.row.good.match({ some: (_$2, g) => g }, () => 0n),
                                    }),
                                    summary: (count) => East.str`${count} good`,
                                    updates: (count) => ({ row: Sheet.patch(Step, { good: some(count) }) }),
                                },
                                held: {
                                    label: "Hold", state: "Held", tone: "warning", icon: "pause",
                                    next: ["started"],
                                    take: Sheet.action.menu({ labels: { awaiting_parts: "Awaiting parts", machine_down: "Machine down", quality_hold: "Quality hold" } }),
                                    summary: (reason) => reason.match({ awaiting_parts: () => "Awaiting parts", machine_down: () => "Machine down", quality_hold: () => "Quality hold" }),
                                    updates: () => ({ group: Sheet.patch(WorkOrder, { status: "on_hold" }) }),
                                },
                                alerted: {
                                    label: "Alert", state: "Alerted", tone: "danger", icon: "flag",
                                    next: ["started", "completed"],
                                    take: Sheet.action.form({ fields: {
                                        changes: Sheet.field.text({ label: "What changed", help: "What the operator saw", placeholder: "What the operator saw" }),
                                        severity: Sheet.field.select({ help: "High puts the order on hold" }),
                                    } }),
                                    summary: (alert) => alert.changes,
                                    updates: (alert) => ({ group: Sheet.patch(WorkOrder, {
                                        status: alert.severity.hasTag("high").ifElse(() => "on_hold", () => "in_progress"),
                                    }) }),
                                },
                                verified: { label: "Verify", state: "Verified", tone: "success", summary: () => "by QA" },
                            },
                        }),
                        done: Sheet.column.date(Step, { header: "Done", width: "64px", level: () => "time", format: "HH:mm" }),
                    }}
                    inspector
                    library={[
                        // The statuses an order takes: a card dropped on an order's band sets its status.
                        Sheet.library.tab(statuses, { name: "Statuses", icon: "flag",
                            key: st => st.word, label: st => st.label, drop: st => Sheet.patch(WorkOrder, { status: st.word }) }),
                        Sheet.library.columns(),
                    ]}
                    applyMode="batch"
                />
            </Box>
        );
    }}</Reactive>
));
