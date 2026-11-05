/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record the Flowchart's weighed details read (#1522, `Flowchart Records
 * Spec.md` R43–R46): what the depot measured in some of its states, each
 * service's share filed apart under the service's name through an entries
 * index, and each state's site through an index of its own — the fixture the
 * Flowchart's DOM tests over the rail's picks read, on no page of the
 * showcase. Its rows are keyed as the depot's states are
 * (`flowchart.examples.tsx`), and draw on those states' cards.
 *
 * Each row's services add up to its own figures: their parcels and their
 * waiting to its own, their hours bin by bin to its hours, their exceptions by
 * name to its exceptions, and their flags joined to its flags — so picking
 * every service draws what no pick draws. Its on-time share and its equipment
 * are the row's own, which no service holds. Every figure is made up.
 *
 * - **Sort chutes** (`CH*`, North): Standard, Priority and Economy.
 * - **Sorted** (`SRD`, North): Standard and Priority.
 * - **Held** (`HLD`, South): Standard and International — no Priority.
 * - **Arrived** (`ARV`, South): Standard and Economy.
 * - **Received** (`RCV`, South): Standard alone.
 *
 * So the services are held by five states, two, two and one: Standard,
 * Priority, Economy and International.
 *
 * @packageDocumentation
 */

import { ArrayType, DictType, FloatType, IntegerType, SetType, StringType, StructType } from "@elaraai/east";
import e3 from "@elaraai/e3";

/** One service's share of what a state measured: the state's own figures, for that service alone. */
export const ServiceShare = StructType({
    parcels: IntegerType,                             // its parcels through the state
    waiting: IntegerType,                             // still in it when measured
    flags: SetType(StringType),                       // what the app's task flags its parcels with
    hours: ArrayType(IntegerType),                    // its parcels by time in state: a count a bin, in the bins' order
    exceptions: DictType(StringType, IntegerType),    // its parcels by what went wrong
});

/** What the depot measured in a state: where, its own figures, and each service's share filed apart. */
export const WeighedEvidence = StructType({
    site: StringType,                                 // the site that measured it: an index of its own answers it
    parcels: IntegerType,
    waiting: IntegerType,
    onTime: FloatType,                                // the share through on time: a share, never added up
    flags: SetType(StringType),
    equipment: SetType(StringType),                   // what handles parcels there: no service holds it
    hours: ArrayType(IntegerType),
    exceptions: DictType(StringType, IntegerType),
    byService: DictType(StringType, ServiceShare),    // each service's own, by its name
});

/** The time in state's bins, in hours: under an hour, to 12h, to 2d, and 2d or more — a count of each row's hours a bin. */
export const WEIGHED_HOURS = [0, 1, 12, 48];

/** The services, as the rail offers them. */
export const WEIGHED_SERVICES = ["Standard", "Priority", "Economy", "International"];

/** What the depot's evidence task last wrote of five of its states, each service's share filed apart (#1522). */
export const weighedEvidence = e3.record("flowchart_service_evidence", DictType(StringType, WeighedEvidence), {
    initial: new Map([
        ["ARV", {
            site: "South", parcels: 200n, waiting: 10n, onTime: 0.95,
            flags: new Set<string>(), equipment: new Set(["Conveyor"]),
            hours: [100n, 60n, 30n, 10n], exceptions: new Map([["Late arrival", 5n]]),
            byService: new Map([
                ["Economy", { parcels: 80n, waiting: 4n, flags: new Set<string>(), hours: [40n, 20n, 15n, 5n], exceptions: new Map([["Late arrival", 2n]]) }],
                ["Standard", { parcels: 120n, waiting: 6n, flags: new Set<string>(), hours: [60n, 40n, 15n, 5n], exceptions: new Map([["Late arrival", 3n]]) }],
            ]),
        }],
        ["CH*", {
            site: "North", parcels: 600n, waiting: 40n, onTime: 0.8,
            flags: new Set(["At risk"]), equipment: new Set(["Conveyor", "Scanner"]),
            hours: [300n, 200n, 80n, 20n], exceptions: new Map([["Chute full", 26n], ["Missort", 41n]]),
            byService: new Map([
                ["Economy", { parcels: 50n, waiting: 5n, flags: new Set<string>(), hours: [20n, 20n, 10n, 0n], exceptions: new Map([["Missort", 3n]]) }],
                ["Priority", { parcels: 150n, waiting: 10n, flags: new Set(["At risk"]), hours: [80n, 50n, 15n, 5n], exceptions: new Map([["Chute full", 6n], ["Missort", 8n]]) }],
                ["Standard", { parcels: 400n, waiting: 25n, flags: new Set<string>(), hours: [200n, 130n, 55n, 15n], exceptions: new Map([["Chute full", 20n], ["Missort", 30n]]) }],
            ]),
        }],
        ["HLD", {
            site: "South", parcels: 1080n, waiting: 70n, onTime: 0.6,
            flags: new Set(["Customs", "Hazmat"]), equipment: new Set(["Forklift", "X-ray"]),
            hours: [100n, 300n, 400n, 280n], exceptions: new Map([["Duty unpaid", 236n], ["Missing documents", 412n]]),
            byService: new Map([
                ["International", {
                    parcels: 680n, waiting: 40n, flags: new Set(["Customs", "Hazmat"]), hours: [40n, 160n, 280n, 200n],
                    exceptions: new Map([["Duty unpaid", 236n], ["Missing documents", 400n]]),
                }],
                ["Standard", { parcels: 400n, waiting: 30n, flags: new Set<string>(), hours: [60n, 140n, 120n, 80n], exceptions: new Map([["Missing documents", 12n]]) }],
            ]),
        }],
        ["RCV", {
            site: "South", parcels: 90n, waiting: 5n, onTime: 0.7,
            flags: new Set(["Fragile"]), equipment: new Set(["Scanner"]),
            hours: [30n, 40n, 20n, 0n], exceptions: new Map<string, bigint>(),
            byService: new Map([
                ["Standard", { parcels: 90n, waiting: 5n, flags: new Set(["Fragile"]), hours: [30n, 40n, 20n, 0n], exceptions: new Map<string, bigint>() }],
            ]),
        }],
        ["SRD", {
            site: "North", parcels: 465n, waiting: 50n, onTime: 0.9,
            flags: new Set(["At risk", "Fragile"]), equipment: new Set(["Conveyor"]),
            hours: [200n, 150n, 80n, 35n], exceptions: new Map([["Damaged packaging", 6n], ["Missort", 14n]]),
            byService: new Map([
                ["Priority", { parcels: 130n, waiting: 20n, flags: new Set(["At risk"]), hours: [50n, 40n, 30n, 10n], exceptions: new Map([["Damaged packaging", 2n], ["Missort", 4n]]) }],
                ["Standard", { parcels: 335n, waiting: 30n, flags: new Set(["Fragile"]), hours: [150n, 110n, 50n, 25n], exceptions: new Map([["Damaged packaging", 4n], ["Missort", 10n]]) }],
            ]),
        }],
    ]),
    indexes: (index) => ({
        // Each service's share, a range of the index by the service's name: what the rail's picks read.
        flowchart_weighed_by_service: index.entries("byService"),
        // The site: the source's other field, which narrows the rows.
        flowchart_weighed_by_site: index.on(["site"]),
    }),
});
