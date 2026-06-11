/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, example, variant, some, none } from "@elaraai/east";
import { State, StatusTokenType, UIComponentType } from "@elaraai/east-ui";
import { Reactive, Schematic, Text, VStack } from "@elaraai/east-ui";

export const schematicPlant = example({
    keywords: ["Schematic", "canvas", "items", "zones", "links", "meter", "status", "hatch"],
    description: "Plant floor — tanks and lines in halls with a walkway band and pipe runs",
    fn: East.function([], UIComponentType, ($) => {
        const equipment = $.const([
            { id: "TANK-04", x: 3.0, y: 2.6, kind: "fermenter · 40 kL", fill: 28.8, cap: 40.0, metric: "28.8 kL", state: some(variant("success", null)), w: 4.5 },
            { id: "TANK-05", x: 8.0, y: 2.6, kind: "fermenter · 40 kL", fill: 36.8, cap: 40.0, metric: "36.8 kL", state: some(variant("warning", null)), w: 4.5 },
            { id: "TANK-06", x: 13.0, y: 2.6, kind: "fermenter · 40 kL", fill: 20.4, cap: 40.0, metric: "20.4 kL", state: some(variant("success", null)), w: 4.5 },
            { id: "TANK-07", x: 18.0, y: 2.6, kind: "fermenter · 60 kL", fill: 0.0, cap: 60.0, metric: "empty", state: some(variant("neutral", null)), w: 4.5 },
            { id: "QA-1", x: 25.0, y: 2.6, kind: "qa hold · 8h", fill: 4.0, cap: 8.0, metric: "4h left", state: some(variant("info", null)), w: 4.5 },
            { id: "LINE-2", x: 8.0, y: 9.8, kind: "pack · sku-241", fill: 0.0, cap: 0.0, metric: "1,800 u/h", state: some(variant("success", null)), w: 13.0 },
            { id: "BAY-OUT", x: 24.0, y: 9.8, kind: "pallets · 5 slots", fill: 3.0, cap: 5.0, metric: "3 / 5", state: some(variant("success", null)), w: 4.5 },
        ]);
        const areas = $.const([
            { id: "hall-b", name: "Fermentation Hall · Hall B", x: 0.6, y: 0.6, w: 20.0, h: 4.4, pattern: Schematic.outline() },
            { id: "qa-cell", name: "QA Cell", x: 22.5, y: 0.6, w: 5.5, h: 4.4, pattern: Schematic.outline() },
            { id: "aisle-3", name: "Aisle 3 · 1.6 m walkway", x: 0.6, y: 6.2, w: 28.0, h: 1.6, pattern: Schematic.hatch() },
            { id: "dispatch", name: "Dispatch", x: 20.5, y: 8.4, w: 8.1, h: 3.2, pattern: Schematic.outline() },
        ]);
        // Already the resolved link type — passed through with no `link` mapper.
        const orthogonal = variant("orthogonal", { corner: none });
        const pipes = $.const([
            { key: "p1", from: "TANK-04", to: "LINE-2", style: Schematic.solid(), route: orthogonal, via: [] },
            { key: "p2", from: "TANK-05", to: "LINE-2", style: Schematic.solid(), route: orthogonal, via: [] },
            { key: "p3", from: "TANK-06", to: "LINE-2", style: Schematic.solid(), route: orthogonal, via: [] },
            { key: "p4", from: "QA-1", to: "BAY-OUT", style: Schematic.dashed(), route: orthogonal, via: [{ x: 26.5, y: 6.8 }] },
        ], ArrayType(Schematic.Types.Link));
        return (
            <Schematic
                extent={{ width: 29, height: 12.5 }}
                items={equipment}
                item={e => ({
                    key: e.id, x: e.x, y: e.y, label: e.id,
                    sublabel: e.kind, icon: "database",
                    status: e.state,
                    meter: { value: e.fill, max: e.cap },
                    metric: e.metric,
                    width: e.w,
                })}
                zones={areas}
                zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, pattern: z.pattern })}
                links={pipes}
                scaleUnit="m"
                grid={true}
            />
        );
    }),
    inputs: [],
});

export const schematicMinimal = example({
    keywords: ["Schematic", "canvas", "minimal"],
    description: "Minimal placement — items only, no zones or links",
    fn: East.function([], UIComponentType, ($) => {
        const rooms = $.const([
            { id: "DOCK-1", x: 3.0, y: 2.0 },
            { id: "DOCK-2", x: 9.0, y: 2.0 },
            { id: "STAGE", x: 6.0, y: 5.5 },
        ]);
        return (
            <Schematic
                extent={{ width: 12, height: 7 }}
                items={rooms}
                item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "warehouse" })}
            />
        );
    }),
    inputs: [],
});

