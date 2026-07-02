/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, example, variant, some, none } from "@elaraai/east";
import { State, StatusTokenType, UIComponentType } from "@elaraai/east-ui";
import { HStack, Reactive, Schematic, Slice, Slider, Sparkline, Switch, Text, VStack } from "@elaraai/east-ui";

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

export const schematicSliceEffect = example({
    keywords: ["Schematic", "slice", "sliceEffect", "excluded", "ghost", "desaturate", "pulse", "halo", "frame", "partition", "filter", "reactive", "switch", "State"],
    description: "Schematic slice effect — filtered-out items stay as ghosted / desaturated context (Slice.partition tags each row, `excluded` marks the losers) while the matched remainder is emphasised, instead of vanishing; the flat `slice*` props are SubtypeExprOrValue, so State-bound switches toggle pulse / frame / desaturate reactively",
    fn: East.function([], UIComponentType, (_$) => {
        const EquipType = StructType({ id: StringType, x: FloatType, y: FloatType, kind: StringType, st: OptionType(StatusTokenType) });
        const cfg = Slice.config(EquipType, {
            fields: { id: { label: "ID" }, kind: { label: "Kind" } },
            searchFieldIds: ["id", "kind"],
        });
        return (
            <Reactive>{$ => {
                // Small extent ⇒ items render as CARDS, where the ghost / desaturate
                // / ring effects read clearly (on labelled pins they'd be too subtle).
                // Each carries a status tone so `desaturate` visibly drains its colour.
                const data = $.const([
                    { id: "UNIT-04", x: 3.5, y: 2.6, kind: "unit", st: some(variant("success", null)) },
                    { id: "UNIT-05", x: 11.5, y: 2.6, kind: "unit", st: some(variant("success", null)) },
                    { id: "LINE-2", x: 4.5, y: 6.2, kind: "pack", st: some(variant("warning", null)) },
                    { id: "BAY-OUT", x: 12.0, y: 6.2, kind: "pallets", st: some(variant("info", null)) },
                ], ArrayType(EquipType));
                // Seed an active filter (kind = "unit") so two rows already fail
                // the narrowing — the effect is visible at first render: the
                // "pack" / "pallets" units ghost out, the "unit" survivors pulse.
                const slice = $.let(Slice.bind([EquipType], "ex.schematic.effect", cfg, Slice.state({
                    filters: [variant("string", { fieldId: "kind", op: variant("eq", "unit") })],
                }), data, none));
                // Full set tagged with pass/fail — excluded rows STAY (ghosted),
                // rather than the pre-narrowed `Slice.rows`.
                const tagged = $.let(Slice.partition([EquipType], slice));

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
        );
    }),
    inputs: [],
});

export const schematicLayers = example({
    keywords: ["Schematic", "layers", "layer", "visibility", "solo", "lock", "opacity", "toggle", "legend"],
    description: "Named layers — items / zones / links grouped into toggleable layers (a locked + dimmed building shell, and a maintenance layer that ships hidden); the canvas layer button opens a panel to show / hide / solo / lock each layer",
    fn: East.function([], UIComponentType, ($) => {
        const equipment = $.const([
            { id: "GATE", x: 2.5, y: 6.0, kind: "entry", sys: "shell" },
            { id: "PUMP-1", x: 6.0, y: 4.0, kind: "pump", sys: "process" },
            { id: "TANK-2", x: 12.0, y: 4.0, kind: "tank", sys: "process" },
            { id: "VALVE-3", x: 18.0, y: 7.0, kind: "valve", sys: "utilities" },
            { id: "SENS-4", x: 9.0, y: 9.0, kind: "sensor", sys: "maintenance" },
        ]);
        const rooms = $.const([
            { id: "hall", name: "Hall A", x: 1.0, y: 1.0, w: 22.0, h: 11.0 },
        ]);
        const pipes = $.const([
            { id: "p1", a: "PUMP-1", b: "TANK-2" },
            { id: "p2", a: "TANK-2", b: "VALVE-3" },
        ]);
        return (
            <Schematic
                extent={{ width: 24, height: 13 }}
                height="420px"
                items={equipment}
                item={e => ({ key: e.id, x: e.x, y: e.y, label: e.id, sublabel: e.kind, icon: "gear", layer: e.sys })}
                zones={rooms}
                zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, layer: "shell" })}
                links={pipes}
                link={l => ({ key: l.id, from: l.a, to: l.b, layer: "utilities" })}
                layers={[
                    // Locked + dimmed backdrop (the GATE item + Hall zone read as context).
                    { key: "shell", label: "Building shell", tone: "muted", locked: true, opacity: 0.45 },
                    { key: "process", label: "Process", tone: "brand" },
                    { key: "utilities", label: "Utilities", tone: "success" },
                    // Ships hidden — SENS-4 is absent until toggled on in the panel.
                    { key: "maintenance", label: "Maintenance", tone: "warning", visible: false },
                ]}
                scaleUnit="m"
            />
        );
    }),
    inputs: [],
});

