/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example, some, none, ArrayType, FloatType, IntegerType, StringType, StructType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Card, Library, Reactive, Slice } from "@elaraai/east-ui";

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

export const libraryAssets = example({
    keywords: ["Library", "card", "chips", "group", "assets", "vehicles"],
    description: "Asset palette — same chassis, different secondary dimensions",
    fn: East.function([], UIComponentType, ($) => {
        const trucks = $.const([
            { id: "BT-014", cls: "26ft box", depot: "North", cap: "cap 10t", range: "range 300mi", cert: "CDL-B", inService: false },
            { id: "BT-018", cls: "26ft box", depot: "North", cap: "cap 10t", range: "range 300mi", cert: "CDL-B", inService: false },
            { id: "BT-022", cls: "26ft box", depot: "South", cap: "cap 10t", range: "range 300mi", cert: "CDL-B", inService: true },
        ]);
        return (
            <Library
                id="vehicles"
                data={trucks}
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
        );
    }),
    inputs: [],
});

export const libraryFlat = example({
    keywords: ["Library", "card", "flat", "minimal"],
    description: "Minimal flat palette — identity cards only, no toolbar",
    fn: East.function([], UIComponentType, ($) => {
        const rooms = $.const([
            { id: "hall-b", name: "Hall B" },
            { id: "qa-cell", name: "QA Cell" },
            { id: "dispatch", name: "Dispatch" },
        ]);
        return (
            <Library
                id="rooms"
                data={rooms}
                item={r => ({ key: r.id, label: r.name, icon: "warehouse" })}
            />
        );
    }),
    inputs: [],
});

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

export const libraryLarge = example({
    keywords: ["Library", "large", "virtualization", "scroll", "height", "group", "hundreds", "performance"],
    description: "Large grouped palette — 400 generated crew cards behind a 480px scroll region; rows virtualize under the grouped layout (depot / role group-by, meter + chips dims, search)",
    fn: East.function([], UIComponentType, ($) => {
        const surnames = $.const(["Patel", "Cho", "Rivera", "Okafor", "Nguyen", "Kim", "Ali", "Silva", "Weber", "Rossi", "Tanaka", "Novak"], ArrayType(StringType));
        const roles = $.const(["Senior", "Mid", "Junior", "Contract", "Casual"], ArrayType(StringType));
        const depots = $.const(["North", "South", "East", "West", "Central", "Airport", "Harbor", "Rail"], ArrayType(StringType));
        const skillPool = $.const(["Forklift", "HazMat", "CDL-B", "Crane", "Rigging", "First aid", "Welding", "Night"], ArrayType(StringType));
        const crew = $.const(East.Array.generate(400n, CrewType, East.function([IntegerType], CrewType, ($, i) => {
            const row = $.let({
                id: East.str`crew-${i}`,
                name: East.str`${surnames.get(i.remainder(12n))}, ${i}`,
                role: roles.get(i.remainder(5n)),
                depot: depots.get(i.remainder(8n)),
                hours: i.remainder(41n).toFloat(),
                skills: [skillPool.get(i.remainder(8n)), skillPool.get(i.add(3n).remainder(8n))],
            }, CrewType);
            return row;
        })));
        return (
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
            />
        );
    }),
    inputs: [],
});

export const libraryLargeFlat = example({
    keywords: ["Library", "large", "virtualization", "flat", "scroll", "height", "hundreds"],
    description: "Large flat palette — the same 400 generated cards with no group-by: the flat layout virtualizes through the identical entry model (zero group heads)",
    fn: East.function([], UIComponentType, ($) => {
        const surnames = $.const(["Patel", "Cho", "Rivera", "Okafor", "Nguyen", "Kim", "Ali", "Silva", "Weber", "Rossi", "Tanaka", "Novak"], ArrayType(StringType));
        const roles = $.const(["Senior", "Mid", "Junior", "Contract", "Casual"], ArrayType(StringType));
        const depots = $.const(["North", "South", "East", "West", "Central", "Airport", "Harbor", "Rail"], ArrayType(StringType));
        const skillPool = $.const(["Forklift", "HazMat", "CDL-B", "Crane", "Rigging", "First aid", "Welding", "Night"], ArrayType(StringType));
        const crew = $.const(East.Array.generate(400n, CrewType, East.function([IntegerType], CrewType, ($, i) => {
            const row = $.let({
                id: East.str`crew-${i}`,
                name: East.str`${surnames.get(i.remainder(12n))}, ${i}`,
                role: roles.get(i.remainder(5n)),
                depot: depots.get(i.remainder(8n)),
                hours: i.remainder(41n).toFloat(),
                skills: [skillPool.get(i.remainder(8n)), skillPool.get(i.add(3n).remainder(8n))],
            }, CrewType);
            return row;
        })));
        return (
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
            />
        );
    }),
    inputs: [],
});

