/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, StringType, VariantType, variant, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Match, Reactive, State, Button, HStack, VStack, Text } from "@elaraai/east-ui";

/**
 * A `State`-bound mode variant hosted by `<Match>` — the component-level twin
 * of `variant.match`: only the active case mounts, and it remounts on tag
 * change. Pass the *reading expression* (`modeBind.read()`) as `on` — the slot
 * re-reads it reactively; a `$.let` snapshot of the read would freeze the slot.
 */
export const matchModeSwitch = example({
    keywords: ["Match", "on", "cases", "variant", "mode", "hosting slot", "remount", "conditional", "switch"],
    description: "Match hosts one of two panels by a State-bound mode variant — typed payload per case, remounts on tag change",
    fn: East.function([], UIComponentType, (_$) => {
        const ModeType = VariantType({ list: NullType, detail: StringType });
        return (
            <Reactive>{$ => {
                const modeBind = $.let(State.bind([ModeType], "match.mode", variant("list", null)));
                const toDetail = $.const(East.function([], NullType, $ => {
                    $(modeBind.write(East.value(variant("detail", "item-1"), ModeType)));
                }));
                const toList = $.const(East.function([], NullType, $ => {
                    $(modeBind.write(East.value(variant("list", null), ModeType)));
                }));
                return (
                    <VStack gap="3" align="stretch">
                        <HStack gap="2">
                            <Button onClick={toList}>List</Button>
                            <Button onClick={toDetail}>Open item-1</Button>
                        </HStack>
                        <Match on={modeBind.read()} cases={{
                            list: (_$) => <Text>All items</Text>,
                            detail: (_$, id) => <Text>{East.str`Detail — ${id}`}</Text>,
                        }} />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

/**
 * The case `<Match>` exists for: each case is a **stateful** panel (its own
 * `<Reactive>` + `State.bind`). A plain `variant.match` over mounted panels
 * would reconcile the same-shape nodes and keep the first panel mounted —
 * `<Match>` tears the inactive case down and mounts the active one fresh, so
 * each panel's own bindings attach on entry.
 */
export const matchStatefulPanels = example({
    keywords: ["Match", "Reactive", "State", "stateful", "panel", "remount", "fresh", "hosting slot", "swap"],
    description: "Match swaps two self-contained stateful panels (each its own Reactive + State.bind) — the active case mounts fresh per tag change",
    fn: East.function([], UIComponentType, (_$) => {
        const PanelType = VariantType({ counter: NullType, notes: NullType });
        return (
            <Reactive>{$ => {
                const panelBind = $.let(State.bind([PanelType], "match.panel", variant("counter", null)));
                const showCounter = $.const(East.function([], NullType, $ => {
                    $(panelBind.write(East.value(variant("counter", null), PanelType)));
                }));
                const showNotes = $.const(East.function([], NullType, $ => {
                    $(panelBind.write(East.value(variant("notes", null), PanelType)));
                }));
                return (
                    <VStack gap="3" align="stretch">
                        <HStack gap="2">
                            <Button onClick={showCounter}>Counter</Button>
                            <Button onClick={showNotes}>Notes</Button>
                        </HStack>
                        <Match on={panelBind.read()} cases={{
                            counter: (_$) => (
                                <Reactive>{$ => {
                                    const countBind = $.let(State.bind([IntegerType], "match.panel.count", 0n));
                                    const count = $.let(countBind.read());
                                    const increment = $.const(East.function([], NullType, $ => {
                                        const current = $.let(countBind.read());
                                        $(countBind.write(current.add(1n)));
                                    }));
                                    return (
                                        <VStack gap="2" align="stretch">
                                            <Text>{East.str`Count: ${East.print(count)}`}</Text>
                                            <Button onClick={increment}>+1</Button>
                                        </VStack>
                                    );
                                }}</Reactive>
                            ),
                            notes: (_$) => (
                                <Reactive>{$ => {
                                    const noteBind = $.let(State.bind([StringType], "match.panel.note", "…"));
                                    const note = $.let(noteBind.read());
                                    return <Text>{East.str`Notes: ${note}`}</Text>;
                                }}</Reactive>
                            ),
                        }} />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
