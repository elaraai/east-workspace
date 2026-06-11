/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, StringType, NullType, example, variant } from "@elaraai/east";
import { DragEventType, State, UIComponentType } from "@elaraai/east-ui";
import { Blend, Library, Reactive, Text, VStack } from "@elaraai/east-ui";

export const blendSingle = example({
    keywords: ["Blend", "single", "composition", "allocation", "metric", "objective", "pinned"],
    description: "Single target — composition bar, allocations with a pinned lot, predicted metrics, objective + actions",
    fn: East.function([], UIComponentType, ($) => {
        const targets = $.const([
            { key: "MIX-318", name: "Batch 318", cap: 40000.0, cost: 3.42, grade: "A−" },
        ]);
        return (
            <Blend
                id="bench"
                sources={["materials"]}
                targets={targets}
                target={t => ({
                    key: t.key, label: t.name, capacity: t.cap,
                    objective: "min cost · grade ≥ A · respect pins",
                    allocations: [
                        Blend.allocation({ source: "LOT-204", sublabel: "class 1 · north", amount: 16000.0 }),
                        Blend.allocation({ source: "LOT-219", sublabel: "class 1 · south", amount: 10000.0, pinned: true }),
                        Blend.allocation({ source: "LOT-167", sublabel: "class 2 · north", amount: 5000.0, state: variant("proposed", variant("added", null)) }),
                    ],
                    metrics: [
                        Blend.metric({ key: "grade", label: "predicted grade", value: t.grade, model: "blend-v2.1" }),
                        Blend.metric({ key: "cost", label: "cost / unit", value: East.str`$${East.print(t.cost)}`, numeric: t.cost, model: "cost-v1.4" }),
                        Blend.metric({ key: "specx", label: "spec X (interp.)", value: "3.62", numeric: 3.62, band: { min: 3.55, max: 3.68 } }),
                    ],
                })}
            />
        );
    }),
    inputs: [],
});

export const blendCompare = example({
    keywords: ["Blend", "compare", "diff", "verdict", "delta", "two targets"],
    description: "Compare mode — A/B panels with the derived diff table and verdict line",
    fn: East.function([], UIComponentType, ($) => {
        const targets = $.const([
            { key: "318a", name: "Candidate A", cap: 40000.0, cost: 3.42, grade: 3.7, gradeText: "A−" },
            { key: "318b", name: "Candidate B", cap: 40000.0, cost: 3.61, grade: 4.0, gradeText: "A" },
        ]);
        return (
            <Blend
                id="bench-ab"
                sources={["materials"]}
                targets={targets}
                target={t => ({
                    key: t.key, label: t.name, capacity: t.cap,
                    objective: "min cost · grade ≥ A",
                    allocations: [
                        Blend.allocation({ source: "LOT-204", amount: 18000.0 }),
                        Blend.allocation({ source: "LOT-167", amount: 9000.0, state: variant("proposed", variant("added", null)) }),
                    ],
                    metrics: [
                        Blend.metric({ key: "grade", label: "predicted grade", value: t.gradeText, numeric: t.grade, model: "blend-v2.1" }),
                        Blend.metric({ key: "cost", label: "cost / unit", value: East.str`$${East.print(t.cost)}`, numeric: t.cost, model: "cost-v1.4" }),
                    ],
                })}
                diff={["grade", "cost"]}
                verdict="A wins on cost · B wins on grade · pick by today's objective"
            />
        );
    }),
    inputs: [],
});

export const blendPortfolio = example({
    keywords: ["Blend", "portfolio", "horizontal", "scroll", "plans"],
    description: "Portfolio mode — uniform target panels in a horizontal scroll",
    fn: East.function([], UIComponentType, ($) => {
        const targets = $.const([
            { key: "mon", name: "Mon plan", cap: 12000.0 },
            { key: "tue", name: "Tue plan", cap: 12000.0 },
            { key: "wed", name: "Wed plan", cap: 9000.0 },
            { key: "thu", name: "Thu plan", cap: 12000.0 },
        ]);
        return (
            <Blend
                id="bench-week"
                targets={targets}
                target={t => ({
                    key: t.key, label: t.name, capacity: t.cap,
                    allocations: [
                        Blend.allocation({ source: "LOT-204", amount: 6000.0 }),
                        Blend.allocation({ source: "LOT-219", amount: 3000.0 }),
                    ],
                })}
            />
        );
    }),
    inputs: [],
});

export const blendInteractive = example({
    keywords: ["Blend", "Library", "Reactive", "onDrag", "onAmountChange", "onAction", "interactive"],
    description: "Library + Blend page — drops, amount edits, and actions report through typed events",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([StringType], "blend_last", "none"));
            const onDrag = $.const(East.function([DragEventType], NullType, ($, _event) => {
                $(bind.write("drop"));
            }));
            const onAmountChange = $.const(East.function([Blend.Types.AmountEvent], NullType, ($, e) => {
                $(bind.write(East.str`${e.source} → ${East.print(e.amount)}`));
            }));
            const onAction = $.const(East.function([Blend.Types.ActionEvent], NullType, ($, e) => {
                $(bind.write(East.print(e.action)));
            }));
            const last = $.let(bind.read());
            return (
                <VStack gap="4" align="stretch">
                    <Library
                        id="materials"
                        data={[
                            { id: "LOT-204", cls: "class 1 · north" },
                            { id: "LOT-219", cls: "class 1 · south" },
                            { id: "LOT-167", cls: "class 2 · north" },
                        ]}
                        item={m => ({ key: m.id, label: m.id, sublabel: m.cls, icon: "cubes-stacked" })}
                    />
                    <Blend
                        id="bench-live"
                        sources={["materials"]}
                        targets={[{ key: "MIX-1", name: "Batch 1", cap: 20000.0 }]}
                        target={t => ({
                            key: t.key, label: t.name, capacity: t.cap,
                            allocations: [
                                Blend.allocation({ source: "LOT-204", amount: 8000.0, state: variant("proposed", variant("added", null)) }),
                            ],
                        })}
                        onDrag={onDrag}
                        onAmountChange={onAmountChange}
                        onAction={onAction}
                    />
                    <Text.MonoLabel>{East.str`LAST · ${last}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
