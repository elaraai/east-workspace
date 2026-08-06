/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, IntegerType, NullType, OptionType, StringType, StructType, example, variant, some } from "@elaraai/east";
import { State, StatusTokenType, UIComponentType } from "@elaraai/east-ui";
import { Button, Configurator, HStack, Input, Map, Reactive, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

// Real res-8 H3 cell ids: a gridDisk split along a wavy boundary into two
// non-uniform halves that tile and run up against each other.

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

/**
 * THE Map configurator (pass 5) — ONE live canvas composing the overlay
 * grammars: a faint hex lattice, status areas with detail labels and a pulse,
 * a dashed movement line and click-to-read-out; the zoom dial and LOD
 * threshold are the live axes.
 */
export const mapVariants = example({
    keywords: ["Map", "areas", "hexDisk", "hex", "lattice", "LOD", "lodZoom", "detailLabel", "status", "pulse", "lines", "dashed", "arrow", "onAreaClick", "zoom", "Reactive", "State", "Input", "Configurator", "configurator"],
    description: "Map configurator — a zoom dial and LOD threshold on one live canvas composing hex lattice, status areas, detail labels, a dashed line and the click readout",
    fn: East.function([], UIComponentType, (_$) => {
        const MAP_PULSE_DATA = [
            { id: "5000", lat: -34.9258, lng: 138.5994, name: "5000 · CBD", st: some(variant("success", null)) },
            { id: "5100", lat: -34.836, lng: 138.6, name: "5100 · Prospect", st: some(variant("danger", null)) },
        ];
        return (
        <Reactive>{$ => {
            const zoomBind = $.let(State.bind([IntegerType], "map_zoom", 12n));
            const selectedBind = $.let(State.bind([StringType], "selectedArea", ""));
            const zoom = $.let(zoomBind.read());
            const selected = $.let(selectedBind.read());
            const onZoom = $.const(East.function([IntegerType], NullType, ($, next) => { $(zoomBind.write(next)); }));
            const onArea = $.const(East.function([StringType], NullType, ($, key) => { $(selectedBind.write(key)); }));

            return (
                <Configurator
                    controls={[
                        Configurator.Control("Zoom", East.print(zoom),
                            <Input.Integer value={zoom} min={10n} max={14n} step={1n} size="sm" onChange={onZoom} />),
                    ]}
                    preview={
                        <Map
                            center={Map.at(-34.881, 138.6)}
                            zoom={zoom}
                            lodZoom={13n}
                            hexes={Map.hex({ lattice: { center: Map.at(-34.881, 138.6), k: 14n, resolution: 8n }, tone: "muted" })}
                            markers={[]}
                            areas={MAP_PULSE_DATA}
                            area={a => ({
                                key: a.id,
                                label: a.name,
                                detailLabel: East.str`${a.name} · EN mornings short 3`,
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
                        />
                    }
                    aside={{
                        label: "Area click · Reactive",
                        body: <Text fontFamily="mono">{East.str`selected: ${selected}`}</Text>,
                    }}
                    spec={[
                        Configurator.Spec("LOD", "labels detail past zoom 13"),
                    ]}
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});

/** H3 region unions — polygon areas built from cell sets, status-toned. */
export const mapRegions = example({
    keywords: ["Map", "regions", "cells", "H3", "union", "polygon", "shape", "status", "Reactive"],
    description: "Region unions — areas built from H3 cell sets render as status-toned polygons",
    fn: East.function([], UIComponentType, (_$) => {
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
        return (
        <Reactive>{$ => {
            const idle = $.const(MAP_REGIONS_DATA, ArrayType(StringType));
            const short = $.const(MAP_REGIONS_SHORT_DATA, ArrayType(StringType));
            const regionAreas = $.const([
                { id: "5000", name: "5000 · idle EN +4", shape: Map.cells(idle), st: some(variant("success", null)) },
                { id: "5100", name: "5100 · short −3", shape: Map.cells(short), st: some(variant("danger", null)) },
            ], ArrayType(StructType({ id: StringType, name: StringType, shape: Map.Types.AreaShape, st: OptionType(StatusTokenType) })));
            return (
                <Map
                    center={Map.at(-34.878, 138.600)}
                    zoom={13n}
                    markers={[]}
                    areas={regionAreas}
                    area={a => ({ key: a.id, label: a.name, shape: a.shape, status: a.st })}
                    height="420px"
                />
            );
        }}</Reactive>
    );
    }),
    inputs: [],
});

/** The overlay slot — an ELARA HUD card pinned to the canvas corner. */
export const mapHud = example({
    keywords: ["Map", "overlay", "HUD", "slot", "align", "Button", "approve"],
    description: "Overlay slot — an ELARA HUD card with actions pinned to the canvas corner",
    fn: East.function([], UIComponentType, ($) => {
        const approve = $.const(East.function([], NullType, _$ => null));
        const reject = $.const(East.function([], NullType, _$ => null));
        return (
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
            />
        );
    }),
    inputs: [],
});
