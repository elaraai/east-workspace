/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, example, variant, some, none } from "@elaraai/east";
import { State, StatusTokenType, UIComponentType } from "@elaraai/east-ui";
import { Configurator, HStack, Reactive, Schematic, Select, Separator, Slice, Slider, Sparkline, Switch, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// A data centre floor: racks with power meters, halls and cages with hatched
// hot and cold aisles, fibre runs, power distribution units feeding racks, and
// power / cooling / network / structure layers.
// ============================================================================

export const schematicFloor = example({
    keywords: ["Schematic", "canvas", "items", "zones", "links", "meter", "status", "hatch", "label", "metric", "parallel", "fan-out", "flow"],
    description: "Data centre floor — racks with power meters in a cage, a hatched cold aisle, and fibre runs to the frame, two of them fanned into parallel lanes",
    fn: East.function([], UIComponentType, ($) => {
        const equipment = $.const([
            { id: "A01", x: 2.4, y: 2.9, kind: "42U · 8 kW", used: 5.2, cap: 8.0, metric: "5.2 kW", state: some(variant("success", null)), w: 3.2 },
            { id: "A02", x: 6.0, y: 2.9, kind: "42U · 8 kW", used: 7.4, cap: 8.0, metric: "7.4 kW", state: some(variant("warning", null)), w: 3.2 },
            { id: "A03", x: 9.6, y: 2.9, kind: "42U · 8 kW", used: 3.9, cap: 8.0, metric: "3.9 kW", state: some(variant("success", null)), w: 3.2 },
            { id: "A04", x: 13.2, y: 2.9, kind: "48U · 12 kW", used: 9.6, cap: 12.0, metric: "9.6 kW", state: some(variant("success", null)), w: 3.2 },
            { id: "A05", x: 16.8, y: 2.9, kind: "48U · 12 kW", used: 0.0, cap: 12.0, metric: "reserved", state: some(variant("neutral", null)), w: 3.2 },
            { id: "MMR-1", x: 24.2, y: 2.9, kind: "demarc · 48 ports", used: 31.0, cap: 48.0, metric: "31 / 48", state: some(variant("info", null)), w: 4.0 },
            { id: "ODF-1", x: 8.4, y: 9.6, kind: "fibre frame · 288 F", used: 196.0, cap: 288.0, metric: "196 / 288", state: some(variant("success", null)), w: 12.8 },
            { id: "CORE-1", x: 23.2, y: 9.7, kind: "core · 64 ports", used: 41.0, cap: 64.0, metric: "41 / 64", state: some(variant("success", null)), w: 4.0 },
        ]);
        const areas = $.const([
            { id: "cage-a", name: "Cage A", x: 0.6, y: 0.6, w: 19.6, h: 4.6, pattern: Schematic.outline() },
            { id: "mmr", name: "Meet-me room", x: 21.0, y: 0.6, w: 6.4, h: 4.6, pattern: Schematic.outline() },
            { id: "cold-a", name: "Cold aisle A · 1.2 m", x: 0.6, y: 6.0, w: 26.8, h: 1.2, pattern: Schematic.hatch() },
            { id: "net-room", name: "Network room", x: 19.0, y: 7.8, w: 8.4, h: 3.8, pattern: Schematic.outline() },
        ]);
        // Already the resolved link type — passed through with no `link` mapper.
        const orthogonal = variant("orthogonal", { corner: none });
        // u2 + u2m share the same endpoint pair — the renderer fans them into
        // parallel lanes (#180) so both edges (the uplink and the out-of-band
        // management link) stay readable; labels/metrics render mid-path at
        // label zoom.
        const fibre = $.const([
            { key: "u1", from: "A01", to: "ODF-1", label: some("uplink"), metric: some("100G"), style: Schematic.solid(), route: orthogonal, via: [], layer: none },
            { key: "u2", from: "A02", to: "ODF-1", label: some("uplink"), metric: some("100G"), style: Schematic.solid(), route: orthogonal, via: [], layer: none },
            { key: "u2m", from: "A02", to: "ODF-1", label: some("OOB mgmt"), metric: none, style: Schematic.dashed(), route: orthogonal, via: [], layer: none },
            { key: "u3", from: "A03", to: "ODF-1", label: none, metric: none, style: Schematic.solid(), route: orthogonal, via: [], layer: none },
            { key: "u4", from: "A04", to: "ODF-1", label: none, metric: some("2 × 100G"), style: Schematic.solid(), route: orthogonal, via: [], layer: none },
            { key: "x1", from: "MMR-1", to: "CORE-1", label: none, metric: some("2 × 10G"), style: Schematic.dashed(), route: orthogonal, via: [{ x: 26.0, y: 6.6 }], layer: none },
        ], ArrayType(Schematic.Types.Link));
        return (
            <Schematic
                extent={{ width: 28, height: 12 }}
                height="440px"
                items={equipment}
                item={e => ({
                    key: e.id, x: e.x, y: e.y, label: e.id,
                    sublabel: e.kind, icon: "server",
                    status: e.state,
                    meter: { value: e.used, max: e.cap },
                    metric: e.metric,
                    width: e.w,
                })}
                zones={areas}
                zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, pattern: z.pattern })}
                links={fibre}
                scaleUnit="m"
                grid={true}
            />
        );
    }),
    inputs: [],
});

