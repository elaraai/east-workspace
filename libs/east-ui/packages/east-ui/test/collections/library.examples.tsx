/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example, some, none, ArrayType, FloatType, IntegerType, NullType, StringType, StructType } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Box, Configurator, Library, Reactive, SegmentGroup, Slice, Text} from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

// ============================================================================
// Large libraries (#258) — hundreds of cards behind a height-constrained,
// virtualized scroll region. Data is generated East-side and deterministically
// (remainder indexing into literal pools — no host randomness).
// ============================================================================

/** Row shapes for the two small folded-in datasets (the old variant panel's
 *  asset and flat-room palettes) — each gets its own Slice config so the
 *  sliced mode composes across every dataset. */

// The ONE shared 400-card crew generator all three libraryLarge configurator
// branches consume (the literal pools live inside the generator body so the
// fixture is a self-contained module-scope expression).

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

/**
 * THE large-library configurator (pass 5) — ONE live crew palette: slice
 * chrome (search / filter rail / count footer) composes on permanently, the
 * two-level grouping stays, and the size axis feeds the height expression
 * (auto / scroll / fill — an empty height reads as unbounded).
 */
export const libraryLarge = example({
    keywords: ["Library", "large", "virtualization", "scroll", "height", "group", "hundreds", "performance", "slice", "chrome", "filter", "search", "rail", "count", "footer", "Slice.rows", "SegmentGroup", "Configurator", "getTag", "configurator", "card", "chips", "meter", "maxHeight", "bounded", "fill", "#320"],
    description: "Large-library configurator — a size axis (auto / scroll / fill) on one live sliced, grouped crew palette of hundreds of cards",
    fn: East.function([], UIComponentType, (_$) => {
        const CrewType = StructType({
            id: StringType,
            name: StringType,
            role: StringType,
            depot: StringType,
            hours: FloatType,
            skills: ArrayType(StringType),
        });
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
        const cfg = Slice.config(CrewType, {
            fields: { name: { label: "Name" }, role: { label: "Role" }, depot: { label: "Depot" } },
            searchFieldIds: ["name", "role", "depot"],
        });
        return (
            <Reactive>{$ => {
                const sizes = $.const(["auto", "scroll", "fill"], ArrayType(StringType));
                const sizeBind = $.let(State.bind([StringType], "library_large_size", "scroll"));
                const sizeKey = $.let(sizeBind.read());
                const onSizeChange = $.const(East.function([StringType], NullType, ($, next) => {
                    $(sizeBind.write(next));
                }));

                const crew = $.const(LIBRARY_LARGE_CARDS);
                const slice = $.let(Slice.bind([CrewType], "ex.library.large.slice", cfg, Slice.state({}), crew, none));
                const narrowed = $.let(Slice.rows([CrewType], slice));

                // An empty height string reads as "unbounded"; the wrapper Box
                // only bounds in fill mode.
                const boxHeight = $.let(sizeKey.equal("fill").ifElse(_$ => "300px", _$ => ""));
                const libHeight = $.let(sizeKey.equal("scroll").ifElse(
                    _$ => "480px",
                    _$ => sizeKey.equal("fill").ifElse(_$ => "100%", _$ => ""),
                ));

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Size", sizeKey,
                                <SegmentGroup value={sizeKey} onChange={onSizeChange} size="sm"
                                    items={sizes.map((_$, m) => SegmentGroup.Item(m, <Text>{m.upperCase()}</Text>))} />),
                        ]}
                        preview={
                            <Box width="100%" height={boxHeight} overflow="hidden">
                                <Library
                                    id="crew"
                                    data={narrowed}
                                    slice={slice}
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
                                    style={{ height: libHeight }}
                                />
                            </Box>
                        }
                        spec={[
                            Configurator.Spec("Cards", East.print(LIBRARY_LARGE_CARDS.size())),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
