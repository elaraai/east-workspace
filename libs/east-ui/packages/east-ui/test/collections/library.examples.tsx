/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, example, some, none } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Library } from "@elaraai/east-ui";

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