// 3,000 generated racks in one hall — authored at MODULE scope (an East
// function's body must be East all the way down; authoring-time constants are
// host-declared outside it).
const STRESS_KINDS = ["compute", "storage", "network", "gpu"];
// A large generated hall — the count is the perf-probe knob (#302-adjacent
// schematic-slice-perf): bump it to reproduce the slice-on pan/zoom slowdown at
// scale. 3,000 sits above the 2,000-item pan budget. Racks stand in pairs of
// rows facing across a cold aisle, a wider hot aisle between the pairs, and a
// cross aisle splits every row.
const STRESS_ROW_RACKS = 75;
const STRESS_GRID_ITEMS = Array.from({ length: 3000 }, (_, i) => {
    const row = Math.floor(i / STRESS_ROW_RACKS), pos = i % STRESS_ROW_RACKS;
    return {
        id: `R${String(row + 1).padStart(2, "0")}-${String(pos + 1).padStart(2, "0")}`,
        x: pos * 1.2 + (pos >= 38 ? 2.4 : 0.0) + 1.6,
        y: Math.floor(row / 2) * 4.4 + (row % 2) * 1.4 + 1.6,
        load: (i * 61 % 97) / 97,
        kind: STRESS_KINDS[(row * 3 + pos) % STRESS_KINDS.length]!,
    };
});

