/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example, some, none, ArrayType, FloatType, IntegerType, NullType, StringType, StructType } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Library, Reactive, SegmentGroup, Slice, Text, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const LIBRARY_ASSETS_DATA = [
    { id: "BT-014", cls: "26ft box", depot: "North", cap: "cap 10t", range: "range 300mi", cert: "CDL-B", inService: false },
    { id: "BT-018", cls: "26ft box", depot: "North", cap: "cap 10t", range: "range 300mi", cert: "CDL-B", inService: false },
    { id: "BT-022", cls: "26ft box", depot: "South", cap: "cap 10t", range: "range 300mi", cert: "CDL-B", inService: true },
];
const LIBRARY_FLAT_DATA = [
    { id: "hall-b", name: "Hall B" },
    { id: "qa-cell", name: "QA Cell" },
    { id: "dispatch", name: "Dispatch" },
];
const LIBRARY_SCROLL_DATA = [
    { id: "patel", name: "Patel, R.", role: "Senior", hours: 38.0 },
    { id: "cho", name: "Cho, J.", role: "Senior", hours: 26.0 },
    { id: "rivera", name: "Rivera, M.", role: "Senior", hours: 32.0 },
    { id: "okafor", name: "Okafor, S.", role: "Mid", hours: 40.0 },
    { id: "nguyen", name: "Nguyen, T.", role: "Mid", hours: 20.0 },
    { id: "kim", name: "Kim, A.", role: "Mid", hours: 22.0 },
];
const LIBRARY_FILL_DATA = East.Array.range(0n, 200n).map((_$, i) => ({
    id: East.str`p${i}`,
    name: East.str`Person ${i}`,
    role: i.remainder(2n).equals(0n).ifElse(() => "Senior", () => "Mid"),
    hours: i.remainder(40n).toFloat(),
}));

// ============================================================================
// Large libraries (#258) — hundreds of cards behind a height-constrained,
// virtualized scroll region. Data is generated East-side and deterministically
// (remainder indexing into literal pools — no host randomness).
// ============================================================================

const CrewType = StructType({
    id: StringType,
    name: StringType,
    role: StringType,
    depot: StringType,
    hours: FloatType,
    skills: ArrayType(StringType),
});

// The ONE shared 400-card crew generator all three libraryLarge configurator
// branches consume (the literal pools live inside the generator body so the
// fixture is a self-contained module-scope expression).
const LIBRARY_LARGE_CARDS = East.Array.generate(400n, CrewType, East.function([IntegerType], CrewType, ($, i) => {
    const surnames = $.let(["Patel", "Cho", "Rivera", "Okafor", "Nguyen", "Kim", "Ali", "Silva", "Weber", "Rossi", "Tanaka", "Novak"], ArrayType(StringType));
    const roles = $.let(["Senior", "Mid", "Junior", "Contract", "Casual"], ArrayType(StringType));
    const depots = $.let(["North", "South", "East", "West", "Central", "Airport", "Harbor", "Rail"], ArrayType(StringType));
    const skillPool = $.let(["Forklift", "HazMat", "CDL-B", "Crane", "Rigging", "First aid", "Welding", "Night"], ArrayType(StringType));
    const row = $.let({
        id: East.str`crew-${i}`,
        name: East.str`${surnames.get(i.remainder(12n))}, ${i}`,
        role: roles.get(i.remainder(5n)),
        depot: depots.get(i.remainder(8n)),
        hours: i.remainder(41n).toFloat(),
        skills: [skillPool.get(i.remainder(8n)), skillPool.get(i.add(3n).remainder(8n))],
    }, CrewType);
    return row;
}));