export const schematicInteractive = example({
    keywords: ["Schematic", "Reactive", "State", "onSelect", "interactive"],
    description: "Canvas whose onSelect tracks the inspected item",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([StringType], "schematic_selected", "none"));
            const onSelect = $.const(East.function([StringType], NullType, ($, key) => {
                $(bind.write(key));
            }));
            const selected = $.let(bind.read());
            return (
                <VStack gap="3" align="stretch">
                    <Schematic
                        extent={{ width: 12, height: 6 }}
                        items={[
                            { id: "CELL-A", x: 3.0, y: 3.0 },
                            { id: "CELL-B", x: 9.0, y: 3.0 },
                        ]}
                        item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "industry" })}
                        onSelect={onSelect}
                    />
                    <Text.MonoLabel>{East.str`INSPECTING · ${selected}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const schematicFacility = example({
    keywords: ["Schematic", "facility", "navigator", "minimap", "zoom", "LOD", "search", "large", "generate"],
    description: "500-unit facility — navigator rail, minimap, semantic zoom, search-to-fly; rows generated with East.Array.generate",
    fn: East.function([], UIComponentType, ($) => {
        const UnitType = StructType({
            key: StringType,
            x: FloatType,
            y: FloatType,
            kind: StringType,
            fill: FloatType,
            cap: FloatType,
            metric: StringType,
            status: OptionType(StatusTokenType),
        });
        const statuses = $.const([
            some(variant("success", null)),
            some(variant("success", null)),
            some(variant("success", null)),
            some(variant("warning", null)),
            some(variant("info", null)),
            some(variant("neutral", null)),
        ], ArrayType(OptionType(StatusTokenType)));
        // One generated grid block per zone — geometry and pseudo-random
        // fill computed with East expressions over the unit index.
        const block = $.const(East.function(
            [StringType, FloatType, FloatType, IntegerType, IntegerType, FloatType],
            ArrayType(UnitType),
            (_$, prefix, x0, y0, count, cols, cap) =>
                East.Array.generate(count, UnitType, ($, i) => {
                    const col = $.let(i.remainder(cols));
                    const row = $.let(i.subtract(col).divide(cols));
                    const fill = $.let(i.add(1n).multiply(7919n).remainder(100n).toFloat().divide(100.0).multiply(cap));
                    return {
                        key: East.str`${prefix}-${East.print(i.add(1n))}`,
                        x: x0.add(col.toFloat().multiply(3.1)),
                        y: y0.add(row.toFloat().multiply(3.1)),
                        kind: East.str`${East.Float.printFixed(cap, 0n)} t cell`,
                        fill,
                        cap,
                        metric: East.str`${East.Float.printFixed(fill, 1n)} t`,
                        status: statuses.get(i.remainder(6n)),
                    };
                }),
        ));
        const units = $.let(
            block("IN", 3.0, 3.5, 16n, 8n, 20.0)
                .concat(block("PA", 33.0, 3.5, 84n, 14n, 40.0))
                .concat(block("PB", 33.0, 27.5, 84n, 14n, 40.0))
                .concat(block("ST", 3.0, 15.5, 80n, 8n, 12.0))
                .concat(block("QA", 81.0, 3.5, 30n, 5n, 60.0))
                .concat(block("OUT", 81.0, 27.5, 30n, 5n, 24.0)));
        const areas = $.const([
            { id: "inbound", name: "Inbound", x: 1.0, y: 1.0, w: 28.0, h: 10.0 },
            { id: "hall-a", name: "Process Hall A", x: 31.0, y: 1.0, w: 46.0, h: 22.0 },
            { id: "hall-b", name: "Process Hall B", x: 31.0, y: 25.0, w: 46.0, h: 22.0 },
            { id: "storage", name: "Storage", x: 1.0, y: 13.0, w: 28.0, h: 34.0 },
            { id: "qa", name: "Quality", x: 79.0, y: 1.0, w: 20.0, h: 22.0 },
            { id: "outbound", name: "Outbound", x: 79.0, y: 25.0, w: 20.0, h: 22.0 },
        ]);
        return (
            <Schematic
                extent={{ width: 100, height: 48 }}
                items={units}
                item={u => ({
                    key: u.key, x: u.x, y: u.y, label: u.key,
                    sublabel: u.kind, icon: "cube",
                    status: u.status,
                    meter: { value: u.fill, max: u.cap },
                    metric: u.metric,
                })}
                zones={areas}
                zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h })}
                scaleUnit="m"
                grid={true}
                navigator={true}
                minimap={true}
            />
        );
    }),
    inputs: [],
});