export const schematicStress = example({
    keywords: ["Schematic", "stress", "performance", "LOD", "semantic zoom", "declutter", "minimap", "large", "many items", "slice", "sliceEffect", "pan", "zoom", "10k"],
    description: "Stress probe — 3,000 generated racks exercise the LOD ladder and Slice chrome (rail + ghosting) at scale; the pan/zoom perf budget with slice on",
    fn: East.function([], UIComponentType, (_$) => {
        const RackType = StructType({ id: StringType, x: FloatType, y: FloatType, load: FloatType, kind: StringType });
        return (
            <Reactive>{$ => {
                const data = $.const(STRESS_GRID_ITEMS, ArrayType(RackType));
                // Seed a filter so ~3/4 of the racks are slice-excluded (ghosted) —
                // exercises the slice-effect paint path as well as the rail chrome.
                const slice = $.let(Slice.bind("ex.schematic.stress", data, {
                    fields: { id: { label: "Rack" }, kind: { label: "Kind" } }, search: ["id", "kind"],
                    initial: { kind: ["gpu"] },
                }));
                const tagged = $.let(Slice.partition([RackType], slice));
                return (
                    <Schematic
                        extent={{ width: 95, height: 89 }}
                        height="460px"
                        items={tagged}
                        item={t => ({
                            key: t.value.id, x: t.value.x, y: t.value.y, label: t.value.id,
                            icon: "server", meter: { value: t.value.load, max: 1.0 },
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
    description: "Link editing — connect drags item→item (draw adds locally, connect is event-only), Shift+drag grows the session, endpoint handles re-target, Del deletes; canConnect vetoes server→core",
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
            // Connection validator: a server never connects DIRECTLY to the
            // core — it goes through a top-of-rack switch (drag SRV-1 → CORE: no snap).
            const canConnect = $.const(East.function([StringType, StringType], BooleanType, (_$, from, to) =>
                from.substring(0n, 3n).equal("SRV").and(() => to.equal("CORE")).not()));
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
                        extent={{ width: 24, height: 12 }}
                        height="420px"
                        items={[
                            { id: "SRV-1", x: 3.4, y: 3.2 }, { id: "SRV-2", x: 3.4, y: 8.6 },
                            { id: "TOR-A", x: 12.6, y: 3.2 }, { id: "TOR-B", x: 12.6, y: 8.6 },
                            { id: "CORE", x: 20.6, y: 5.9 },
                        ]}
                        item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "server" })}
                        links={[{ id: "f1", a: "TOR-A", b: "CORE" }]}
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
    keywords: ["Schematic", "net", "nets", "bus", "busway", "trunk", "header", "bar", "stubs", "sources", "destinations", "via", "label", "metric", "linkMode", "onCreateLink", "session", "Reactive", "State", "Switch"],
    description: "Nets — a power distribution unit's circuits as ONE row (header bar + stubs, no pairwise explosion); the connect tool grows nets, stub-level selection edits one leg; canConnect keeps PDU-1 supply-only",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const units = $.const([
                { id: "PDU-1", x: 2.5, y: 6.5 },
                { id: "B01", x: 10.0, y: 1.8 }, { id: "B02", x: 10.0, y: 4.6 },
                { id: "B03", x: 10.0, y: 7.4 }, { id: "B04", x: 10.0, y: 10.2 },
                { id: "TOR-A", x: 17.5, y: 3.4 }, { id: "TOR-B", x: 17.5, y: 8.2 },
                { id: "SPINE", x: 24.0, y: 6.0 },
            ]);
            const buses = $.const([
                { id: "pdu-1-a", srcs: ["PDU-1"], dsts: ["B01", "B02", "B03", "B04"], name: "PDU-1 · A side", load: "22 kW", path: [] },
                { id: "uplinks", srcs: ["TOR-A", "TOR-B"], dsts: ["SPINE"], name: "spine uplinks", load: "4 × 100G", path: [{ x: 20.0, y: 6.0 }] },
            ], ArrayType(StructType({
                id: StringType,
                srcs: ArrayType(StringType),
                dsts: ArrayType(StringType),
                name: StringType,
                load: StringType,
                path: ArrayType(StructType({ x: FloatType, y: FloatType })),
            })));
            const log = $.let(State.bind([StringType], "schematic_net_log", "—"));
            // A Shift-session commit reports the WHOLE growing net — upsert by
            // `net.key` to materialise it as one bus row.
            const onCreateLink = $.const(East.function([Schematic.Types.LinkCreateEvent], NullType, ($, ev) => {
                $(log.write(East.str`net ${ev.net.key} · ${East.print(ev.net.sources.size())} src → ${East.print(ev.net.destinations.size())} dst · additive ${East.print(ev.additive)}`));
            }));
            // Click a STUB to select one leg (narrow halo), Del removes just that
            // endpoint — onEditNet reports the net's endpoints AFTER the removal.
            const onEditNet = $.const(East.function([Schematic.Types.NetEndpoints], NullType, ($, ev) => {
                $(log.write(East.str`net ${ev.key} edited · ${East.print(ev.sources.size())} src → ${East.print(ev.destinations.size())} dst`));
            }));
            // Connection validator: PDU-1 is supply-only — the connect draft
            // never snaps onto it (covers links, session/net extensions, and
            // re-targets alike).
            const canConnect = $.const(East.function([StringType, StringType], BooleanType, (_$, _from, to) => to.notEqual("PDU-1")));
            // Reactive mode switches: `connect` = event-only (plan the bus,
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
                        extent={{ width: 27, height: 12.5 }}
                        height="420px"
                        items={units}
                        item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "server" })}
                        nets={buses}
                        net={m => ({ key: m.id, sources: m.srcs, destinations: m.dsts, label: m.name, metric: m.load, via: m.path })}
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
    description: "Schematic canvas configurator — a data centre's 260 generated units across six rooms (navigator, minimap, semantic zoom, varied footprints), with a read-only switch driving the one live canvas",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // readOnly ON makes the shown canvas a pure static picture — the
            // connect / move edit tools never render, leaving just pan / zoom /
            // selection (the old MINIMAL row's fixed prop, now a live switch).
            const roBind = $.let(State.bind([BooleanType], "schematic_readonly", false));
            const roOn = $.let(roBind.read());
            const onRo = $.const(East.function([BooleanType], NullType, ($, v) => { $(roBind.write(v)); }));
            // ---- FACILITY preset (schematicFacility fold-in) — 260 units:
            // navigator rail, minimap, semantic zoom, click-to-fly from the
            // navigator; rows generated with East.Array.generate, each carrying
            // a varied footprint shape/size (circle / square / triangle / diamond).
            const UnitType = StructType({
                key: StringType,
                x: FloatType,
                y: FloatType,
                kind: StringType,
                draw: FloatType,
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
                some(variant("warning", null)),
                some(variant("success", null)),
                some(variant("info", null)),
                some(variant("neutral", null)),
            ], ArrayType(OptionType(StatusTokenType)));
            // One generated grid block per room — geometry and pseudo-random
            // power draw computed with East expressions over the unit index.
            // Blocks mix row spacing (tight ⇢ sparse) and add hash jitter so the
            // semantic-zoom declutter has real density variation to chew on.
            const block = $.const(East.function(
                [StringType, StringType, FloatType, FloatType, IntegerType, IntegerType, FloatType, FloatType],
                ArrayType(UnitType),
                (_$, prefix, noun, x0, y0, count, cols, spacing, cap) =>
                    East.Array.generate(count, UnitType, ($, i) => {
                        const col = $.let(i.remainder(cols));
                        const row = $.let(i.subtract(col).divide(cols));
                        const draw = $.let(i.add(3n).multiply(4243n).remainder(100n).toFloat().divide(100.0).multiply(cap));
                        const jx = $.let(i.multiply(2246822519n).remainder(101n).toFloat().divide(101.0).subtract(0.5).multiply(spacing.multiply(0.3)));
                        const jy = $.let(i.multiply(3266489917n).remainder(83n).toFloat().divide(83.0).subtract(0.5).multiply(spacing.multiply(0.3)));
                        // Cycle the four footprint shapes (period 4) and three sizes
                        // (period 3) independently, so consecutive units vary in both.
                        const shape = $.let(i.remainder(4n));
                        const size = $.let(i.remainder(3n).toFloat().multiply(0.25).add(0.6));
                        return {
                            key: East.str`${prefix}-${East.print(i.add(1n))}`,
                            x: x0.add(col.toFloat().multiply(spacing)).add(jx),
                            y: y0.add(row.toFloat().multiply(spacing)).add(jy),
                            kind: East.str`${East.Float.printFixed(cap, 0n)} kW ${noun}`,
                            draw,
                            cap,
                            metric: East.str`${East.Float.printFixed(draw, 1n)} kW`,
                            status: statuses.get(i.remainder(6n)),
                            shape,
                            size,
                        };
                    }),
            ));
            const units = $.let(
                block("DH1", "rack", 4.5, 5.5, 96n, 16n, 2.6, 8.0)
                    .concat(block("DH2", "rack", 7.8, 34.0, 90n, 18n, 1.9, 12.0))
                    .concat(block("UPS", "UPS module", 54.4, 4.6, 12n, 4n, 4.4, 250.0))
                    .concat(block("CRAH", "CRAH", 54.2, 29.9, 20n, 5n, 3.4, 120.0))
                    .concat(block("NET", "network rack", 83.5, 7.7, 24n, 6n, 2.2, 6.0))
                    .concat(block("STG", "staged rack", 82.0, 34.2, 18n, 6n, 2.8, 10.0)));
            const facilityAreas = $.const([
                { id: "dh1", name: "Data Hall 1", x: 1.0, y: 1.0, w: 46.0, h: 24.0 },
                { id: "dh2", name: "Data Hall 2", x: 1.0, y: 27.0, w: 46.0, h: 24.0 },
                { id: "elec", name: "Electrical room", x: 49.0, y: 1.0, w: 24.0, h: 16.0 },
                { id: "cooling", name: "Cooling room", x: 49.0, y: 19.0, w: 24.0, h: 32.0 },
                { id: "mmr", name: "Meet-me room", x: 75.0, y: 1.0, w: 28.0, h: 20.0 },
                { id: "staging", name: "Staging", x: 75.0, y: 23.0, w: 28.0, h: 28.0 },
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
                            extent={{ width: 104, height: 52 }}
                            height="440px"
                            items={units}
                            item={u => ({
                                key: u.key, x: u.x, y: u.y, label: u.key,
                                sublabel: u.kind, icon: "server",
                                status: u.status,
                                meter: { value: u.draw, max: u.cap },
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
    description: "Layer chrome — structure locked and dimmed, network shipped hidden; the layer panel shows / hides / solos / locks each",
    fn: East.function([], UIComponentType, (_$) => {
        const SCHEMATIC_LAYERS_DATA = [
            { id: "DOOR-1", x: 2.2, y: 6.8, kind: "entry", sys: "structure" },
            { id: "UPS-1", x: 6.4, y: 3.4, kind: "ups", sys: "power" },
            { id: "PDU-2", x: 12.8, y: 3.4, kind: "pdu", sys: "power" },
            { id: "CRAH-3", x: 19.2, y: 7.6, kind: "crah", sys: "cooling" },
            { id: "SW-4", x: 9.6, y: 9.8, kind: "switch", sys: "network" },
        ];
        const SCHEMATIC_LAYERS_ROOMS_DATA = [
            { id: "hall", name: "Hall 2", x: 1.0, y: 1.0, w: 23.0, h: 11.5 },
        ];
        const SCHEMATIC_LAYERS_RUNS_DATA = [
            { id: "w1", a: "UPS-1", b: "PDU-2" },
            { id: "w2", a: "PDU-2", b: "CRAH-3" },
        ];
        return (
        <Schematic
            extent={{ width: 25, height: 13.5 }}
            height="420px"
            items={SCHEMATIC_LAYERS_DATA}
            item={e => ({ key: e.id, x: e.x, y: e.y, label: e.id, sublabel: e.kind, icon: "gear", layer: e.sys })}
            zones={SCHEMATIC_LAYERS_ROOMS_DATA}
            zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, layer: "structure" })}
            links={SCHEMATIC_LAYERS_RUNS_DATA}
            link={l => ({ key: l.id, from: l.a, to: l.b, layer: "power" })}
            layers={[
                { key: "structure", label: "Structure", tone: "muted", locked: true, opacity: 0.45 },
                { key: "power", label: "Power", tone: "warning" },
                { key: "cooling", label: "Cooling", tone: "brand" },
                { key: "network", label: "Network", tone: "success", visible: false },
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
        // Equipment with real footprints: `round` ⇒ circle body (a cooling
        // tower), else `fp` ⇒ polygon body, else point + icon. The `x/y` anchor
        // stays the item identity used by the navigator, links and declutter;
        // `footprint` is additive (a circle centres on that anchor).
        const SCHEMATIC_GEOMETRY_DATA = [
            { id: "CRAH-1", x: 6.2, y: 4.6, kind: "cooling unit", state: some(variant("success", null)), fp: true, round: false, r: 0.0,
              pts: [{ x: 4.0, y: 3.0, bulge: 0.0 }, { x: 8.6, y: 3.5, bulge: 0.0 }, { x: 8.3, y: 6.2, bulge: 0.0 }, { x: 3.7, y: 5.7, bulge: 0.0 }] },
            { id: "CT-2", x: 16.4, y: 4.8, kind: "cooling tower", state: some(variant("warning", null)), fp: false, round: true, r: 2.3,
              pts: [{ x: 16.4, y: 4.8, bulge: 0.0 }] },
            { id: "PDU-3", x: 22.0, y: 4.6, kind: "pdu", state: some(variant("info", null)), fp: false, round: false, r: 0.0,
              pts: [{ x: 22.0, y: 4.6, bulge: 0.0 }] },
        ];
        // Zones with shape geometry: a rotated polygon hall and a curving duct
        // bank whose bends are true arcs (vertex `bulge`), widened into a
        // world-space band. The required x/y/w/h bounding box still drives the
        // navigator / minimap / fly-to.
        const SCHEMATIC_GEOMETRY_AREAS_DATA = [
            { id: "hall-3", name: "Hall 3", x: 1.6, y: 1.4, w: 9.3, h: 6.6, band: false,
              pts: [{ x: 1.6, y: 2.2, bulge: 0.0 }, { x: 10.4, y: 1.4, bulge: 0.0 }, { x: 10.9, y: 7.4, bulge: 0.0 }, { x: 2.0, y: 8.0, bulge: 0.0 }] },
            { id: "duct", name: "Duct bank", x: 1.0, y: 9.1, w: 23.8, h: 3.4, band: true,
              pts: [{ x: 1.2, y: 11.8, bulge: 0.0 }, { x: 6.6, y: 10.0, bulge: 0.45 }, { x: 12.8, y: 11.6, bulge: -0.45 }, { x: 18.6, y: 9.8, bulge: 0.35 }, { x: 24.4, y: 11.0, bulge: 0.0 }] },
        ];
        return (
        <Schematic
            extent={{ width: 26.5, height: 14 }}
            height="440px"
            items={SCHEMATIC_GEOMETRY_DATA}
            item={e => ({
                key: e.id, x: e.x, y: e.y, label: e.id,
                sublabel: e.kind, status: e.state, icon: "gear",
                footprint: e.round.ifElse(
                    _$ => Schematic.circle(e.r),
                    _$ => e.fp.ifElse(_$ => Schematic.polygon(e.pts), _$ => Schematic.rect()),
                ),
            })}
            zones={SCHEMATIC_GEOMETRY_AREAS_DATA}
            zone={z => ({
                key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h,
                geometry: z.band.ifElse(
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
        // Each cooling unit carries an explicit CSS colour, one per cooling
        // loop: `color` tints the stroke / marker, `bg` fills the circle
        // footprint — a category palette that is independent of `status`.
        const SCHEMATIC_COLOR_OVERRIDE_DATA = [
            { id: "CRAH-A", x: 3.4, y: 4.2, r: 1.4, tint: "bg.brand.subtle" },
            { id: "CRAH-B", x: 8.0, y: 4.2, r: 1.4, tint: "bg.success.subtle" },
            { id: "CRAH-C", x: 12.6, y: 4.2, r: 1.4, tint: "bg.subtle" },
        ];
        const SCHEMATIC_COLOR_OVERRIDE_AREAS_DATA = [
            { id: "cooling", name: "Cooling room", x: 1.4, y: 1.6, w: 13.4, h: 5.4 },
        ];
        return (
        <Schematic
            extent={{ width: 16, height: 8 }}
            height="360px"
            items={SCHEMATIC_COLOR_OVERRIDE_DATA}
            item={e => ({
                key: e.id, x: e.x, y: e.y, label: e.id,
                footprint: Schematic.circle(e.r),
                color: e.tint,
                bg: e.tint,
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
        // A small extent ⇒ items render as CARDS, where the ghost / desaturate /
        // ring effects read clearly (on labelled pins they'd be too subtle). Each
        // effect row carries a status tone so `desaturate` visibly drains its colour.
        const SCHEMATIC_SLICE_EFFECT_DATA = [
            { id: "A01", x: 3.4, y: 2.8, kind: "rack", st: some(variant("success", null)) },
            { id: "A02", x: 11.8, y: 2.8, kind: "rack", st: some(variant("success", null)) },
            { id: "PDU-A", x: 4.6, y: 6.4, kind: "pdu", st: some(variant("warning", null)) },
            { id: "CRAH-1", x: 12.2, y: 6.4, kind: "cooling", st: some(variant("info", null)) },
        ];
        const SCHEMATIC_SELECT_FILTER_DATA = [
            { id: "A", x: 3.2, y: 3.2, kind: "rack" },
            { id: "B", x: 7.8, y: 3.2, kind: "rack" },
            { id: "C", x: 12.6, y: 3.2, kind: "switch" },
            { id: "D", x: 5.4, y: 6.6, kind: "rack" },
            { id: "E", x: 10.2, y: 6.6, kind: "switch" },
        ];
        const EffectRackType = StructType({ id: StringType, x: FloatType, y: FloatType, kind: StringType, st: OptionType(StatusTokenType) });
        const FilterRackType = StructType({ id: StringType, x: FloatType, y: FloatType, kind: StringType });
        return (
            <VStack gap="4" align="stretch">
                <Separator label="SLICE EFFECT" align="start" />
                <Reactive>{$ => {
                        const data = $.const(SCHEMATIC_SLICE_EFFECT_DATA, ArrayType(EffectRackType));
                        // Seed an active filter (kind = "rack") so two rows already fail
                        // the narrowing — the effect is visible at first render: the
                        // "pdu" / "cooling" units ghost out, the "rack" survivors pulse.
                        const slice = $.let(Slice.bind("ex.schematic.effect", data, {
                    fields: { id: { label: "ID" }, kind: { label: "Kind" } }, search: ["id", "kind"],
                    initial: { kind: ["rack"] },
                }));
                        // Full set tagged with pass/fail — excluded rows STAY (ghosted),
                        // rather than the pre-narrowed `Slice.rows`.
                        const tagged = $.let(Slice.partition([EffectRackType], slice));

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
                                        sublabel: t.value.kind, icon: "server", status: t.value.st,
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
                        const data = $.const(SCHEMATIC_SELECT_FILTER_DATA, ArrayType(FilterRackType));
                        // No initial filter — everything matches until a selection writes one.
                        const slice = $.let(Slice.bind("ex.schematic.selfilter", data, {
                            fields: { id: { label: "ID" }, kind: { label: "Kind" } }, search: ["id", "kind"],
                        }));
                        // Full set tagged pass/fail; a marquee selection writes `in(id, keys)`
                        // via sliceSelectField, so the non-selected re-tag excluded → ghost.
                        const tagged = $.let(Slice.partition([FilterRackType], slice));
                        return (
                            <VStack gap="3" align="stretch">
                                <Schematic
                                    extent={{ width: 16, height: 9 }}
                                    height="400px"
                                    items={tagged}
                                    item={t => ({
                                        key: t.value.id, x: t.value.x, y: t.value.y, label: t.value.id,
                                        sublabel: t.value.kind, icon: "server", excluded: t.matched.not(),
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
        // The ONE canvas the interaction configurator drives: two racks in
        // Cage A, a switch in Cage B and two UPS units in the electrical room,
        // so every zone holds items and the childItemKeys log line stays
        // meaningful.
        const SCHEMATIC_INTERACTIONS_ITEMS = [
            { id: "A01", x: 3.2, y: 3.2 },
            { id: "A02", x: 8.8, y: 3.2 },
            { id: "SW-1", x: 15.6, y: 3.2 },
            { id: "UPS-1", x: 6.4, y: 9.0 }, { id: "UPS-2", x: 17.6, y: 9.0 },
        ];
        // The zone bodies the zone tool selects and the always-on zoneHover
        // cards describe.
        const SCHEMATIC_INTERACTIONS_ZONES = [
            { id: "cage-a", name: "Cage A", x: 1.0, y: 1.0, w: 10.0, h: 4.6 },
            { id: "cage-b", name: "Cage B", x: 12.6, y: 1.0, w: 10.4, h: 4.6 },
            { id: "elec", name: "Electrical room", x: 1.0, y: 7.0, w: 22.0, h: 4.2 },
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
                    <Text.MonoLabel>{East.str`${key} · power draw (7d)`}</Text.MonoLabel>
                    <Sparkline data={[5.1, 5.4, 5.0, 5.9, 6.3, 6.1, 6.6]} type="area" width="180px" height="44px" />
                </VStack>
            )));
            const zoneHover = $.const(East.function([StringType], UIComponentType, (_$, key) => (
                <Text.MonoLabel>{East.str`${key} — change window 02:00–04:00`}</Text.MonoLabel>
            )));
            const linkHover = $.const(East.function([StringType], UIComponentType, (_$, key) => (
                <Text.MonoLabel>{East.str`${key} · 38.2 Gbps`}</Text.MonoLabel>
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
                        /* A 24 × 12 extent — the zone bodies (and the SW-1 /
                           UPS-1 / UPS-2 rows inside them) need the wider world rect. */
                        <Schematic
                            navigator={false}
                            extent={{ width: 24, height: 12 }}
                            height="440px"
                            items={SCHEMATIC_INTERACTIONS_ITEMS}
                            item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "server" })}
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