export const libraryPeople = example({
    keywords: ["Library", "card", "meter", "chips", "group", "status", "search", "drag", "palette"],
    description: "People palette — grouped by role with hours meter, skill chips, statuses, and search",
    fn: East.function([], UIComponentType, ($) => {
        const people = $.const([
            { id: "patel", name: "Patel, R.", seniority: "Senior", hours: 38.0, skills: ["React", "Node", "Py"], onRoster: false, atCap: false, site: "SE-1" },
            { id: "cho", name: "Cho, J.", seniority: "Senior", hours: 26.0, skills: ["Go", "SQL"], onRoster: false, atCap: false, site: "SE-1" },
            { id: "rivera", name: "Rivera, M.", seniority: "Senior", hours: 32.0, skills: ["React", "Py"], onRoster: true, atCap: false, site: "SE-2" },
            { id: "okafor", name: "Okafor, S.", seniority: "Senior", hours: 40.0, skills: ["Go"], onRoster: false, atCap: true, site: "SE-2" },
            { id: "nguyen", name: "Nguyen, T.", seniority: "Mid", hours: 20.0, skills: ["React", "CSS"], onRoster: false, atCap: false, site: "SE-1" },
            { id: "kim", name: "Kim, A.", seniority: "Mid", hours: 22.0, skills: ["Go", "k8s"], onRoster: false, atCap: false, site: "SE-3" },
        ]);
        return (
            <Library
                id="people"
                data={people}
                item={p => ({
                    key: p.id,
                    label: p.name,
                    sublabel: East.str`${p.seniority} SE`,
                    icon: "user",
                    status: p.onRoster.ifElse(
                        () => some(Library.status("On roster", "info")),
                        () => p.atCap.ifElse(() => some(Library.status("At cap", "neutral")), () => none)),
                    draggable: p.atCap.not(),
                })}
                dimensions={[
                    { kind: "meter", key: "hours", label: "Hours", value: p => p.hours, max: 40.0, format: h => East.str`${h}h` },
                    { kind: "chips", key: "skills", label: "Skills", values: p => p.skills },
                    { kind: "text", key: "location", label: "Location", value: p => p.site },
                ]}
                groupBy={[
                    { key: "role", label: "Role", value: p => p.seniority, summary: members => East.str`${members.size()} people` },
                    { key: "site", label: "Site", value: p => p.site },
                ]}
                search={p => East.str`${p.name} ${p.seniority}`}
                addLabel="Add person"
            />
        );
    }),
    inputs: [],
});

export const libraryVariants = example({
    keywords: ["Library", "card", "chips", "group", "assets", "vehicles", "flat", "minimal"],
    description: "Library variant panel — assets (asset palette: same chassis, different secondary dimensions), flat (minimal flat palette: identity cards only, no toolbar)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">ASSETS</Text>
                    <Library
                        id="vehicles"
                        data={LIBRARY_ASSETS_DATA}
                        item={t => ({
                            key: t.id,
                            label: t.id,
                            sublabel: t.cls,
                            icon: "truck",
                            status: t.inService.ifElse(() => some(Library.status("In service", "success")), () => none),
                            draggable: t.inService.not(),
                        })}
                        dimensions={[
                            { kind: "chips", key: "capacity", label: "Capacity", values: t => [t.cap, t.range] },
                            { kind: "chips", key: "cert", label: "Cert", values: t => [t.cert] },
                        ]}
                        groupBy={[
                            { key: "class", label: "Class", value: t => t.cls, summary: members => East.print(members.size()) },
                            { key: "depot", label: "Depot", value: t => t.depot },
                        ]}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FLAT</Text>
                    <Library
                        id="rooms"
                        data={LIBRARY_FLAT_DATA}
                        item={r => ({ key: r.id, label: r.name, icon: "warehouse" })}
                    />
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});

