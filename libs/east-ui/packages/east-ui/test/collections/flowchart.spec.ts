/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, some, variant } from "@elaraai/east";
import { Flowchart } from "@elaraai/east-ui/internal";
import * as ex from "./flowchart.examples.js";

describeEast("Flowchart", (test) => {
    Assert.examples(test, {
        flowchartMinimal: ex.flowchartMinimal,
        flowchartDepot: ex.flowchartDepot,
        flowchartBuilder: ex.flowchartBuilder,
        flowchartDetail: ex.flowchartDetail,
    });

    test("creates a flowchart with bare defaults", $ => {
        const flow = $.let(Flowchart.Root(
            [{ code: "ARV", name: "Arrived", phase: "intake" }],
            {
                state: s => ({ key: s.code, label: s.name, lane: s.phase }),
                links: [{ src: "ARV", dst: "ARV" }],
                link: l => ({ from: l.src, to: l.dst }),
                lanes: [{ key: "intake", label: "Intake" }],
            },
        ));
        const root = $.let(flow.unwrap().unwrap("Flowchart"));

        $(Assert.equal(root.states.get(0n).key, "ARV"));
        $(Assert.equal(root.states.get(0n).lane, "intake"));
        $(Assert.equal(root.states.get(0n).members.hasTag("none"), true));
        $(Assert.equal(root.links.get(0n).kind.hasTag("none"), true));
        $(Assert.equal(root.links.get(0n).trigger.hasTag("none"), true));
        $(Assert.equal(root.links.get(0n).evidence.hasTag("none"), true));
        $(Assert.equal(root.lanes.get(0n).label.unwrap("some"), "Intake"));
        // Zero baked chrome — view state defaults live in the renderer.
        $(Assert.equal(root.orientation.hasTag("none"), true));
        $(Assert.equal(root.freshness.hasTag("none"), true));
        $(Assert.equal(root.legend.hasTag("none"), true));
        $(Assert.equal(root.minimap.hasTag("none"), true));
        $(Assert.equal(root.slice.hasTag("none"), true));
        $(Assert.equal(root.stateHover.hasTag("none"), true));
        $(Assert.equal(root.linkHover.hasTag("none"), true));
        $(Assert.equal(root.triggerHover.hasTag("none"), true));
        $(Assert.equal(root.onAddLane.hasTag("none"), true));
        $(Assert.equal(root.readOnly.hasTag("none"), true));
        $(Assert.equal(root.onRenameLane.hasTag("none"), true));
        $(Assert.equal(root.onDeleteLane.hasTag("none"), true));
        $(Assert.equal(root.onAddState.hasTag("none"), true));
        $(Assert.equal(root.onEditState.hasTag("none"), true));
        $(Assert.equal(root.onMoveState.hasTag("none"), true));
        $(Assert.equal(root.linkMode.hasTag("none"), true));
        $(Assert.equal(root.onSelectState.hasTag("none"), true));
        $(Assert.equal(root.canConnect.hasTag("none"), true));
    });

    test("links resolve kinds, triggers and evidence through the encoding", $ => {
        const flow = $.let(Flowchart.Root(
            [
                { code: "IND", name: "Inducting", phase: "induct" },
                { code: "CH*", name: "Sort chutes", phase: "sort" },
            ],
            {
                state: s => ({ key: s.code, label: s.name, lane: s.phase }),
                links: [
                    { id: "l4", src: "IND", dst: "CH*", kind: variant("planned", null), decision: some("route"), parcels: some(17350.0) },
                ],
                link: l => ({
                    key: l.id, from: l.src, to: l.dst,
                    kind: l.kind,
                    trigger: l.decision,
                    evidence: { volume: l.parcels, unit: "parcels" },
                }),
                lanes: [{ key: "induct" }, { key: "sort" }],
                triggers: [{ id: "route", name: "route", who: "sort-planner" }],
                trigger: t => ({ key: t.id, label: t.name, owner: t.who }),
            },
        ));
        const root = $.let(flow.unwrap().unwrap("Flowchart"));

        $(Assert.equal(root.links.get(0n).key.unwrap("some"), "l4"));
        $(Assert.equal(root.links.get(0n).kind.unwrap("some").hasTag("planned"), true));
        $(Assert.equal(root.links.get(0n).trigger.unwrap("some"), "route"));
        $(Assert.equal(root.links.get(0n).evidence.unwrap("some").volume.unwrap("some"), 17350.0));
        $(Assert.equal(root.links.get(0n).evidence.unwrap("some").unit.unwrap("some"), "parcels"));
        $(Assert.equal(root.links.get(0n).evidence.unwrap("some").count.hasTag("none"), true));
        // Lanes default their label to none (renderer uppercases the key).
        $(Assert.equal(root.lanes.get(0n).label.hasTag("none"), true));
        $(Assert.equal(root.triggers.get(0n).key, "route"));
        $(Assert.equal(root.triggers.get(0n).owner.unwrap("some"), "sort-planner"));
        $(Assert.equal(root.triggers.get(0n).letter.hasTag("none"), true));
    });

    test("brush affordance is a build-time error", $ => {
        $(Assert.equal(East.value(
            (() => {
                try {
                    Flowchart.Root(
                        [{ code: "A", phase: "p" }],
                        {
                            state: s => ({ key: s.code, lane: s.phase }),
                            links: [],
                            lanes: [{ key: "p" }],
                            affordances: ["brush"],
                        },
                    );
                    return false;
                } catch {
                    return true;
                }
            })(),
        ), true));
    });
}, { platformFns: TestImpl });