export const schematicMinimal = example({
    keywords: ["Schematic", "canvas", "minimal", "readOnly", "static"],
    description: "Minimal placement — items only, no zones or links; readOnly makes it a pure static picture (the connect / move edit tools never render), leaving just pan / zoom / selection",
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
                readOnly={true}
            />
        );
    }),
    inputs: [],
});

export const schematicInteractive = example({
    keywords: ["Schematic", "Reactive", "State", "onSelect", "onItemOpen", "double-click", "open", "drill-in", "interactive"],
    description: "Canvas whose onSelect tracks the inspected item and onItemOpen (double-click drill-in) tracks the opened one; a background double-click still resets the view",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
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
                        onItemOpen={onItemOpen}
                    />
                    <Text.MonoLabel>{East.str`INSPECTING · ${selected} · OPENED · ${openedKey}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const schematicRangeSelect = example({
    keywords: ["Schematic", "selection", "selectionMode", "single", "multiple", "marquee", "onSelectionChange", "selectZoomFocus", "focus", "zoom", "multi-select", "Reactive", "State", "Switch"],
    description: "Multi-select — drag a marquee (or Shift-click) to select many items; onSelectionChange writes the whole key set to State. A reactive Switch toggles `selectZoomFocus`: when on, a tap flies to the item and a marquee fits the camera to the selected set; when off, selection never moves the camera",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The full selected-key set is mirrored into State on every change.
            const bind = $.let(State.bind([ArrayType(StringType)], "schematic_selected_keys", []));
            const onSelectionChange = $.const(East.function([Schematic.Types.SelectionEvent], NullType, ($, ev) => {
                $(bind.write(ev.selectedKeys));
            }));
            const keys = $.let(bind.read());
            const count = $.let(keys.size());
            // Reactive toggle for the camera-on-select behaviour — flip it and click /
            // marquee to compare: focus ON flies / fits, OFF leaves the camera put.
            const focus = $.let(State.bind([BooleanType], "ex.schematic.focus", true));
            const focusOn = $.let(focus.read());
            const onFocus = $.const(East.function([BooleanType], NullType, ($, v) => { $(focus.write(v)); }));
            // Reactive selection mode — Switch between `single` (one item, no marquee)
            // and `multiple` (marquee + Shift-extend), as an East variant expression.
            const multi = $.let(State.bind([BooleanType], "ex.schematic.multi", true));
            const multiOn = $.let(multi.read());
            const onMulti = $.const(East.function([BooleanType], NullType, ($, v) => { $(multi.write(v)); }));
            const selMode = $.let(
                multiOn.ifElse(_$ => variant("multiple", null), _$ => variant("single", null)),
                Schematic.Types.SelectionMode,
            );
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="4" align="center">
                        <Switch checked={multiOn} label="Multi-select" onChange={onMulti} />
                        <Switch checked={focusOn} label="Zoom to focus on select" onChange={onFocus} />
                        <Text.MonoLabel>{East.str`SELECTED · ${East.print(count)}`}</Text.MonoLabel>
                    </HStack>
                    <Schematic
                        extent={{ width: 40, height: 24 }}
                        height="440px"
                        items={[
                            // Spread across a large extent + clustered, so focus is
                            // obvious: a tap zooms in hard, a marquee fits to a cluster.
                            { id: "A", x: 4.0, y: 4.0 }, { id: "B", x: 7.0, y: 6.5 }, { id: "C", x: 5.0, y: 9.0 },
                            { id: "D", x: 31.0, y: 4.0 }, { id: "E", x: 35.0, y: 6.0 }, { id: "F", x: 33.0, y: 9.5 },
                            { id: "G", x: 18.0, y: 18.0 }, { id: "H", x: 22.0, y: 20.0 }, { id: "I", x: 20.0, y: 14.5 },
                            { id: "J", x: 34.0, y: 19.0 }, { id: "K", x: 37.0, y: 21.5 }, { id: "L", x: 13.0, y: 11.5 },
                        ]}
                        item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "cube" })}
                        selectionMode={selMode}
                        selectZoomFocus={focusOn}
                        onSelectionChange={onSelectionChange}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const schematicZoneSelect = example({
    keywords: ["Schematic", "zone", "area", "selection", "onSelectZone", "onZoneSelectionChange", "childItemKeys", "Reactive", "State", "Switch"],
    description: "Zone (area) selection — click a hall / cell body to select the zone (items take hit-test precedence; innermost zone wins); onZoneSelectionChange reports the selected zones AND their child items; the Multi-select switch turns on Shift-extend",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const readout = $.let(State.bind([StringType], "schematic_zone_sel", "—"));
            const onZoneSelectionChange = $.const(East.function([Schematic.Types.ZoneSelectionEvent], NullType, ($, ev) => {
                $(readout.write(East.str`${East.print(ev.selectedKeys.size())} zone(s) · ${East.print(ev.childItemKeys.size())} item(s) inside`));
            }));
            // Zone gestures follow the same selectionMode as items — flip the
            // switch and Shift+click zones to extend the area set.
            const multi = $.let(State.bind([BooleanType], "ex.zone.multi", true));
            const multiOn = $.let(multi.read());
            const onMulti = $.const(East.function([BooleanType], NullType, ($, v) => { $(multi.write(v)); }));
            const selMode = $.let(
                multiOn.ifElse(_$ => variant("multiple", null), _$ => variant("single", null)),
                Schematic.Types.SelectionMode,
            );
            const txt = $.let(readout.read());
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="4" align="center">
                        <Switch checked={multiOn} label="Multi-select (Shift extends)" onChange={onMulti} />
                        <Text.MonoLabel>{East.str`ZONES · ${txt}`}</Text.MonoLabel>
                    </HStack>
                    <Schematic
                        extent={{ width: 24, height: 12 }}
                        height="420px"
                        items={[
                            { id: "T1", x: 3.0, y: 3.0 }, { id: "T2", x: 7.0, y: 3.0 },
                            { id: "M1", x: 15.0, y: 3.0 },
                            { id: "P1", x: 6.0, y: 9.0 }, { id: "P2", x: 18.0, y: 9.0 },
                        ]}
                        item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "cube" })}
                        zones={[
                            { id: "hall-a", name: "Hall A", x: 1.0, y: 1.0, w: 10.0, h: 4.5 },
                            { id: "hall-b", name: "Hall B", x: 12.5, y: 1.0, w: 10.5, h: 4.5 },
                            { id: "dock", name: "Dock", x: 1.0, y: 7.0, w: 22.0, h: 4.0 },
                        ]}
                        zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h })}
                        selectionMode={selMode}
                        onZoneSelectionChange={onZoneSelectionChange}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const schematicLinkEdit = example({
    keywords: ["Schematic", "link", "editing", "connect", "linkMode", "session", "onCreateLink", "onSelectLink", "onEditLink", "onDeleteLink", "readOnlyLinks", "readOnly", "draw", "Reactive", "State", "Switch"],
    description: "Link editing — the connect tool drags item→item to create links (draw mode adds them locally, form-input style; connect mode is event-only for planning operations between areas); Shift+drag ADDS to the session and onCreateLink reports the accumulated links + the pair's existing links; click a link to select it, drag an endpoint handle to re-target, Del deletes; switches flip linkMode and readOnlyLinks reactively; canConnect forbids mixer→shipping directly (product must pass a packer)",
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

export const schematicItemMove = example({
    keywords: ["Schematic", "move", "reposition", "drag", "onMoveItem", "readOnlyItems", "editing", "group", "Reactive", "State", "Switch"],
    description: "Item drag-to-reposition — the move tool drags an item to a new world position (dragging a SELECTED item moves the whole selection rigidly); positions are local-first (form-input style) and onMoveItem fires once per gesture with the final position, every moved key, and the shared delta; the switch flips readOnlyItems reactively",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const log = $.let(State.bind([StringType], "schematic_move_log", "—"));
            const onMoveItem = $.const(East.function([Schematic.Types.ItemMoveEvent], NullType, ($, ev) => {
                $(log.write(East.str`moved ${East.print(ev.keys.size())} item(s) · ${ev.key} → ${East.Float.printFixed(ev.x, 1n)}, ${East.Float.printFixed(ev.y, 1n)}`));
            }));
            const movable = $.let(State.bind([BooleanType], "ex.move.on", true));
            const mOn = $.let(movable.read());
            const onM = $.const(East.function([BooleanType], NullType, ($, v) => { $(movable.write(v)); }));
            const roItems = $.let(mOn.not(), BooleanType);
            const txt = $.let(log.read());
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="4" align="center">
                        <Switch checked={mOn} label="Items movable" onChange={onM} />
                        <Text.MonoLabel>{East.str`MOVE · ${txt}`}</Text.MonoLabel>
                    </HStack>
                    <Schematic
                        extent={{ width: 20, height: 10 }}
                        height="420px"
                        items={[
                            { id: "T1", x: 4.0, y: 3.0 }, { id: "T2", x: 8.0, y: 3.0 },
                            { id: "T3", x: 12.0, y: 3.0 }, { id: "PK", x: 8.0, y: 7.5 },
                        ]}
                        item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "industry" })}
                        links={[{ id: "l1", a: "T2", b: "PK" }]}
                        link={l => ({ key: l.id, from: l.a, to: l.b })}
                        selectionMode="multiple"
                        readOnlyItems={roItems}
                        onMoveItem={onMoveItem}
                    />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const schematicStress = example({
    keywords: ["Schematic", "stress", "performance", "LOD", "semantic zoom", "declutter", "minimap", "large", "many items"],
    description: "Semantic-zoom stress probe — 320 generated items across 4 bays exercise the LOD ladder (cards ⇢ labelled dots ⇢ dots as you zoom out, dense rows degrading as one block instead of checkerboarding), the minimap, and 60 fps pan; the manual perf budget probe for the renderer",
    fn: East.function([], UIComponentType, (_$) => (
        <Schematic
            extent={{ width: 64, height: 34 }}
            height="460px"
            items={Array.from({ length: 320 }, (_, i) => {
                const bay = Math.floor(i / 80), col = i % 16, row = Math.floor((i % 80) / 16);
                return {
                    id: `U-${String(i).padStart(3, "0")}`,
                    x: (bay % 2) * 32 + col * 1.9 + 2.0,
                    y: Math.floor(bay / 2) * 17 + row * 2.9 + 2.5,
                    load: (i * 37 % 100) / 100,
                };
            })}
            item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "microchip", meter: { value: r.load, max: 1.0 } })}
            zones={[
                { id: "bay-a", name: "Bay A", x: 0.5, y: 0.5, w: 31.0, h: 16.0 },
                { id: "bay-b", name: "Bay B", x: 32.5, y: 0.5, w: 31.0, h: 16.0 },
                { id: "bay-c", name: "Bay C", x: 0.5, y: 17.5, w: 31.0, h: 16.0 },
                { id: "bay-d", name: "Bay D", x: 32.5, y: 17.5, w: 31.0, h: 16.0 },
            ]}
            zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, pattern: Schematic.outline() })}
            selectionMode="multiple"
            minimap={true}
            scaleUnit="m"
        />
    )),
    inputs: [],
});

export const schematicHover = example({
    keywords: ["Schematic", "hover", "HoverCard", "itemHover", "zoneHover", "linkHover", "Sparkline", "chart", "inspection", "lazy"],
    description: "Hover cards — dwell on an item, zone body, or link/net stroke to open a card whose content an East function builds LAZILY from the hovered KEY (a Sparkline chart over the entity's history is the headline case); the card survives the pointer moving onto it, and any camera or edit gesture closes it",
    fn: East.function([], UIComponentType, ($) => {
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
        return (
            <Schematic
                extent={{ width: 20, height: 10 }}
                height="420px"
                items={[
                    { id: "UNIT-01", x: 3.5, y: 3.0 }, { id: "UNIT-02", x: 8.0, y: 3.0 },
                    { id: "CIP-1", x: 3.5, y: 7.5 }, { id: "PK-1", x: 13.0, y: 5.0 },
                ]}
                item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "industry" })}
                zones={[{ id: "hall-a", name: "Hall A", x: 1.0, y: 1.0, w: 9.5, h: 8.5 }]}
                zone={z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, pattern: Schematic.outline() })}
                links={[{ id: "feed", a: "UNIT-02", b: "PK-1" }]}
                link={l => ({ key: l.id, from: l.a, to: l.b, label: l.id })}
                itemHover={itemHover}
                zoneHover={zoneHover}
                linkHover={linkHover}
            />
        );
    }),
    inputs: [],
});

export const schematicNets = example({
    keywords: ["Schematic", "net", "nets", "manifold", "bus", "trunk", "header", "bar", "stubs", "sources", "destinations", "via", "label", "linkMode", "onCreateLink", "session", "Reactive", "State", "Switch"],
    description: "Nets — a manifold as ONE row: many sources feeding many destinations drawn as a header BAR with stubs and junction-tap dots (no pairwise explosion); the second net bridges two banks along an explicit via trunk path; the connect tool creates nets too (Shift+drag grows the session into one net — draw adds locally, connect mode is event-only), with switches flipping linkMode and readOnlyLinks reactively; click a stub to select ONE leg and Del removes just that endpoint (onEditNet); canConnect makes CIP-1 supply-only — drafts never snap onto it",
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

export const schematicViewport = example({
    keywords: ["Schematic", "viewport", "onViewportChange", "camera", "zoom", "bounds", "settle", "Reactive", "State"],
    description: "Debounced viewport reporting — onViewportChange fires after a pan / zoom / fly settles with the zoom + the visible world rect, written to State as a live readout (never per-frame)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const bind = $.let(State.bind([StringType], "schematic_viewport", "—"));
            const onViewportChange = $.const(East.function([Schematic.Types.ViewportEvent], NullType, ($, ev) => {
                $(bind.write(East.str`zoom ${East.Float.printFixed(ev.zoom, 1n)} · x ${East.Float.printFixed(ev.minX, 1n)}..${East.Float.printFixed(ev.maxX, 1n)} · y ${East.Float.printFixed(ev.minY, 1n)}..${East.Float.printFixed(ev.maxY, 1n)}`));
            }));
            const readout = $.let(bind.read());
            return (
                <VStack gap="3" align="stretch">
                    <Schematic
                        extent={{ width: 24, height: 12 }}
                        height="400px"
                        items={[
                            { id: "A", x: 4.0, y: 4.0 },
                            { id: "B", x: 12.0, y: 6.0 },
                            { id: "C", x: 20.0, y: 8.0 },
                        ]}
                        item={r => ({ key: r.id, x: r.x, y: r.y, label: r.id, icon: "cube" })}
                        onViewportChange={onViewportChange}
                    />
                    <Text.MonoLabel>{East.str`VIEW · ${readout}`}</Text.MonoLabel>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const schematicSelectFilter = example({
    keywords: ["Schematic", "selection", "selectionMode", "sliceSelectField", "slice", "in", "filter", "marquee", "onSelectionChange", "partition", "ghost"],
    description: "Marquee-select drives the bound slice — sliceSelectField writes an `in` filter of the selected keys, so Slice.partition re-tags the rest as excluded and the ghost slice effect fades them (selection → slice → ghost, one-directional)",
    fn: East.function([], UIComponentType, (_$) => {
        const EquipType = StructType({ id: StringType, x: FloatType, y: FloatType, kind: StringType });
        const cfg = Slice.config(EquipType, {
            fields: { id: { label: "ID" }, kind: { label: "Kind" } },
            searchFieldIds: ["id", "kind"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { id: "A", x: 3.5, y: 3.0, kind: "unit" },
                    { id: "B", x: 8.0, y: 3.0, kind: "unit" },
                    { id: "C", x: 12.5, y: 3.0, kind: "pack" },
                    { id: "D", x: 5.5, y: 6.4, kind: "unit" },
                    { id: "E", x: 10.0, y: 6.4, kind: "pack" },
                ], ArrayType(EquipType));
                // No initial filter — everything matches until a selection writes one.
                const slice = $.let(Slice.bind([EquipType], "ex.schematic.selfilter", cfg, Slice.state({}), data, none));
                // Full set tagged pass/fail; a marquee selection writes `in(id, keys)`
                // via sliceSelectField, so the non-selected re-tag excluded → ghost.
                const tagged = $.let(Slice.partition([EquipType], slice));
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
        );
    }),
    inputs: [],
});

export const schematicFacility = example({
    keywords: ["Schematic", "facility", "navigator", "minimap", "zoom", "LOD", "click-to-fly", "large", "generate", "footprint", "geometry", "circle", "polygon", "shape"],
    description: "500-unit facility — navigator rail, minimap, semantic zoom, click-to-fly from the navigator; rows generated with East.Array.generate, each carrying a varied footprint shape/size (circle / square / triangle / diamond)",
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
    keywords: ["Schematic", "geometry", "polygon", "polyline", "circle", "arc", "bulge", "footprint", "zone", "CAD", "shape"],
    description: "Shape geometry — polygon & arc-aware polyline zones (rotated hall, curvy service road) plus polygon / circle item footprints (pump, tank, valve)",
    fn: East.function([], UIComponentType, ($) => {
        // Equipment with real footprints: `round` ⇒ circle body (a tank),
        // else `fp` ⇒ polygon body, else point + icon. The `x/y` anchor stays
        // the item identity used by the sidebar, links, and declutter;
        // `footprint` is additive (a circle centres on that anchor).
        const equipment = $.const([
            { id: "PUMP-1", x: 6.0, y: 4.0, kind: "transfer pump", state: some(variant("success", null)), fp: true, round: false, r: 0.0,
              pts: [{ x: 3.5, y: 2.2, bulge: 0.0 }, { x: 8.6, y: 3.0, bulge: 0.0 }, { x: 8.0, y: 6.0, bulge: 0.0 }, { x: 2.9, y: 5.2, bulge: 0.0 }] },
            { id: "UNIT-9", x: 16.0, y: 4.5, kind: "storage tank", state: some(variant("warning", null)), fp: false, round: true, r: 2.4,
              pts: [{ x: 16.0, y: 4.5, bulge: 0.0 }] },
            { id: "VALVE-3", x: 21.6, y: 4.5, kind: "manifold", state: some(variant("info", null)), fp: false, round: false, r: 0.0,
              pts: [{ x: 21.6, y: 4.5, bulge: 0.0 }] },
        ]);
        // Zones with shape geometry: a rotated polygon hall and a curvy
        // polyline service road whose bends are true arcs (vertex `bulge`),
        // widened into a world-space band. The required x/y/w/h bounding box
        // still drives the navigator / minimap / fly-to.
        const areas = $.const([
            { id: "hall-c", name: "Hall C", x: 1.5, y: 1.2, w: 9.1, h: 6.4, road: false,
              pts: [{ x: 1.8, y: 2.0, bulge: 0.0 }, { x: 10.2, y: 1.3, bulge: 0.0 }, { x: 10.6, y: 7.0, bulge: 0.0 }, { x: 2.2, y: 7.6, bulge: 0.0 }] },
            { id: "svc-rd", name: "Service Rd", x: 1.0, y: 9.0, w: 23.5, h: 3.4, road: true,
              pts: [{ x: 1.5, y: 11.6, bulge: 0.0 }, { x: 7.0, y: 9.8, bulge: 0.5 }, { x: 13.0, y: 11.4, bulge: -0.5 }, { x: 19.0, y: 9.6, bulge: 0.4 }, { x: 24.0, y: 10.8, bulge: 0.0 }] },
        ]);
        return (
            <Schematic
                extent={{ width: 26, height: 14 }}
                height="440px"
                items={equipment}
                item={e => ({
                    key: e.id, x: e.x, y: e.y, label: e.id,
                    sublabel: e.kind, status: e.state, icon: "industry",
                    footprint: e.round.ifElse(
                        _$ => Schematic.circle(e.r),
                        _$ => e.fp.ifElse(_$ => Schematic.polygon(e.pts), _$ => Schematic.rect()),
                    ),
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

export const schematicColorOverride = example({
    keywords: ["Schematic", "color", "tone", "bg", "override", "style", "footprint"],
    description: "Per-entity colour overrides — raw `color` + `bg` on item footprints (a category palette, independent of status) and a toned, filled area",
    fn: East.function([], UIComponentType, ($) => {
        // Each unit carries an explicit CSS colour: `color` tints the stroke /
        // marker, `bg` fills the circle footprint — a category palette that is
        // independent of `status`.
        const units = $.const([
            { id: "U-1", x: 4.0, y: 4.0, r: 1.4, fill: "#2D7FF9" },
            { id: "U-2", x: 8.0, y: 4.0, r: 1.4, fill: "#16A34A" },
            { id: "U-3", x: 12.0, y: 4.0, r: 1.4, fill: "#9333EA" },
        ]);
        const areas = $.const([
            { id: "bay", name: "Bay", x: 1.5, y: 1.5, w: 13.0, h: 5.5 },
        ]);
        return (
            <Schematic
                extent={{ width: 16, height: 8 }}
                height="360px"
                items={units}
                item={e => ({
                    key: e.id, x: e.x, y: e.y, label: e.id,
                    footprint: Schematic.circle(e.r),
                    color: e.fill,        // raw stroke / marker tint
                    bg: e.fill,           // raw footprint fill
                    fillOpacity: 0.18,
                })}
                zones={areas}
                zone={z => ({
                    key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h,
                    tone: "brand",        // semantic, theme-resolved
                    bg: "#2D7FF9",        // opt-in area fill
                })}
                scaleUnit="m"
            />
        );
    }),
    inputs: [],
});