export const libraryLarge = example({
    keywords: ["Library", "large", "virtualization", "scroll", "height", "group", "hundreds", "performance", "flat", "slice", "chrome", "filter", "search", "rail", "count", "footer", "Slice.rows"],
    description: "Large-library configurator — a SegmentGroup flips one shared 400-card generated crew fixture between grouped (depot / role group-by, meter + chips dims, search; rows virtualize behind a 480px scroll region), flat (no group-by: the flat layout virtualizes through the identical entry model, zero group heads), and sliced (the cards behind Slice chrome: a rail mounting [\"filter\", \"search\"] and a derived-count footer, rows fed explicitly via Slice.rows so filtered-out cards leave the palette)",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(CrewType, {
            fields: { name: { label: "Name" }, role: { label: "Role" }, depot: { label: "Depot" } },
            searchFieldIds: ["name", "role", "depot"],
        });
        return (
            <Reactive>{$ => {
                const modeBind = $.let(State.bind([StringType], "library_large_mode", "grouped"));
                const mode = $.let(modeBind.read());
                const onModeChange = $.const(East.function([StringType], NullType, ($, next) => {
                    $(modeBind.write(next));
                }));
                const crew = $.const(LIBRARY_LARGE_CARDS);
                // The slice binding is created UNCONDITIONALLY (bindings must
                // never be conditional) and only consumed by the sliced branch.
                const slice = $.let(Slice.bind([CrewType], "ex.library.large.slice", cfg, Slice.state({}), crew, none));
                const narrowed = $.let(Slice.rows([CrewType], slice));
                const grouped = $.const(
                    <Library
                        id="crew"
                        data={crew}
                        item={c => ({ key: c.id, label: c.name, sublabel: c.role, icon: "user" })}
                        dimensions={[
                            { kind: "meter", key: "hours", label: "Hours", value: c => c.hours, max: 40.0, format: h => East.str`${h}h` },
                            { kind: "chips", key: "skills", label: "Skills", values: c => c.skills },
                            { kind: "text", key: "depot", label: "Depot", value: c => c.depot },
                        ]}
                        groupBy={[
                            { key: "depot", label: "Depot", value: c => c.depot, summary: members => East.str`${members.size()} crew` },
                            { key: "role", label: "Role", value: c => c.role },
                        ]}
                        search={c => East.str`${c.name} ${c.role} ${c.depot}`}
                        style={{ height: "480px" }}
                    />,
                );
                const flat = $.const(
                    <Library
                        id="crew-flat"
                        data={crew}
                        item={c => ({ key: c.id, label: c.name, sublabel: c.role, icon: "user" })}
                        dimensions={[
                            { kind: "meter", key: "hours", label: "Hours", value: c => c.hours, max: 40.0, format: h => East.str`${h}h` },
                            { kind: "chips", key: "skills", label: "Skills", values: c => c.skills },
                        ]}
                        search={c => East.str`${c.name} ${c.role}`}
                        style={{ height: "480px" }}
                    />,
                );
                const sliced = $.const(
                    <Library
                        id="crew-sliced"
                        data={narrowed}
                        item={c => ({ key: c.id, label: c.name, sublabel: c.role, icon: "user" })}
                        dimensions={[
                            { kind: "meter", key: "hours", label: "Hours", value: c => c.hours, max: 40.0, format: h => East.str`${h}h` },
                            { kind: "chips", key: "skills", label: "Skills", values: c => c.skills },
                        ]}
                        groupBy={[
                            { key: "depot", label: "Depot", value: c => c.depot, summary: members => East.str`${members.size()} crew` },
                        ]}
                        slice={slice}
                        affordances={["filter", "search"]}
                        style={{ height: "480px" }}
                    />,
                );
                const body = $.const(mode.equal("flat").ifElse(
                    _$ => flat,
                    _$ => mode.equal("sliced").ifElse(_$ => sliced, _$ => grouped),
                ), UIComponentType);
                return (
                    <VStack gap="3" align="stretch">
                        <SegmentGroup
                            value={mode}
                            onChange={onModeChange}
                            items={[
                                SegmentGroup.Item("grouped", "Grouped"),
                                SegmentGroup.Item("flat", "Flat"),
                                SegmentGroup.Item("sliced", "Sliced"),
                            ]}
                            size="sm"
                        />
                        {body}
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

export const libraryFill = example({
    keywords: ["Library", "maxHeight", "bounded", "scroll", "virtual", "sizing", "#320", "fill", "height", "Box"],
    description: "Library sizing panel (#320) — scroll (style maxHeight=\"200px\" caps the card grid; six cards over two roles overflow so it clips mid-row and virtualizes within), fill (height=\"fill\": the library card grid fills a fixed 200px Box and scrolls within it; two hundred cards over two roles overflow the box so only the visible cards plus overscan mount)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">SCROLL</Text>
                    <Library
                        id="library-scroll"
                        data={LIBRARY_SCROLL_DATA}
                        item={p => ({ key: p.id, label: p.name, sublabel: p.role })}
                        dimensions={[{ kind: "meter", key: "hours", label: "Hours", value: p => p.hours, max: 40.0, format: h => East.str`${h}h` }]}
                        groupBy={[{ key: "role", label: "Role", value: p => p.role }]}
                        style={{ maxHeight: "200px" }}
                    />
                </VStack>
                <VStack gap="1" align="stretch">
                    <Text textStyle="body-sm" fontFamily="mono" textTransform="uppercase" color="fg.muted">FILL</Text>
                    <Box height="200px">
                        <Library
                            id="library-fill"
                            data={LIBRARY_FILL_DATA}
                            item={p => ({ key: p.id, label: p.name, sublabel: p.role })}
                            dimensions={[{ kind: "meter", key: "hours", label: "Hours", value: p => p.hours, max: 40.0, format: h => East.str`${h}h` }]}
                            groupBy={[{ key: "role", label: "Role", value: p => p.role }]}
                            style={{ height: "fill" }}
                        />
                    </Box>
                </VStack>
            </VStack>
        );
    }),
    inputs: [],
});
