/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { ArrayType, BooleanType, East, StringType, NullType, example, variant } from "@elaraai/east";
import { DragEventType, State, UIComponentType } from "@elaraai/east-ui";
import { Blend, Configurator, Library, Reactive, SegmentGroup, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const BLEND_MODE_SINGLE_DATA = [
    { key: "MIX-318", name: "Batch 318", cap: 40000.0, cost: 3.42, grade: "A−" },
];
const BLEND_MODE_COMPARE_DATA = [
    { key: "318a", name: "Candidate A", cap: 40000.0, cost: 3.42, grade: 3.7, gradeText: "A−" },
    { key: "318b", name: "Candidate B", cap: 40000.0, cost: 3.61, grade: 4.0, gradeText: "A" },
];
const BLEND_MODE_PORTFOLIO_DATA = [
    { key: "mon", name: "Mon plan", cap: 12000.0 },
    { key: "tue", name: "Tue plan", cap: 12000.0 },
    { key: "wed", name: "Wed plan", cap: 9000.0 },
    { key: "thu", name: "Thu plan", cap: 12000.0 },
];

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

export const blendModes = example({
    keywords: ["Blend", "single", "mode", "compare", "diff", "verdict", "delta", "two targets", "portfolio", "horizontal", "scroll", "plans", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Blend mode configurator — a mode preset axis (single / compare / portfolio) swaps one live bench: one target, A/B panels with the diff table + verdict, or a horizontal portfolio scroll",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The mode axis is a bare label array — each preset swaps the whole
            // bench (targets, diff, verdict), so the axis is a preset picker
            // rather than a per-prop lookup.
            const modes = $.const(["single", "compare", "portfolio"], ArrayType(StringType));
            const modeBind = $.let(State.bind([StringType], "blend_mode", "single"));
            const mode = $.let(modeBind.read());
            const onMode = $.const(East.function([StringType], NullType, ($, next) => {
                $(modeBind.write(next));
            }));
            return (
                <Configurator
                    controls={[
                        Configurator.Control("Mode", mode,
                            <SegmentGroup value={mode} onChange={onMode} size="sm"
                                items={modes.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                    ]}
                    preview={
                        mode.equal("single").ifElse(
                            // Single target — composition bar, allocations with a
                            // pinned lot, predicted metrics.
                            _$ => (
                                <Blend
                                    id="bench-single"
                                    sources={["materials"]}
                                    targets={BLEND_MODE_SINGLE_DATA}
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
                                        ],
                                    })}
                                />
                            ),
                            _$ => mode.equal("compare").ifElse(
                                // Compare — A/B panels with the derived diff table
                                // and verdict line.
                                _$ => (
                                    <Blend
                                        id="bench-ab"
                                        sources={["materials"]}
                                        targets={BLEND_MODE_COMPARE_DATA}
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
                                ),
                                // Portfolio — uniform target panels in a horizontal
                                // scroll.
                                _$ => (
                                    <Blend
                                        id="bench-week"
                                        targets={BLEND_MODE_PORTFOLIO_DATA}
                                        target={t => ({
                                            key: t.key, label: t.name, capacity: t.cap,
                                            allocations: [
                                                Blend.allocation({ source: "LOT-204", amount: 6000.0 }),
                                                Blend.allocation({ source: "LOT-219", amount: 3000.0 }),
                                            ],
                                        })}
                                    />
                                ),
                            ),
                        )
                    }
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * IR-level drop validation (#261) folds into the DnD grammar — `canDrop`
 * receives the synthesized candidate event for every hovered target panel;
 * returning `false` shows the ⊘ invalid stage and the drop is a no-op. Here
 * class-2 lots can't be pulled into the premium batch. The `LAST ·` line
 * under the bench logs every delivered event, so a vetoed gesture is visibly
 * silent while an allowed one prints its `add`.
 */
export const blendLibraryDnd = example({
    keywords: ["Blend", "Library", "DnD", "drag", "add", "remove", "Reactive", "onDrag", "onAmountChange", "onAction", "interactive", "canDrop", "veto", "invalid", "validation", "candidate", "drop"],
    description: "Library + Blend DnD — drag material cards into the batch (add), amounts edit inline, actions report through typed events; the canDrop stage vetoes class-2 cards on the premium batch (⊘ while dragging, no LAST log)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const canDrop = $.const(East.function([DragEventType], BooleanType, ($, event) =>
                event.match({
                    add: (_$, add) => add.from.key.startsWith("c2-").and(_$ => East.equal(add.into.row, "premium")).not(),
                    move: (_$) => East.value(true),
                    remove: (_$) => East.value(true),
                    resize: (_$) => East.value(true),
                })));
            const bind = $.let(State.bind([StringType], "blend_last", "none"));
            const onDrag = $.const(East.function([DragEventType], NullType, ($, event) => {
                $.match(event, {
                    add: ($, add) => { $(bind.write(East.str`add · ${add.from.key} → ${add.into.row}`)); },
                    move: ($, mv) => { $(bind.write(East.str`move · ${mv.from.row} → ${mv.to.row}`)); },
                    remove: ($, rm) => { $(bind.write(East.str`remove · ${rm.from.row} → ${rm.to.getTag()}`)); },
                    resize: ($, rz) => { $(bind.write(East.str`resize · ${rz.edge.getTag()}`)); },
                });
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
                            { id: "c1-204", name: "LOT-204", cls: "class 1 · north" },
                            { id: "c1-219", name: "LOT-219", cls: "class 1 · south" },
                            { id: "c2-167", name: "LOT-167", cls: "class 2 · north" },
                        ]}
                        item={m => ({ key: m.id, label: m.name, sublabel: m.cls, icon: "cubes-stacked" })}
                    />
                    <Blend
                        id="bench-live"
                        sources={["materials"]}
                        targets={[{ key: "premium", name: "Premium batch", cap: 20000.0 }]}
                        target={t => ({
                            key: t.key, label: t.name, capacity: t.cap,
                            allocations: [
                                Blend.allocation({ source: "c1-204", label: "LOT-204", amount: 8000.0, state: variant("proposed", variant("added", null)) }),
                            ],
                        })}
                        canDrop={canDrop}
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
