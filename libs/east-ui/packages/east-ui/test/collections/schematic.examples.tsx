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
                height="440px"
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
                height="440px"
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
                        height="440px"
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
        // fill computed with East expressions over the unit index. Blocks
        // mix row spacing (tight ⇢ sparse) and add hash jitter so the
        // semantic-zoom declutter has real density variation to chew on.
        const block = $.const(East.function(
            [StringType, FloatType, FloatType, IntegerType, IntegerType, FloatType, FloatType],
            ArrayType(UnitType),
            (_$, prefix, x0, y0, count, cols, spacing, cap) =>
                East.Array.generate(count, UnitType, ($, i) => {
                    const col = $.let(i.remainder(cols));
                    const row = $.let(i.subtract(col).divide(cols));
                    const fill = $.let(i.add(1n).multiply(7919n).remainder(100n).toFloat().divide(100.0).multiply(cap));
                    const jx = $.let(i.multiply(2654435761n).remainder(97n).toFloat().divide(97.0).subtract(0.5).multiply(spacing.multiply(0.3)));
                    const jy = $.let(i.multiply(40503n).remainder(89n).toFloat().divide(89.0).subtract(0.5).multiply(spacing.multiply(0.3)));
                    return {
                        key: East.str`${prefix}-${East.print(i.add(1n))}`,
                        x: x0.add(col.toFloat().multiply(spacing)).add(jx),
                        y: y0.add(row.toFloat().multiply(spacing)).add(jy),
                        kind: East.str`${East.Float.printFixed(cap, 0n)} t cell`,
                        fill,
                        cap,
                        metric: East.str`${East.Float.printFixed(fill, 1n)} t`,
                        status: statuses.get(i.remainder(6n)),
                    };
                }),
        ));
        const units = $.let(
            block("IN", 3.0, 3.5, 16n, 8n, 3.1, 20.0)
                .concat(block("PA", 33.0, 3.5, 84n, 14n, 3.1, 40.0))
                .concat(block("PB", 33.0, 27.5, 84n, 21n, 2.0, 40.0))
                .concat(block("ST", 3.0, 15.5, 80n, 10n, 1.6, 12.0))
                .concat(block("QA", 81.0, 3.5, 30n, 5n, 3.6, 60.0))
                .concat(block("OUT", 81.0, 27.5, 12n, 4n, 4.8, 24.0)));
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
                height="440px"
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

export const schematicGeometry = example({
    keywords: ["Schematic", "geometry", "polygon", "polyline", "footprint", "zone", "CAD", "shape"],
    description: "Shape geometry — polygon & polyline zones (rotated hall, curvy service road) and polygon item footprints (press, tank)",
    fn: East.function([], UIComponentType, ($) => {
        // Equipment with real footprints (`fp:true` ⇒ polygon body; else
        // point + icon). The `x/y` anchor stays the item identity used by the
        // sidebar, links, and declutter; `footprint` is additive.
        const equipment = $.const([
            { id: "PRESS-1", x: 6.0, y: 4.0, kind: "hydraulic press", state: some(variant("success", null)), fp: true,
              pts: [{ x: 3.5, y: 2.2 }, { x: 8.6, y: 3.0 }, { x: 8.0, y: 6.0 }, { x: 2.9, y: 5.2 }] },
            { id: "TANK-9", x: 16.0, y: 4.5, kind: "buffer · 60 kL", state: some(variant("warning", null)), fp: true,
              pts: [{ x: 13.5, y: 2.4 }, { x: 18.5, y: 2.4 }, { x: 18.5, y: 6.6 }, { x: 13.5, y: 6.6 }] },
            { id: "VALVE-3", x: 21.6, y: 4.5, kind: "manifold", state: some(variant("info", null)), fp: false,
              pts: [{ x: 21.6, y: 4.5 }] },
        ]);
        // Zones with shape geometry: a rotated polygon hall and a curvy
        // polyline service road (a world-space band). The required x/y/w/h
        // bounding box still drives the navigator / minimap / fly-to.
        const areas = $.const([
            { id: "hall-c", name: "Hall C", x: 1.5, y: 1.2, w: 9.1, h: 6.4, road: false,
              pts: [{ x: 1.8, y: 2.0 }, { x: 10.2, y: 1.3 }, { x: 10.6, y: 7.0 }, { x: 2.2, y: 7.6 }] },
            { id: "svc-rd", name: "Service Rd", x: 1.0, y: 9.0, w: 23.5, h: 3.4, road: true,
              pts: [{ x: 1.5, y: 11.6 }, { x: 7.0, y: 9.8 }, { x: 13.0, y: 11.4 }, { x: 19.0, y: 9.6 }, { x: 24.0, y: 10.8 }] },
        ]);
        return (
            <Schematic
                extent={{ width: 26, height: 14 }}
                height="440px"
                items={equipment}
                item={e => ({
                    key: e.id, x: e.x, y: e.y, label: e.id,
                    sublabel: e.kind, status: e.state, icon: "industry",
                    footprint: e.fp.ifElse(_$ => Schematic.polygon(e.pts), _$ => Schematic.rect()),
                })}
                zones={areas}
                zone={z => ({
                    key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h,
                    geometry: z.road.ifElse(
                        _$ => Schematic.polyline(z.pts, { width: 1.4 }),
                        _$ => Schematic.polygon(z.pts),
                    ),
                })}
                scaleUnit="m"
                grid={true}
            />
        );
    }),
    inputs: [],
});