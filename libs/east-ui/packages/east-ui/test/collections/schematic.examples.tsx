/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, example, variant, some, none } from "@elaraai/east";
import { State, StatusTokenType, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Reactive, Schematic, Select, Separator, Slice, Slider, Sparkline, Switch, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

// Equipment with real footprints: `round` ⇒ circle body (a tank),
// else `fp` ⇒ polygon body, else point + icon. The `x/y` anchor stays
// the item identity used by the sidebar, links, and declutter;
// `footprint` is additive (a circle centres on that anchor).

// Zones with shape geometry: a rotated polygon hall and a curvy
// polyline service road whose bends are true arcs (vertex `bulge`),
// widened into a world-space band. The required x/y/w/h bounding box
// still drives the navigator / minimap / fly-to.

// Each unit carries an explicit CSS colour: `color` tints the stroke /
// marker, `bg` fills the circle footprint — a category palette that is
// independent of `status`.

// Small extent ⇒ items render as CARDS, where the ghost / desaturate
// / ring effects read clearly (on labelled pins they'd be too subtle).
// Each carries a status tone so `desaturate` visibly drains its colour.

// The ONE shared canvas fixture for the interaction configurator — old
// schematicInteractive's items (the other merged examples' fixtures are
// superseded; their distinctive features are prop-level, not data-level),
// plus schematicZoneSelect's M1 / P1 / P2 rows so the Hall B and Dock zones
// below keep child items and the childItemKeys log line stays meaningful.

// Zone bodies for the zone tool + the always-on zoneHover cards — verbatim
// from the OLD schematicZoneSelect example (the only zone source among the
// six merged interaction examples).

export const schematicPlant = example({
    keywords: ["Schematic", "canvas", "items", "zones", "links", "meter", "status", "hatch", "label", "metric", "parallel", "fan-out", "flow"],
    description: "Plant floor — tanks and lines in halls with a walkway band and pipe runs",
    fn: East.function([], UIComponentType, ($) => {
        const equipment = $.const([
            { id: "UNIT-04", x: 3.0, y: 2.6, kind: "unit · 40 kL", fill: 28.8, cap: 40.0, metric: "28.8 kL", state: some(variant("success", null)), w: 4.5 },
            { id: "UNIT-05", x: 8.0, y: 2.6, kind: "unit · 40 kL", fill: 36.8, cap: 40.0, metric: "36.8 kL", state: some(variant("warning", null)), w: 4.5 },
            { id: "UNIT-06", x: 13.0, y: 2.6, kind: "unit · 40 kL", fill: 20.4, cap: 40.0, metric: "20.4 kL", state: some(variant("success", null)), w: 4.5 },
            { id: "UNIT-07", x: 18.0, y: 2.6, kind: "unit · 60 kL", fill: 0.0, cap: 60.0, metric: "empty", state: some(variant("neutral", null)), w: 4.5 },
            { id: "QA-1", x: 25.0, y: 2.6, kind: "qa hold · 8h", fill: 4.0, cap: 8.0, metric: "4h left", state: some(variant("info", null)), w: 4.5 },
            { id: "LINE-2", x: 8.0, y: 9.8, kind: "pack · sku-241", fill: 0.0, cap: 0.0, metric: "1,800 u/h", state: some(variant("success", null)), w: 13.0 },
            { id: "BAY-OUT", x: 24.0, y: 9.8, kind: "pallets · 5 slots", fill: 3.0, cap: 5.0, metric: "3 / 5", state: some(variant("success", null)), w: 4.5 },
        ]);
        const areas = $.const([
            { id: "hall-b", name: "Hall B", x: 0.6, y: 0.6, w: 20.0, h: 4.4, pattern: Schematic.outline() },
            { id: "qa-cell", name: "QA Cell", x: 22.5, y: 0.6, w: 5.5, h: 4.4, pattern: Schematic.outline() },
            { id: "aisle-3", name: "Aisle 3 · 1.6 m walkway", x: 0.6, y: 6.2, w: 28.0, h: 1.6, pattern: Schematic.hatch() },
            { id: "dispatch", name: "Dispatch", x: 20.5, y: 8.4, w: 8.1, h: 3.2, pattern: Schematic.outline() },
        ]);
        // Already the resolved link type — passed through with no `link` mapper.
        const orthogonal = variant("orthogonal", { corner: none });
        // p2 + p2b share the same endpoint pair — the renderer fans them into
        // parallel lanes (#180) so both edges (feed + CIP return) stay readable;
        // labels/metrics render mid-path at label zoom.
        const pipes = $.const([
            { key: "p1", from: "UNIT-04", to: "LINE-2", label: some("feed"), metric: some("12 m³/h"), style: Schematic.solid(), route: orthogonal, via: [], layer: none },
            { key: "p2", from: "UNIT-05", to: "LINE-2", label: some("feed"), metric: some("9 m³/h"), style: Schematic.solid(), route: orthogonal, via: [], layer: none },
            { key: "p2b", from: "UNIT-05", to: "LINE-2", label: some("CIP return"), metric: none, style: Schematic.dashed(), route: orthogonal, via: [], layer: none },
            { key: "p3", from: "UNIT-06", to: "LINE-2", label: none, metric: none, style: Schematic.solid(), route: orthogonal, via: [], layer: none },
            { key: "p4", from: "QA-1", to: "BAY-OUT", label: none, metric: some("3 pallets/h"), style: Schematic.dashed(), route: orthogonal, via: [{ x: 26.5, y: 6.8 }], layer: none },
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

// 320 generated demo units across 4 bays — authored at MODULE scope (an East
// function's body must be East all the way down; authoring-time constants are
// host-declared outside it).
const STRESS_KINDS = ["unit", "pack", "pallet", "tank"];
// A large generated grid — the count is the perf-probe knob (#302-adjacent
// schematic-slice-perf): bump it to reproduce the slice-on pan/zoom slowdown at
// scale. 3,000 sits above the 2,000-item pan budget.
const STRESS_GRID_ITEMS = Array.from({ length: 3000 }, (_, i) => {
    const col = i % 50, row = Math.floor(i / 50);
    return {
        id: `U-${String(i).padStart(4, "0")}`,
        x: col * 2.0 + 2.0,
        y: row * 2.4 + 2.0,
        load: (i * 37 % 100) / 100,
        kind: STRESS_KINDS[i % STRESS_KINDS.length]!,
    };
});

export const schematicStress = example({
    keywords: ["Schematic", "stress", "performance", "LOD", "semantic zoom", "declutter", "minimap", "large", "many items", "slice", "sliceEffect", "pan", "zoom", "10k"],
    description: "Stress probe — 3,000 generated items exercise the LOD ladder and Slice chrome (rail + ghosting) at scale; the pan/zoom perf budget with slice on",
    fn: East.function([], UIComponentType, (_$) => {
        const EquipType = StructType({ id: StringType, x: FloatType, y: FloatType, load: FloatType, kind: StringType });
        const cfg = Slice.config(EquipType, {
            fields: { id: { label: "ID" }, kind: { label: "Kind" } },
            searchFieldIds: ["id", "kind"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const(STRESS_GRID_ITEMS, ArrayType(EquipType));
                // Seed a filter so ~3/4 of the items are slice-excluded (ghosted) —
                // exercises the slice-effect paint path as well as the rail chrome.
                const slice = $.let(Slice.bind([EquipType], "ex.schematic.stress", cfg, Slice.state({
                    filters: [variant("string", { fieldId: "kind", op: variant("eq", "unit") })],
                }), data, none));
                const tagged = $.let(Slice.partition([EquipType], slice));
                return (
                    <Schematic
                        extent={{ width: 104, height: 100 }}
                        height="460px"
                        items={tagged}
                        item={t => ({
                            key: t.value.id, x: t.value.x, y: t.value.y, label: t.value.id,
                            icon: "microchip", meter: { value: t.value.load, max: 1.0 },
                            excluded: t.matched.not(),
                        })}
                        slice={slice}
                        affordances={["search", "filter"]}
                        sliceOpacity={0.35}
                        sliceDesaturate={true}
                        selectionMode="multiple"
                        minimap={true}
                        scaleUnit="m"
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const schematicLinkEdit = example({
    keywords: ["Schematic", "link", "editing", "connect", "linkMode", "session", "onCreateLink", "onSelectLink", "onEditLink", "onDeleteLink", "readOnlyLinks", "readOnly", "draw", "Reactive", "State", "Switch"],
    description: "Link editing — connect drags item→item (draw adds locally, connect is event-only), Shift+drag grows the session, endpoint handles re-target, Del deletes; canConnect vetoes mixer→shipping",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const log = $.let(State.bind([StringType], "schematic_link_log", "—"));
            const onCreateLink = $.const(East.function([Schematic.Types.LinkCreateEvent], NullType, ($, ev) => {
                $(log.write(East.str`created ${ev.link.from}→${ev.link.to} · session ${East.print(ev.links.size())} · existing ${East.print(ev.existing.size())}`));
            }));
            const onEditLink = $.const(East.function([Schematic.Types.LinkEditEvent], NullType, ($, ev) => {
                $(log.write(East.str`edited ${ev.key} → ${ev.from}→${ev.to}`));
            }));
            const onDeleteLink = $.const(East.function([StringType], NullType, ($, key) => {
                $(log.write(East.str`deleted ${key}`));
            }));
            // Reactive mode switches: `connect` = event-only (plan an operation,
            // nothing drawn); editable off = readOnlyLinks (tool + handles hidden).
            const connectMode = $.let(State.bind([BooleanType], "ex.link.connectmode", false));
            const cOn = $.let(connectMode.read());
            const onC = $.const(East.function([BooleanType], NullType, ($, v) => { $(connectMode.write(v)); }));
            const lm = $.let(
                cOn.ifElse(_$ => variant("connect", null), _$ => variant("draw", null)),
                Schematic.Types.LinkMode,
            );
            const editable = $.let(State.bind([BooleanType], "ex.link.editable", true));
            const eOn = $.let(editable.read());
            const onE = $.const(East.function([BooleanType], NullType, ($, v) => { $(editable.write(v)); }));
            const roLinks = $.let(eOn.not(), BooleanType);
            // Connection validator: mixers never connect DIRECTLY to shipping —
            // product must pass through a packer (drag MIX-1 → SHIP: no snap).
            const canConnect = $.const(East.function([StringType, StringType], BooleanType, (_$, from, to) =>
                from.substring(0n, 3n).equal("MIX").and(() => to.equal("SHIP")).not()));
            // The mode READOUT follows the switch — the description must never
            // claim event-only while draw mode is adding locally.
            const modeTxt = $.let(cOn.ifElse(_$ => "CONNECT — event-only, nothing added", _$ => "DRAW — adds locally"));
            const txt = $.let(log.read());
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="4" align="center">
                        <Switch checked={eOn} label="Links editable" onChange={onE} />
                        <Switch checked={cOn} label="Connect mode" onChange={onC} />
                        <Text.MonoLabel>{East.str`${modeTxt} · ${txt}`}</Text.MonoLabel>
                    </HStack>
                    <Schematic
                        extent={{ width: 22, height: 11 }}
                        height="420px"
                        items={[
                            { id: "MIX-1", x: 3.0, y: 3.0 }, { id: "MIX-2", x: 3.0, y: 8.0 },
                            { id: "PACK-A", x: 12.0, y: 3.0 }, { id: "PACK-B", x: 12.0, y: 8.0 },
                            { id: "SHIP", x: 19.0, y: 5.5 },
                        ]}
                        item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "industry" })}
                        links={[{ id: "l1", a: "PACK-A", b: "SHIP" }]}
                        link={l => ({ key: l.id, from: l.a, to: l.b })}
                        linkMode={lm}
                        readOnlyLinks={roLinks}
                        onCreateLink={onCreateLink}
                        onEditLink={onEditLink}
                        onDeleteLink={onDeleteLink}
                        canConnect={canConnect}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const schematicNets = example({
    keywords: ["Schematic", "net", "nets", "manifold", "bus", "trunk", "header", "bar", "stubs", "sources", "destinations", "via", "label", "linkMode", "onCreateLink", "session", "Reactive", "State", "Switch"],
    description: "Nets — a manifold as ONE row (header bar + stubs, no pairwise explosion); the connect tool grows nets, stub-level selection edits one leg; canConnect keeps CIP-1 supply-only",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const units = $.const([
                { id: "CIP-1", x: 2.0, y: 6.0 },
                { id: "U-01", x: 9.0, y: 2.0 }, { id: "U-02", x: 9.0, y: 4.5 },
                { id: "U-03", x: 9.0, y: 7.0 }, { id: "U-04", x: 9.0, y: 9.5 },
                { id: "PK-A", x: 17.0, y: 3.5 }, { id: "PK-B", x: 17.0, y: 8.0 },
                { id: "DOCK", x: 23.0, y: 6.0 },
            ]);
            const manifolds = $.const([
                { id: "cip", srcs: ["CIP-1"], dsts: ["U-01", "U-02", "U-03", "U-04"], name: "CIP supply", flow: "12 m³/h", path: [] },
                { id: "header", srcs: ["PK-A", "PK-B"], dsts: ["DOCK"], name: "outfeed header", flow: "", path: [{ x: 20.0, y: 6.0 }] },
            ], ArrayType(StructType({
                id: StringType,
                srcs: ArrayType(StringType),
                dsts: ArrayType(StringType),
                name: StringType,
                flow: StringType,
                path: ArrayType(StructType({ x: FloatType, y: FloatType })),
            })));
            const log = $.let(State.bind([StringType], "schematic_net_log", "—"));
            // A Shift-session commit reports the WHOLE growing net — upsert by
            // `net.key` to materialise it as one manifold row.
            const onCreateLink = $.const(East.function([Schematic.Types.LinkCreateEvent], NullType, ($, ev) => {
                $(log.write(East.str`net ${ev.net.key} · ${East.print(ev.net.sources.size())} src → ${East.print(ev.net.destinations.size())} dst · additive ${East.print(ev.additive)}`));
            }));
            // Click a STUB to select one leg (narrow halo), Del removes just that
            // endpoint — onEditNet reports the net's endpoints AFTER the removal.
            const onEditNet = $.const(East.function([Schematic.Types.NetEndpoints], NullType, ($, ev) => {
                $(log.write(East.str`net ${ev.key} edited · ${East.print(ev.sources.size())} src → ${East.print(ev.destinations.size())} dst`));
            }));
            // Connection validator: CIP-1 is supply-only — the connect draft
            // never snaps onto it (covers links, session/net extensions, and
            // re-targets alike).
            const canConnect = $.const(East.function([StringType, StringType], BooleanType, (_$, _from, to) => to.notEqual("CIP-1")));
            // Reactive mode switches: `connect` = event-only (plan the manifold,
            // nothing drawn); editable off = readOnlyLinks (connect tool hidden).
            const connectMode = $.let(State.bind([BooleanType], "ex.net.connectmode", false));
            const cOn = $.let(connectMode.read());
            const onC = $.const(East.function([BooleanType], NullType, ($, v) => { $(connectMode.write(v)); }));
            const lm = $.let(
                cOn.ifElse(_$ => variant("connect", null), _$ => variant("draw", null)),
                Schematic.Types.LinkMode,
            );
            const editable = $.let(State.bind([BooleanType], "ex.net.editable", true));
            const eOn = $.let(editable.read());
            const onE = $.const(East.function([BooleanType], NullType, ($, v) => { $(editable.write(v)); }));
            const roLinks = $.let(eOn.not(), BooleanType);
            // The mode READOUT follows the switch — the description must never
            // claim event-only while draw mode is adding locally.
            const modeTxt = $.let(cOn.ifElse(_$ => "CONNECT — event-only, nothing added", _$ => "DRAW — adds locally"));
            const txt = $.let(log.read());
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="4" align="center">
                        <Switch checked={eOn} label="Links editable" onChange={onE} />
                        <Switch checked={cOn} label="Connect mode" onChange={onC} />
                        <Text.MonoLabel>{East.str`${modeTxt} · ${txt}`}</Text.MonoLabel>
                    </HStack>
                    <Schematic
                        extent={{ width: 26, height: 12 }}
                        height="420px"
                        items={units}
                        item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "industry" })}
                        nets={manifolds}
                        net={m => ({ key: m.id, sources: m.srcs, destinations: m.dsts, label: m.name, via: m.path })}
                        linkMode={lm}
                        readOnlyLinks={roLinks}
                        onCreateLink={onCreateLink}
                        onEditNet={onEditNet}
                        canConnect={canConnect}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const schematicVariants = example({
    keywords: ["Schematic", "canvas", "minimal", "readOnly", "static", "layers", "layer", "visibility", "solo", "lock", "opacity", "toggle", "legend", "geometry", "polygon", "polyline", "circle", "arc", "bulge", "footprint", "zone", "CAD", "shape", "color", "tone", "bg", "override", "style", "facility", "navigator", "minimap", "zoom", "LOD", "click-to-fly", "large", "generate", "Reactive", "State", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Schematic canvas configurator — a canvas preset axis (minimal / layers / geometry / color / facility) plus a read-only switch driving one live canvas",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // readOnly ON makes the shown canvas a pure static picture — the
            // connect / move edit tools never render, leaving just pan / zoom /
            // selection (the old MINIMAL row's fixed prop, now a live switch).
            const roBind = $.let(State.bind([BooleanType], "schematic_readonly", false));
            const roOn = $.let(roBind.read());
            const onRo = $.const(East.function([BooleanType], NullType, ($, v) => { $(roBind.write(v)); }));
            // ---- FACILITY preset (schematicFacility fold-in) — 306 units:
            // navigator rail, minimap, semantic zoom, click-to-fly from the
            // navigator; rows generated with East.Array.generate, each carrying
            // a varied footprint shape/size (circle / square / triangle / diamond).
            const UnitType = StructType({
                key: StringType,
                x: FloatType,
                y: FloatType,
                kind: StringType,
                fill: FloatType,
                cap: FloatType,
                metric: StringType,
                status: OptionType(StatusTokenType),
                // Footprint discriminator + half-size (world units) — the item
                // mapper turns these into a circle / square / triangle / diamond.
                shape: IntegerType,
                size: FloatType,
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
                        // Cycle the four footprint shapes (period 4) and three sizes
                        // (period 3) independently, so consecutive cells vary in both.
                        const shape = $.let(i.remainder(4n));
                        const size = $.let(i.remainder(3n).toFloat().multiply(0.3).add(0.55));
                        return {
                            key: East.str`${prefix}-${East.print(i.add(1n))}`,
                            x: x0.add(col.toFloat().multiply(spacing)).add(jx),
                            y: y0.add(row.toFloat().multiply(spacing)).add(jy),
                            kind: East.str`${East.Float.printFixed(cap, 0n)} t cell`,
                            fill,
                            cap,
                            metric: East.str`${East.Float.printFixed(fill, 1n)} t`,
                            status: statuses.get(i.remainder(6n)),
                            shape,
                            size,
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
            const facilityAreas = $.const([
                { id: "inbound", name: "Inbound", x: 1.0, y: 1.0, w: 28.0, h: 10.0 },
                { id: "hall-a", name: "Process Hall A", x: 31.0, y: 1.0, w: 46.0, h: 22.0 },
                { id: "hall-b", name: "Process Hall B", x: 31.0, y: 25.0, w: 46.0, h: 22.0 },
                { id: "storage", name: "Storage", x: 1.0, y: 13.0, w: 28.0, h: 34.0 },
                { id: "qa", name: "Quality", x: 79.0, y: 1.0, w: 20.0, h: 22.0 },
                { id: "outbound", name: "Outbound", x: 79.0, y: 25.0, w: 20.0, h: 22.0 },
            ]);
            return (
                <Configurator
                    controls={[
                        Configurator.Slot("Editing",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={roOn} label="Read-only" onChange={onRo} />
                            </HStack>),
                    ]}
                    preview={
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
                                // Four footprint shapes of varying size, centred on the
                                // unit's (x, y) anchor — polygon vertices are absolute world
                                // coords, so they are offset from the anchor by ±size.
                                footprint: u.shape.equal(0n).ifElse(
                                    _$ => Schematic.circle(u.size),
                                    _$ => u.shape.equal(1n).ifElse(
                                        _$ => Schematic.polygon([                                      // square
                                            { x: u.x.subtract(u.size), y: u.y.subtract(u.size) },
                                            { x: u.x.add(u.size), y: u.y.subtract(u.size) },
                                            { x: u.x.add(u.size), y: u.y.add(u.size) },
                                            { x: u.x.subtract(u.size), y: u.y.add(u.size) },
                                        ]),
                                        _$ => u.shape.equal(2n).ifElse(
                                            _$ => Schematic.polygon([                                  // triangle
                                                { x: u.x, y: u.y.subtract(u.size) },
                                                { x: u.x.add(u.size), y: u.y.add(u.size) },
                                                { x: u.x.subtract(u.size), y: u.y.add(u.size) },
                                            ]),
                                            _$ => Schematic.polygon([                                  // diamond
                                                { x: u.x, y: u.y.subtract(u.size) },
                                                { x: u.x.add(u.size), y: u.y },
                                                { x: u.x, y: u.y.add(u.size) },
                                                { x: u.x.subtract(u.size), y: u.y },
                                            ]),
                                        ),
                                    ),
                                ),
                            })}
                            zones={facilityAreas}
                            zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h })}
                            scaleUnit="m"
                            grid={true}
                            navigator={true}
                            minimap={true}
                            readOnly={roOn}
                        />
                    }
                    spec={[
                        Configurator.Spec("readOnly", roOn.ifElse(_$ => "on", _$ => "off")),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Layers — items / zones / links grouped into toggleable layers; the canvas
 * layer button opens a panel to show / hide / solo / lock each layer.
 */
export const schematicLayers = example({
    keywords: ["Schematic", "layers", "layer", "visibility", "solo", "lock", "opacity", "toggle", "legend"],
    description: "Layer chrome — shell locked and dimmed, maintenance shipped hidden; the layer panel shows / hides / solos / locks each",
    fn: East.function([], UIComponentType, (_$) => {
        const SCHEMATIC_LAYERS_DATA = [
            { id: "GATE", x: 2.5, y: 6.0, kind: "entry", sys: "shell" },
            { id: "PUMP-1", x: 6.0, y: 4.0, kind: "pump", sys: "process" },
            { id: "TANK-2", x: 12.0, y: 4.0, kind: "tank", sys: "process" },
            { id: "VALVE-3", x: 18.0, y: 7.0, kind: "valve", sys: "utilities" },
            { id: "SENS-4", x: 9.0, y: 9.0, kind: "sensor", sys: "maintenance" },
        ];
        const SCHEMATIC_LAYERS_ROOMS_DATA = [
            { id: "hall", name: "Hall A", x: 1.0, y: 1.0, w: 22.0, h: 11.0 },
        ];
        const SCHEMATIC_LAYERS_PIPES_DATA = [
            { id: "p1", a: "PUMP-1", b: "TANK-2" },
            { id: "p2", a: "TANK-2", b: "VALVE-3" },
        ];
        return (
        <Schematic
            extent={{ width: 24, height: 13 }}
            height="420px"
            items={SCHEMATIC_LAYERS_DATA}
            item={e => ({ key: e.id, x: e.x, y: e.y, label: e.id, sublabel: e.kind, icon: "gear", layer: e.sys })}
            zones={SCHEMATIC_LAYERS_ROOMS_DATA}
            zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, layer: "shell" })}
            links={SCHEMATIC_LAYERS_PIPES_DATA}
            link={l => ({ key: l.id, from: l.a, to: l.b, layer: "utilities" })}
            layers={[
                { key: "shell", label: "Building shell", tone: "muted", locked: true, opacity: 0.45 },
                { key: "process", label: "Process", tone: "brand" },
                { key: "utilities", label: "Utilities", tone: "success" },
                { key: "maintenance", label: "Maintenance", tone: "warning", visible: false },
            ]}
            scaleUnit="m"
        />
    );
    }),
    inputs: [],
});

/**
 * Geometry — polygon & arc-aware polyline zones plus polygon / circle item
 * footprints.
 */
export const schematicGeometry = example({
    keywords: ["Schematic", "geometry", "polygon", "polyline", "circle", "arc", "bulge", "footprint", "zone", "CAD", "shape", "grid"],
    description: "CAD geometry — polygon and arc-aware polyline zones with polygon / circle item footprints on the metric grid",
    fn: East.function([], UIComponentType, (_$) => {
        const SCHEMATIC_GEOMETRY_DATA = [
            { id: "PUMP-1", x: 6.0, y: 4.0, kind: "transfer pump", state: some(variant("success", null)), fp: true, round: false, r: 0.0,
              pts: [{ x: 3.5, y: 2.2, bulge: 0.0 }, { x: 8.6, y: 3.0, bulge: 0.0 }, { x: 8.0, y: 6.0, bulge: 0.0 }, { x: 2.9, y: 5.2, bulge: 0.0 }] },
            { id: "UNIT-9", x: 16.0, y: 4.5, kind: "storage tank", state: some(variant("warning", null)), fp: false, round: true, r: 2.4,
              pts: [{ x: 16.0, y: 4.5, bulge: 0.0 }] },
            { id: "VALVE-3", x: 21.6, y: 4.5, kind: "manifold", state: some(variant("info", null)), fp: false, round: false, r: 0.0,
              pts: [{ x: 21.6, y: 4.5, bulge: 0.0 }] },
        ];
        const SCHEMATIC_GEOMETRY_AREAS_DATA = [
            { id: "hall-c", name: "Hall C", x: 1.5, y: 1.2, w: 9.1, h: 6.4, road: false,
              pts: [{ x: 1.8, y: 2.0, bulge: 0.0 }, { x: 10.2, y: 1.3, bulge: 0.0 }, { x: 10.6, y: 7.0, bulge: 0.0 }, { x: 2.2, y: 7.6, bulge: 0.0 }] },
            { id: "svc-rd", name: "Service Rd", x: 1.0, y: 9.0, w: 23.5, h: 3.4, road: true,
              pts: [{ x: 1.5, y: 11.6, bulge: 0.0 }, { x: 7.0, y: 9.8, bulge: 0.5 }, { x: 13.0, y: 11.4, bulge: -0.5 }, { x: 19.0, y: 9.6, bulge: 0.4 }, { x: 24.0, y: 10.8, bulge: 0.0 }] },
        ];
        return (
        <Schematic
            extent={{ width: 26, height: 14 }}
            height="440px"
            items={SCHEMATIC_GEOMETRY_DATA}
            item={e => ({
                key: e.id, x: e.x, y: e.y, label: e.id,
                sublabel: e.kind, status: e.state, icon: "industry",
                footprint: e.round.ifElse(
                    _$ => Schematic.circle(e.r),
                    _$ => e.fp.ifElse(_$ => Schematic.polygon(e.pts), _$ => Schematic.rect()),
                ),
            })}
            zones={SCHEMATIC_GEOMETRY_AREAS_DATA}
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

/**
 * Colour overrides — raw color + bg on item footprints (category palette
 * independent of status) and a toned, filled area.
 */
export const schematicColorOverrides = example({
    keywords: ["Schematic", "color", "tone", "bg", "override", "fillOpacity", "palette", "style"],
    description: "Colour overrides — raw color/bg per item footprint and a toned filled zone, independent of status",
    fn: East.function([], UIComponentType, (_$) => {
        const SCHEMATIC_COLOR_OVERRIDE_DATA = [
            { id: "U-1", x: 4.0, y: 4.0, r: 1.4, fill: "bg.brand.subtle" },
            { id: "U-2", x: 8.0, y: 4.0, r: 1.4, fill: "bg.success.subtle" },
            { id: "U-3", x: 12.0, y: 4.0, r: 1.4, fill: "bg.subtle" },
        ];
        const SCHEMATIC_COLOR_OVERRIDE_AREAS_DATA = [
            { id: "bay", name: "Bay", x: 1.5, y: 1.5, w: 13.0, h: 5.5 },
        ];
        return (
        <Schematic
            extent={{ width: 16, height: 8 }}
            height="360px"
            items={SCHEMATIC_COLOR_OVERRIDE_DATA}
            item={e => ({
                key: e.id, x: e.x, y: e.y, label: e.id,
                footprint: Schematic.circle(e.r),
                color: e.fill,
                bg: e.fill,
                fillOpacity: 0.18,
            })}
            zones={SCHEMATIC_COLOR_OVERRIDE_AREAS_DATA}
            zone={z => ({
                key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h,
                tone: "brand",
                bg: "bg.brand.subtle",
            })}
            scaleUnit="m"
        />
    );
    }),
    inputs: [],
});

export const schematicSlice = example({
    keywords: ["Schematic", "slice", "sliceEffect", "excluded", "ghost", "desaturate", "pulse", "halo", "frame", "partition", "filter", "reactive", "switch", "State", "selection", "selectionMode", "sliceSelectField", "in", "marquee", "onSelectionChange"],
    description: "Slice panel — slice effect (Slice.partition tags rows; excluded ghost/desaturate reactively via slice* props) and select filter (marquee selection writes an in-filter; the rest ghost)",
    fn: East.function([], UIComponentType, (_$) => {
        const SCHEMATIC_SLICE_EFFECT_DATA = [
            { id: "UNIT-04", x: 3.5, y: 2.6, kind: "unit", st: some(variant("success", null)) },
            { id: "UNIT-05", x: 11.5, y: 2.6, kind: "unit", st: some(variant("success", null)) },
            { id: "LINE-2", x: 4.5, y: 6.2, kind: "pack", st: some(variant("warning", null)) },
            { id: "BAY-OUT", x: 12.0, y: 6.2, kind: "pallets", st: some(variant("info", null)) },
        ];
        const SCHEMATIC_SELECT_FILTER_DATA = [
            { id: "A", x: 3.5, y: 3.0, kind: "unit" },
            { id: "B", x: 8.0, y: 3.0, kind: "unit" },
            { id: "C", x: 12.5, y: 3.0, kind: "pack" },
            { id: "D", x: 5.5, y: 6.4, kind: "unit" },
            { id: "E", x: 10.0, y: 6.4, kind: "pack" },
        ];
        const EffectEquipType = StructType({ id: StringType, x: FloatType, y: FloatType, kind: StringType, st: OptionType(StatusTokenType) });
        const effectCfg = Slice.config(EffectEquipType, {
            fields: { id: { label: "ID" }, kind: { label: "Kind" } },
            searchFieldIds: ["id", "kind"],
        });
        const FilterEquipType = StructType({ id: StringType, x: FloatType, y: FloatType, kind: StringType });
        const filterCfg = Slice.config(FilterEquipType, {
            fields: { id: { label: "ID" }, kind: { label: "Kind" } },
            searchFieldIds: ["id", "kind"],
        });
        return (
            <VStack gap="4" align="stretch">
                <Separator label="SLICE EFFECT" align="start" />
                <Reactive>{$ => {
                        const data = $.const(SCHEMATIC_SLICE_EFFECT_DATA, ArrayType(EffectEquipType));
                        // Seed an active filter (kind = "unit") so two rows already fail
                        // the narrowing — the effect is visible at first render: the
                        // "pack" / "pallets" units ghost out, the "unit" survivors pulse.
                        const slice = $.let(Slice.bind([EffectEquipType], "ex.schematic.effect", effectCfg, Slice.state({
                            filters: [variant("string", { fieldId: "kind", op: variant("eq", "unit") })],
                        }), data, none));
                        // Full set tagged with pass/fail — excluded rows STAY (ghosted),
                        // rather than the pre-narrowed `Slice.rows`.
                        const tagged = $.let(Slice.partition([EffectEquipType], slice));

                        // Every effect setting is a flat `slice*` prop (SubtypeExprOrValue),
                        // so a State-bound switch drives it reactively — flip a switch, the
                        // schematic re-renders in place. No builder, no escape hatch.
                        const hide = $.let(State.bind([BooleanType], "ex.effect.hide", false));
                        const desat = $.let(State.bind([BooleanType], "ex.effect.desat", true));
                        const pulse = $.let(State.bind([BooleanType], "ex.effect.pulse", true));
                        const frame = $.let(State.bind([BooleanType], "ex.effect.frame", true));
                        const opacity = $.let(State.bind([FloatType], "ex.effect.opacity", 0.35));
                        const hideOn = $.let(hide.read());
                        const desatOn = $.let(desat.read());
                        const pulseOn = $.let(pulse.read());
                        const frameOn = $.let(frame.read());
                        const opacityVal = $.let(opacity.read());
                        const onHide = $.const(East.function([BooleanType], NullType, ($, v) => { $(hide.write(v)); }));
                        const onDesat = $.const(East.function([BooleanType], NullType, ($, v) => { $(desat.write(v)); }));
                        const onPulse = $.const(East.function([BooleanType], NullType, ($, v) => { $(pulse.write(v)); }));
                        const onFrame = $.const(East.function([BooleanType], NullType, ($, v) => { $(frame.write(v)); }));
                        const onOpacity = $.const(East.function([FloatType], NullType, ($, v) => { $(opacity.write(v)); }));
                        // Reactive emphasis option — `some(pulse)` on, `none` (ring off) off.
                        const emphasis = $.let(
                            pulseOn.ifElse(_$ => some(variant("pulse", null)), _$ => none),
                            OptionType(Schematic.Types.Emphasis),
                        );
                        return (
                            <VStack gap="3" align="stretch">
                                <HStack gap="4">
                                    <Switch checked={hideOn} label="Hide filtered" onChange={onHide} />
                                    <Switch checked={desatOn} label="Desaturate" onChange={onDesat} />
                                    <Switch checked={pulseOn} label="Pulse ring" onChange={onPulse} />
                                    <Switch checked={frameOn} label="Frame" onChange={onFrame} />
                                </HStack>
                                <HStack gap="3" align="center">
                                    <Text.MonoLabel>OPACITY</Text.MonoLabel>
                                    <Slider value={opacityVal} min={0} max={1} step={0.05} onChange={onOpacity} />
                                </HStack>
                                <Schematic
                                    extent={{ width: 16, height: 9 }}
                                    height="400px"
                                    items={tagged}
                                    item={t => ({
                                        key: t.value.id, x: t.value.x, y: t.value.y, label: t.value.id,
                                        sublabel: t.value.kind, icon: "database", status: t.value.st,
                                        excluded: t.matched.not(),
                                    })}
                                    slice={slice}
                                    affordances={["search", "filter"]}
                                    sliceOpacity={opacityVal}
                                    sliceDesaturate={desatOn}
                                    sliceEmphasis={emphasis}
                                    sliceFrame={frameOn}
                                    sliceHidden={hideOn}
                                />
                            </VStack>
                        );
                    }}</Reactive>
                <Separator label="SELECT FILTER" align="start" />
                <Reactive>{$ => {
                        const data = $.const(SCHEMATIC_SELECT_FILTER_DATA, ArrayType(FilterEquipType));
                        // No initial filter — everything matches until a selection writes one.
                        const slice = $.let(Slice.bind([FilterEquipType], "ex.schematic.selfilter", filterCfg, Slice.state({}), data, none));
                        // Full set tagged pass/fail; a marquee selection writes `in(id, keys)`
                        // via sliceSelectField, so the non-selected re-tag excluded → ghost.
                        const tagged = $.let(Slice.partition([FilterEquipType], slice));
                        return (
                            <VStack gap="3" align="stretch">
                                <Schematic
                                    extent={{ width: 16, height: 9 }}
                                    height="400px"
                                    items={tagged}
                                    item={t => ({
                                        key: t.value.id, x: t.value.x, y: t.value.y, label: t.value.id,
                                        sublabel: t.value.kind, icon: "database", excluded: t.matched.not(),
                                    })}
                                    slice={slice}
                                    affordances={["filter"]}
                                    selectionMode="multiple"
                                    sliceSelectField="id"
                                    sliceOpacity={0.2}
                                    sliceDesaturate={true}
                                />
                                <Text.MonoLabel>DRAG A BOX TO SELECT · the rest ghost via the slice</Text.MonoLabel>
                            </VStack>
                        );
                    }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});

export const schematicInteractions = example({
    keywords: ["Schematic", "Reactive", "State", "onSelect", "onItemOpen", "double-click", "open", "drill-in", "interactive", "selection", "selectionMode", "single", "multiple", "marquee", "onSelectionChange", "selectZoomFocus", "focus", "zoom", "multi-select", "Switch", "zone", "area", "onSelectZone", "onZoneSelectionChange", "childItemKeys", "move", "reposition", "drag", "onMoveItem", "readOnlyItems", "editing", "group", "hover", "HoverCard", "itemHover", "zoneHover", "linkHover", "Sparkline", "chart", "inspection", "lazy", "viewport", "onViewportChange", "camera", "bounds", "settle", "SegmentGroup", "Configurator", "getTag", "configurator"],
    description: "Schematic interaction configurator — a tool axis (select / marquee / zone / move) plus multi-select, zoom-focus and movable switches; hover cards stay on; the aside logs five event lines",
    fn: East.function([], UIComponentType, (_$) => {
        const SCHEMATIC_INTERACTIONS_ITEMS = [
            { id: "CELL-A", x: 3.0, y: 3.0 },
            { id: "CELL-B", x: 9.0, y: 3.0 },
            { id: "M1", x: 15.0, y: 3.0 },
            { id: "P1", x: 6.0, y: 9.0 }, { id: "P2", x: 18.0, y: 9.0 },
        ];
        const SCHEMATIC_INTERACTIONS_ZONES = [
            { id: "hall-a", name: "Hall A", x: 1.0, y: 1.0, w: 10.0, h: 4.5 },
            { id: "hall-b", name: "Hall B", x: 12.5, y: 1.0, w: 10.5, h: 4.5 },
            { id: "dock", name: "Dock", x: 1.0, y: 7.0, w: 22.0, h: 4.0 },
        ];
        return (
        <Reactive>{$ => {
            // The tool axis is a bare label array — the control and the
            // per-tool prop mapping below read the same four keys.
            const tools = $.const(["select", "marquee", "zone", "move"], ArrayType(StringType));
            // Tool mode — select / marquee / zone / move.
            const toolBind = $.let(State.bind([StringType], "schematic_tool", "select"));
            const tool = $.let(toolBind.read());
            const onToolChange = $.const(East.function([StringType], NullType, ($, next) => {
                $(toolBind.write(next));
            }));
            // Event log binds + callbacks (verbatim from schematicInteractive).
            const bind = $.let(State.bind([StringType], "schematic_selected", "none"));
            const opened = $.let(State.bind([StringType], "schematic_opened", "none"));
            const onSelect = $.const(East.function([StringType], NullType, ($, key) => {
                $(bind.write(key));
            }));
            const onItemOpen = $.const(East.function([StringType], NullType, ($, key) => {
                $(opened.write(key));
            }));
            const selected = $.let(bind.read());
            const openedKey = $.let(opened.read());
            // The full selected-key set is mirrored into State on every change
            // (verbatim from schematicRangeSelect).
            const keysBind = $.let(State.bind([ArrayType(StringType)], "schematic_selected_keys", []));
            const onSelectionChange = $.const(East.function([Schematic.Types.SelectionEvent], NullType, ($, ev) => {
                $(keysBind.write(ev.selectedKeys));
            }));
            const keys = $.let(keysBind.read());
            const count = $.let(keys.size());
            // Reactive toggle for the camera-on-select behaviour (schematicRangeSelect's
            // switch, original State key) — applied under the marquee tool.
            const focus = $.let(State.bind([BooleanType], "ex.schematic.focus", true));
            const focusOn = $.let(focus.read());
            const onFocus = $.const(East.function([BooleanType], NullType, ($, v) => { $(focus.write(v)); }));
            // Multi-select switch (schematicRangeSelect's original key; the zone
            // example's ex.zone.multi toggled the same selectionMode variant and
            // folds into this one control).
            const multi = $.let(State.bind([BooleanType], "ex.schematic.multi", true));
            const multiOn = $.let(multi.read());
            const onMulti = $.const(East.function([BooleanType], NullType, ($, v) => { $(multi.write(v)); }));
            // Zone-selection log line (verbatim from schematicZoneSelect).
            const readout = $.let(State.bind([StringType], "schematic_zone_sel", "—"));
            const onZoneSelectionChange = $.const(East.function([Schematic.Types.ZoneSelectionEvent], NullType, ($, ev) => {
                $(readout.write(East.str`${East.print(ev.selectedKeys.size())} zone(s) · ${East.print(ev.childItemKeys.size())} item(s) inside`));
            }));
            const zoneTxt = $.let(readout.read());
            // Move log + movable switch (verbatim from schematicItemMove).
            const log = $.let(State.bind([StringType], "schematic_move_log", "—"));
            const onMoveItem = $.const(East.function([Schematic.Types.ItemMoveEvent], NullType, ($, ev) => {
                $(log.write(East.str`moved ${East.print(ev.keys.size())} item(s) · ${ev.key} → ${East.Float.printFixed(ev.x, 1n)}, ${East.Float.printFixed(ev.y, 1n)}`));
            }));
            const movable = $.let(State.bind([BooleanType], "ex.move.on", true));
            const mOn = $.let(movable.read());
            const onM = $.const(East.function([BooleanType], NullType, ($, v) => { $(movable.write(v)); }));
            const moveTxt = $.let(log.read());
            // Debounced viewport line (verbatim from schematicViewport).
            const viewportBind = $.let(State.bind([StringType], "schematic_viewport", "—"));
            const onViewportChange = $.const(East.function([Schematic.Types.ViewportEvent], NullType, ($, ev) => {
                $(viewportBind.write(East.str`zoom ${East.Float.printFixed(ev.zoom, 1n)} · x ${East.Float.printFixed(ev.minX, 1n)}..${East.Float.printFixed(ev.maxX, 1n)} · y ${East.Float.printFixed(ev.minY, 1n)}..${East.Float.printFixed(ev.maxY, 1n)}`));
            }));
            const viewportTxt = $.let(viewportBind.read());
            // Hover cards (verbatim from schematicHover) — enabled in ALL modes;
            // hover config is orthogonal to the tool.
            const itemHover = $.const(East.function([StringType], UIComponentType, (_$, key) => (
                <VStack gap="1" align="flex-start">
                    <Text.MonoLabel>{East.str`${key} · throughput (7d)`}</Text.MonoLabel>
                    <Sparkline data={[3.2, 4.1, 3.8, 5.0, 4.6, 5.4, 5.1]} type="area" width="180px" height="44px" />
                </VStack>
            )));
            const zoneHover = $.const(East.function([StringType], UIComponentType, (_$, key) => (
                <Text.MonoLabel>{East.str`${key} — CIP window 14:00–15:00`}</Text.MonoLabel>
            )));
            const linkHover = $.const(East.function([StringType], UIComponentType, (_$, key) => (
                <Text.MonoLabel>{East.str`${key} · 12.4 m³/h`}</Text.MonoLabel>
            )));
            // Per-tool prop mapping — where a prop differs per tool mode it is
            // derived from the mode value with ifElse.
            const selMode = $.let(
                tool.equal("select").ifElse(
                    // Select — single-tap inspection.
                    _$ => variant("single", null),
                    _$ => tool.equal("move").ifElse(
                        // Move — keeps `multiple` so dragging a SELECTED item moves
                        // the whole selection rigidly (schematicItemMove).
                        _$ => variant("multiple", null),
                        // Marquee / zone — honour the Multi-select switch (marquee
                        // and Shift-extend need `multiple`).
                        _$ => multiOn.ifElse(_$ => variant("multiple", null), _$ => variant("single", null)),
                    ),
                ),
                Schematic.Types.SelectionMode,
            );
            // Camera-on-select only under the marquee tool: focus ON flies / fits,
            // OFF leaves the camera put (schematicRangeSelect).
            const zoomFocus = $.let(tool.equal("marquee").ifElse(_$ => focusOn, _$ => false), BooleanType);
            // Items reposition only under the move tool, gated by its switch.
            const roItems = $.let(tool.equal("move").ifElse(_$ => mOn.not(), _$ => true), BooleanType);
            return (
                <Configurator
                    controls={[
                        Configurator.Control("Tool", tool,
                            <Select value={tool} onChange={onToolChange} size="sm"
                                items={tools.map((_$, t) => Select.Item(t, t))} />),
                        // Slots, not Controls: the switches report through the
                        // aside's event log rather than as one value each.
                        Configurator.Slot("Selection",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={multiOn} label="Multi-select (marquee/zone)" onChange={onMulti} />
                            </HStack>),
                        Configurator.Slot("Camera",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={focusOn} label="Zoom focus (marquee)" onChange={onFocus} />
                            </HStack>),
                        Configurator.Slot("Items",
                            <HStack gap="5" align="center" wrap="wrap">
                                <Switch checked={mOn} label="Movable (move)" onChange={onM} />
                            </HStack>),
                    ]}
                    preview={
                        /* schematicZoneSelect's 24 × 12 extent — the zone bodies (and
                           the M1 / P1 / P2 rows inside them) need the wider world rect. */
                        <Schematic
                            navigator={false}
                            extent={{ width: 24, height: 12 }}
                            height="440px"
                            items={SCHEMATIC_INTERACTIONS_ITEMS}
                            item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "industry" })}
                            zones={SCHEMATIC_INTERACTIONS_ZONES}
                            zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h })}
                            onSelect={onSelect}
                            onItemOpen={onItemOpen}
                            selectionMode={selMode}
                            selectZoomFocus={zoomFocus}
                            onSelectionChange={onSelectionChange}
                            onZoneSelectionChange={onZoneSelectionChange}
                            readOnlyItems={roItems}
                            onMoveItem={onMoveItem}
                            itemHover={itemHover}
                            zoneHover={zoneHover}
                            linkHover={linkHover}
                            onViewportChange={onViewportChange}
                        />
                    }
                    aside={{
                        label: "Event log · Reactive",
                        body: (
                            <VStack gap="1" align="stretch">
                                <Text fontFamily="mono">{East.str`INSPECTING · ${selected} · OPENED · ${openedKey}`}</Text>
                                <Text fontFamily="mono">{East.str`SELECTED · ${East.print(count)}`}</Text>
                                <Text fontFamily="mono">{East.str`ZONES · ${zoneTxt}`}</Text>
                                <Text fontFamily="mono">{East.str`MOVE · ${moveTxt}`}</Text>
                                <Text fontFamily="mono">{East.str`VIEW · ${viewportTxt}`}</Text>
                            </VStack>
                        ),
                    }}
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});