export const libraryLargeSlice = example({
    keywords: ["Library", "slice", "chrome", "filter", "search", "rail", "count", "footer", "large", "Slice.rows"],
    description: "Large sliced palette — the 400 cards behind Slice chrome: a rail mounting [\"filter\", \"search\"] and a derived-count footer; rows fed explicitly via Slice.rows so filtered-out cards leave the palette",
    fn: East.function([], UIComponentType, (_$) => {
        const cfg = Slice.config(CrewType, {
            fields: { name: { label: "Name" }, role: { label: "Role" }, depot: { label: "Depot" } },
            searchFieldIds: ["name", "role", "depot"],
        });
        return (
            <Reactive>{$ => {
                const surnames = $.const(["Patel", "Cho", "Rivera", "Okafor", "Nguyen", "Kim", "Ali", "Silva", "Weber", "Rossi", "Tanaka", "Novak"], ArrayType(StringType));
                const roles = $.const(["Senior", "Mid", "Junior", "Contract", "Casual"], ArrayType(StringType));
                const depots = $.const(["North", "South", "East", "West", "Central", "Airport", "Harbor", "Rail"], ArrayType(StringType));
                const skillPool = $.const(["Forklift", "HazMat", "CDL-B", "Crane", "Rigging", "First aid", "Welding", "Night"], ArrayType(StringType));
                const crew = $.const(East.Array.generate(400n, CrewType, East.function([IntegerType], CrewType, ($, i) => {
                    const row = $.let({
                        id: East.str`crew-${i}`,
                        name: East.str`${surnames.get(i.remainder(12n))}, ${i}`,
                        role: roles.get(i.remainder(5n)),
                        depot: depots.get(i.remainder(8n)),
                        hours: i.remainder(41n).toFloat(),
                        skills: [skillPool.get(i.remainder(8n)), skillPool.get(i.add(3n).remainder(8n))],
                    }, CrewType);
                    return row;
                })));
                const slice = $.let(Slice.bind([CrewType], "ex.library.large.slice", cfg, Slice.state({}), crew, none));
                const narrowed = $.let(Slice.rows([CrewType], slice));
                return (
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
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});


export const libraryScroll = example({
    keywords: ["Library", "maxHeight", "bounded", "scroll", "virtual", "sizing", "#320"],
    description: "Bounded library (#320) — style maxHeight=\"200px\" caps the card grid; six cards over two roles overflow so it clips mid-row and virtualizes within",
    fn: East.function([], UIComponentType, ($) => {
        const people = $.const([
            { id: "patel", name: "Patel, R.", role: "Senior", hours: 38.0 },
            { id: "cho", name: "Cho, J.", role: "Senior", hours: 26.0 },
            { id: "rivera", name: "Rivera, M.", role: "Senior", hours: 32.0 },
            { id: "okafor", name: "Okafor, S.", role: "Mid", hours: 40.0 },
            { id: "nguyen", name: "Nguyen, T.", role: "Mid", hours: 20.0 },
            { id: "kim", name: "Kim, A.", role: "Mid", hours: 22.0 },
        ]);
        return (
            <Library
                id="library-scroll"
                data={people}
                item={p => ({ key: p.id, label: p.name, sublabel: p.role })}
                dimensions={[{ kind: "meter", key: "hours", label: "Hours", value: p => p.hours, max: 40.0, format: h => East.str`${h}h` }]}
                groupBy={[{ key: "role", label: "Role", value: p => p.role }]}
                style={{ maxHeight: "200px" }}
            />
        );
    }),
    inputs: [],
});

export const libraryFill = example({
    keywords: ["Library", "fill", "height", "Card", "bounded", "scroll", "sizing", "#320"],
    description: "height=\"fill\" (#320) — the library card grid fills a fixed 200px Card body and scrolls within it; six cards overflow so it clips mid-row",
    fn: East.function([], UIComponentType, ($) => {
        const people = $.const([
            { id: "patel", name: "Patel, R.", role: "Senior", hours: 38.0 },
            { id: "cho", name: "Cho, J.", role: "Senior", hours: 26.0 },
            { id: "rivera", name: "Rivera, M.", role: "Senior", hours: 32.0 },
            { id: "okafor", name: "Okafor, S.", role: "Mid", hours: 40.0 },
            { id: "nguyen", name: "Nguyen, T.", role: "Mid", hours: 20.0 },
            { id: "kim", name: "Kim, A.", role: "Mid", hours: 22.0 },
        ]);
        return (
            <Card height="200px">
            <Library
                id="library-fill"
                data={people}
                item={p => ({ key: p.id, label: p.name, sublabel: p.role })}
                dimensions={[{ kind: "meter", key: "hours", label: "Hours", value: p => p.hours, max: 40.0, format: h => East.str`${h}h` }]}
                groupBy={[{ key: "role", label: "Role", value: p => p.role }]}
                style={{ height: "fill" }}
            />
            </Card>
        );
    }),
    inputs: [],
});
