/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, BooleanType, IntegerType, NullType, StringType, StructType, ArrayType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, Chart, Configurator, Popover, Reactive, Text } from "@elaraai/east-ui";

export const popoverBasic = example({
    keywords: ["Popover", "Root", "title", "description", "click"],
    description: "Click-triggered floating panel",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Popover trigger={<Button>Open Popover</Button>} title="Popover Title" description="A helpful description">
                <Text>This is the popover content. You can put any UI components here.</Text>
            </Popover>
        );
    }),
    inputs: [],
});

export const popoverVariants = example({
    keywords: ["Popover", "Root", "Chart", "Area", "hasArrow", "placement", "Reactive", "State", "onOpenChange", "interactive", "Configurator", "configurator"],
    description: "Popover configurator — a content preset axis (text / chart) on one live popover; the aside counts open/close transitions",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const rows = $.const([
                { day: "Mon", value: 120n }, { day: "Tue", value: 150n }, { day: "Wed", value: 180n },
                { day: "Thu", value: 140n }, { day: "Fri", value: 200n },
            ], ArrayType(StructType({ day: StringType, value: IntegerType })));
            const togglesBind = $.let(State.bind([IntegerType], "popover_toggles", 0n));
            const toggles = $.let(togglesBind.read());
            const onOpenChange = $.const(East.function([BooleanType], NullType, ($, _open) => {
                const cur = $.let(togglesBind.read());
                $(togglesBind.write(cur.add(1n)));
            }));

            // ONE popover — the richest composition (title, description,
            // arrow, chart body).
            const preview = $.const(
                <Popover trigger={<Button variant="solid">View Stats</Button>} hasArrow={true} title="Weekly Sales" description="Each open/close fires onOpenChange" placement="bottom-start" onOpenChange={onOpenChange}>
                    <Chart layers={Chart.Area(rows, { x: r => r.day, y: r => r.value }, { color: "brand.500", fillOpacity: 0.3 })} height={160} />
                </Popover>,
            );

            return (
                <Configurator
                    controls={[
                    ]}
                    preview={preview}
                    aside={{
                        label: "onOpenChange · Reactive",
                        body: <Text.MonoLabel>{East.str`TOGGLED · ${East.print(toggles)}`}</Text.MonoLabel>,
                    }}
                    spec={[
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
