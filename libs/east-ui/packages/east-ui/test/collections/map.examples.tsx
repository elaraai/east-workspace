/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, NullType, OptionType, StringType, StructType, example, variant, some } from "@elaraai/east";
import { State, StatusTokenType, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, Map, Reactive, SegmentGroup, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const MAP_AREAS_DATA = [
    { id: "5000", lat: -34.9258, lng: 138.5994, name: "5000 · Adelaide CBD" },
    { id: "5100", lat: -34.836, lng: 138.6, name: "5100 · Prospect" },
];
const MAP_HEX_LOD_DATA = [
    { id: "5100", lat: -34.836, lng: 138.6, name: "5100 · Prospect" },
];
const MAP_PULSE_DATA = [
    { id: "5000", lat: -34.9258, lng: 138.5994, name: "5000 · CBD", st: some(variant("success", null)) },
    { id: "5100", lat: -34.836, lng: 138.6, name: "5100 · Prospect", st: some(variant("danger", null)) },
];
// Real res-8 H3 cell ids: a gridDisk split along a wavy boundary into two
// non-uniform halves that tile and run up against each other.
const MAP_REGIONS_DATA = [
    "88b9168033fffff", "88b91680edfffff", "88b9168017fffff", "88b91681d9fffff",
    "88b91680e5fffff", "88b91680e1fffff", "88b91680e9fffff", "88b9168013fffff",
    "88b91681d1fffff", "88b91681dbfffff", "88b91680e7fffff", "88b91680e3fffff",
    "88b91680ebfffff", "88b91680c5fffff", "88b91680cdfffff", "88b916801bfffff",
    "88b91681d7fffff", "88b91681d3fffff", "88b91680adfffff", "88b91680a9fffff",
    "88b9168085fffff", "88b916808dfffff", "88b91680c7fffff", "88b91680c1fffff",
    "88b91680c9fffff", "88b91682a7fffff", "88b91682a5fffff", "88b9168053fffff",
];
const MAP_REGIONS_SHORT_DATA = [
    "88b916803bfffff", "88b9168039fffff", "88b9168031fffff", "88b9168015fffff",
    "88b9168003fffff", "88b9168007fffff", "88b916803dfffff", "88b9168035fffff",
    "88b9168037fffff", "88b9168011fffff", "88b916801dfffff", "88b916800bfffff",
    "88b9168001fffff", "88b9168005fffff", "88b916802bfffff", "88b9168023fffff",
    "88b91681c9fffff", "88b91681cbfffff", "88b91681ddfffff", "88b9168019fffff",
    "88b9168057fffff", "88b9168055fffff", "88b9168009fffff", "88b916800dfffff",
    "88b9168063fffff", "88b9168029fffff", "88b9168021fffff", "88b9168027fffff",
    "88b91681cdfffff", "88b91681c1fffff", "88b91681c3fffff", "88b91681d5fffff",
    "88b9168051fffff",
];

export const mapBasic = example({
    keywords: ["Map", "basemap", "carto", "marker", "center", "zoom"],
    description: "A CARTO Positron basemap centred on Adelaide with one home pin",
    fn: East.function([], UIComponentType, ($) => {
        const pins = $.const([
            { id: "okafor", lat: -34.842, lng: 138.598, name: "J. Okafor · home" },
        ]);
        return (
            <Map
                tiles={Map.carto("positron")}
                center={Map.at(-34.881, 138.6)}
                zoom={12n}
                minZoom={10n}
                maxZoom={18n}
                markers={pins}
                marker={m => ({ key: m.id, lat: m.lat, lng: m.lng, label: m.name, icon: "house" })}
                height="420px"
            />
        );
    }),
    inputs: [],
});

export const mapOverlayVariants = example({
    keywords: ["Map", "area", "hexDisk", "label", "flyTo", "tone", "hex", "lattice", "lodZoom", "detailLabel", "LOD", "status", "pulse", "success", "danger", "cells", "H3", "hexagon", "adjacent", "regions", "irregular", "overlay", "HUD", "Button", "approve", "reject", "Reactive", "State", "onAreaClick", "interactive", "select", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "Map configurator — an overlay-preset axis (filled areas, hex-lattice LOD, status pulse, H3 region unions, ELARA HUD) driving one live canvas; the aside reads the clicked area key",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const idle = $.const(MAP_REGIONS_DATA, ArrayType(StringType));
            const short = $.const(MAP_REGIONS_SHORT_DATA, ArrayType(StringType));
            const regionAreas = $.const([
                { id: "5000", name: "5000 · idle EN +4", shape: Map.cells(idle), st: some(variant("success", null)) },
                { id: "5100", name: "5100 · short −3", shape: Map.cells(short), st: some(variant("danger", null)) },
            ], ArrayType(StructType({ id: StringType, name: StringType, shape: Map.Types.AreaShape, st: OptionType(StatusTokenType) })));

            // Each preset is its own build-time canvas config (area mappers,
            // hex lattices, overlay slots), so the axis routes between five
            // maps over the shared click handler.
            const presets = $.const(["areas", "hex lod", "pulse", "regions", "hud"], ArrayType(StringType));

            const presetBind = $.let(State.bind([StringType], "map_preset", "areas"));
            // The click readout (folded from the old interactive example —
            // its State key is preserved): onAreaClick writes the clicked
            // area key into the aside.
            const selectedBind = $.let(State.bind([StringType], "selectedArea", ""));

            const pKey = $.let(presetBind.read());
            const selected = $.let(selectedBind.read());

            const onPreset = $.const(East.function([StringType], NullType, ($, next) => { $(presetBind.write(next)); }));
            const onArea = $.const(East.function([StringType], NullType, ($, key) => { $(selectedBind.write(key)); }));
            const approve = $.const(East.function([], NullType, _$ => null));
            const reject = $.const(East.function([], NullType, _$ => null));

            const areasMap = $.const(
                <Map
                    center={Map.at(-34.881, 138.6)}
                    zoom={12n}
                    lodZoom={13n}
                    markers={[]}
                    areas={MAP_AREAS_DATA}
                    area={a => ({
                        key: a.id,
                        label: a.name,
                        shape: Map.hexDisk(Map.at(a.lat, a.lng), 1n, 8n),
                        tone: "brand",
                        flyTo: Map.point(Map.at(a.lat, a.lng), 14n),
                    })}
                    onAreaClick={onArea}
                    height="420px"
                />,
            );
            const hexLod = $.const(
                <Map
                    center={Map.at(-34.881, 138.6)}
                    zoom={12n}
                    lodZoom={13n}
                    hexes={Map.hex({
                        lattice: { center: Map.at(-34.881, 138.6), k: 11n, resolution: 8n },
                        tone: "muted",
                    })}
                    markers={[]}
                    areas={MAP_HEX_LOD_DATA}
                    area={a => ({
                        key: a.id,
                        label: a.name,
                        detailLabel: East.str`${a.name} · EN mornings short 3`,
                        shape: Map.hexDisk(Map.at(a.lat, a.lng), 1n, 8n),
                    })}
                    onAreaClick={onArea}
                    height="420px"
                />,
            );
            const pulse = $.const(
                <Map
                    center={Map.at(-34.881, 138.6)}
                    zoom={12n}
                    // Faint grey lattice across most of the map; the two status areas pulse on top.
                    hexes={Map.hex({ lattice: { center: Map.at(-34.881, 138.6), k: 14n, resolution: 8n }, tone: "muted" })}
                    markers={[]}
                    areas={MAP_PULSE_DATA}
                    area={a => ({
                        key: a.id,
                        label: a.name,
                        shape: Map.hexDisk(Map.at(a.lat, a.lng), 1n, 8n),
                        status: a.st,
                    })}
                    lines={[{ id: "move", from_lat: -34.905, from_lng: 138.6, to_lat: -34.852, to_lng: 138.6 }]}
                    line={l => ({
                        key: l.id,
                        points: [Map.at(l.from_lat, l.from_lng), Map.at(l.to_lat, l.to_lng)],
                        style: Map.dashed({ tone: "brand" }),
                        arrow: true,
                    })}
                    onAreaClick={onArea}
                    height="420px"
                />,
            );
            const regions = $.const(
                <Map
                    center={Map.at(-34.878, 138.600)}
                    zoom={13n}
                    markers={[]}
                    areas={regionAreas}
                    area={a => ({ key: a.id, label: a.name, shape: a.shape, status: a.st })}
                    onAreaClick={onArea}
                    height="420px"
                />,
            );
            const hud = $.const(
                <Map
                    center={Map.at(-34.881, 138.6)}
                    zoom={12n}
                    markers={[]}
                    overlays={[
                        Map.overlay(
                            <VStack align="stretch" gap="2">
                                <Text fontFamily="mono" color="brand.solid">ELARA · AUTO-DETECTED</Text>
                                <Text fontWeight="semibold">Idle EN capacity one cluster south.</Text>
                                <HStack gap="2">
                                    <Button colorPalette="brand" onClick={approve}>Approve swap</Button>
                                    <Button variant="outline" onClick={reject}>Reject</Button>
                                </HStack>
                            </VStack>,
                            { align: "start", verticalAlign: "start", key: "elara-hud" },
                        ),
                    ]}
                    height="420px"
                />,
            );
            const canvas = $.const(pKey.equal("hex lod").ifElse(
                _$ => hexLod,
                _$ => pKey.equal("pulse").ifElse(
                    _$ => pulse,
                    _$ => pKey.equal("regions").ifElse(
                        _$ => regions,
                        _$ => pKey.equal("hud").ifElse(_$ => hud, _$ => areasMap),
                    ),
                ),
            ), UIComponentType);

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Overlay", pKey,
                            <SegmentGroup value={pKey} onChange={onPreset} size="sm"
                                items={presets.map((_$, p) => SegmentGroup.Item(p, <Text>{p.upperCase()}</Text>))} />),
                    ]}
                    preview={canvas}
                    aside={{
                        label: "Area click · Reactive",
                        body: <Text fontFamily="mono">{East.str`selected: ${selected}`}</Text>,
                    }}
                    spec={[
                        Configurator.Spec("Preset", pKey),
                        Configurator.Spec("Canvas", "420px"),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
