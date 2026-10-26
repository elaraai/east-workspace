/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Schematic's edits (#1388, `edits.ts`): what each gesture writes, pure —
 * a Move's rigid, clamped delta (SC8); Connect's link and its Shift session's
 * net, which absorbs the links it grew from (SC9); a Retarget's end and an
 * Extend's destination (SC10); a Delete's rows, every link and net leg naming
 * a deleted item among them, and its refusal where a read-only link or net
 * names one (SC5, D7); and the refusals of an end no kind's field holds; and
 * a new link's or net's values, the selected template's of its kind (§4.3,
 * #1390); and the host's veto as every route asks it — its verdicts kept, a
 * veto that throws allowing — of every pair a gesture newly joins: a link's
 * one, a session's net's every pair, the run it gathers among them, and the
 * pairs a change of a net's sides newly joins — an open net's new member's, an
 * Extend's (#1394). Fixtures are real East values typed from the Schematic's
 * East types; each gesture's edits are compared as East prints them.
 */

import { describe, expect, test, vi } from "vitest";
import { ArrayType, BlobType, East, OptionType, StringType, StructType, defaultValue, equalFor, none, printFor, some, type option } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnLink, drawnNet, entityId, refOfId, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import {
    clampDelta, connectCandidate, connectStep, connectVeto, deleteEdits, editKinds, extendEdits, extendPairs, foldPair, foldSession, joinedPairs, linkRefusal,
    moveEdits, netKindFor, netRefusal, retargetEdits, vetoOfPairs, type ConnectCandidate, type ConnectDragArgs, type ConnectPair, type ConnectSession,
    type EditKinds, type SchematicEdit, type SessionDrawn,
} from "./edits.js";

const T = Schematic.Types;
const stringEqual = equalFor(StringType);
const printRef = printFor(T.Ref);
const printAt = printFor(OptionType(T.Point));
const printEnds = printFor(T.Ends);
const printSides = printFor(T.Sides);
const printValues = printFor(OptionType(BlobType));
const printBlob = printFor(BlobType);
/** A field an author's card sets, as an author's tab's card carries it. */
const FieldWriteType = StructType({ path: ArrayType(StringType), value: BlobType });
const printWrites = printFor(ArrayType(FieldWriteType));

/** An edit as East prints what it writes: its op, its row's reference, and its value. */
function printed(edit: SchematicEdit): string {
    switch (edit.op) {
        case "place": return `place ${printRef(edit.ref)} ${printAt(edit.at)}`;
        case "ends": return `ends ${printRef(edit.ref)} ${printEnds(edit.ends)}`;
        case "sides": return `sides ${printRef(edit.ref)} ${printSides(edit.sides)}`;
        case "link": return `link ${printRef(edit.ref)} ${printEnds(edit.ends)}`;
        case "net": return `net ${printRef(edit.ref)} ${printSides(edit.sides)}`;
        case "item": return `item ${printRef(edit.ref)} ${printAt(edit.at)} ${printValues(edit.values)}`;
        case "retype": return `retype ${printRef(edit.ref)} ${printBlob(edit.values)}`;
        case "set": return `set${edit.details === true ? " details" : ""} ${printRef(edit.ref)} ${printWrites([...edit.sets])}`;
        case "row": return `row${edit.details === true ? " details" : ""} ${printRef(edit.ref)} ${printBlob(edit.row)}`;
        case "remove": return `remove ${printRef(edit.ref)}`;
    }
}

/** No template selected: a new link's or net's other fields take their types' defaults. */
const DEFAULTS = (_slot: string): option<Uint8Array> => none;

const ref = (kind: string, key: string): SchematicRef => ({ kind, key });
const A01 = ref("racks", "A01"), A02 = ref("racks", "A02"), A03 = ref("racks", "A03");
const ODF = ref("network", "ODF-1"), MMR = ref("network", "MMR-1"), CORE = ref("network", "CORE-1");
const PDU = ref("pdus", "PDU-A");

/** Pairs as East prints their items: `from → to` each. */
const printPairs = (pairs: readonly ConnectPair[]) => pairs.map((pair) => `${printRef(pair.from)} → ${printRef(pair.to)}`);

/** A candidate as the tests read it: its kind, its refusal, and its pairs as East prints them. */
const read = (candidate: ConnectCandidate) => ({ kind: candidate.kind, refusal: candidate.refusal, pairs: printPairs(candidate.pairs) });

/** A data centre's kinds: racks and cooling written, frames and power units read only; fibre runs written, between racks and frames; trunks of racks into a frame, and power feeds, written. */
const KINDS: EditKinds = {
    items: new Set(["racks", "cooling"]),
    links: new Map([["fibre", { name: "Fibre run", editable: true, from: ["racks", "network"], to: ["racks", "network"] }]]),
    nets: new Map([
        ["feeds", { name: "Power feed", editable: true, sources: "pdus", destinations: "racks" }],
        ["trunks", { name: "Fibre trunk", editable: true, sources: "racks", destinations: "network" }],
    ]),
};

/** An item drawn at a point, labelled with its key. */
function item(at: SchematicRef, x: number, y: number) {
    return drawnItem(at, { ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y }), label: at.key }, undefined)!;
}

/** A link drawn between two items. */
function link(at: SchematicRef, from: SchematicRef, to: SchematicRef) {
    return drawnLink(at, { ...defaultValue<typeof T.Link>(T.Link), from, to });
}

/** A net drawn over its sides. */
function net(at: SchematicRef, sources: readonly SchematicRef[], destinations: readonly SchematicRef[]) {
    return drawnNet(at, { ...defaultValue<typeof T.Net>(T.Net), sources: [...sources], destinations: [...destinations] });
}

/** A drawing of the data centre: three racks, three frames and a power unit; u1 from A01 to ODF-1; feed-a from PDU-A to A01 and A02. */
const DRAWN: Pick<SchematicDrawn, "items" | "links" | "nets"> = {
    items: [item(A01, 2, 3), item(A02, 6, 3), item(A03, 9, 3), item(ODF, 8, 9), item(MMR, 24, 3), item(CORE, 23, 10), item(PDU, 1, 4)],
    links: [link(ref("fibre", "u1"), A01, ODF)],
    nets: [net(ref("feeds", "feed-a"), [PDU], [A01, A02])],
};

/** The session's links and net as a drawing holds them. */
function sessionDrawn(drawn: Pick<SchematicDrawn, "links" | "nets">): SessionDrawn {
    const parse = (id: string) => [...DRAWN.items, ...drawn.links, ...drawn.nets].find((entity) => stringEqual(entity.key, id))?.ref;
    return {
        ends: (at) => {
            const found = drawn.links.find((l) => stringEqual(l.key, entityId(at)));
            return found === undefined ? undefined : { from: parse(found.from)!, to: parse(found.to)! };
        },
        sides: (at) => {
            const found = drawn.nets.find((n) => stringEqual(n.key, entityId(at)));
            return found === undefined ? undefined : { sources: found.sources.map((id) => parse(id)!), destinations: found.destinations.map((id) => parse(id)!) };
        },
    };
}

/** A drag from one item to another, over a drawing, in a session or none. */
function drag(from: SchematicRef, to: SchematicRef, options: { session?: ConnectSession; shift?: boolean; drawn?: Pick<SchematicDrawn, "links" | "nets"> } = {}): ConnectDragArgs {
    return {
        session: options.session, shift: options.shift ?? false, linkKind: "fibre",
        from: { ref: from, label: from.key }, to: { ref: to, label: to.key },
        drawn: sessionDrawn(options.drawn ?? DRAWN), labelOf: (at) => at.key,
    };
}

/** Keys minted in order: each kind's `new-1`, `new-2`, … */
function minter() {
    let n = 0;
    return (slot: string) => `${slot}-new-${++n}`;
}

describe("editKinds", () => {
    test("a kind writes when it is bound with its patch door, and none does while the Schematic is read only (SC14)", () => {
        const kind = (key: string, editable: boolean) => ({ key, name: key, editable });
        const value = {
            items: [kind("racks", true), kind("network", false)],
            links: [{ ...kind("fibre", true), ends: { from: ["racks"], to: ["network"] } }],
            nets: [{ ...kind("feeds", false), sides: { sources: "pdus", destinations: "racks" } }],
        } as unknown as Parameters<typeof editKinds>[0];
        const kinds = editKinds({ ...value, readOnly: false });
        expect([...kinds.items]).toEqual(["racks"]);
        expect(kinds.links.get("fibre")?.editable).toBe(true);
        expect(kinds.nets.get("feeds")?.editable).toBe(false);
        const none = editKinds({ ...value, readOnly: true });
        expect([...none.items]).toEqual([]);
        expect(none.links.get("fibre")?.editable).toBe(false);
    });
});

describe("Move (SC8)", () => {
    const movers = [{ ref: A01, x: 2, y: 3 }, { ref: A02, x: 6, y: 3 }];
    const extent = { width: 28, height: 14 };

    test("moves every item rigidly by the drag's delta, each centre where the drag found it plus the delta", () => {
        const delta = clampDelta(movers, 1.5, 2, extent);
        expect(delta).toEqual({ dx: 1.5, dy: 2 });
        expect(moveEdits(movers, delta).map(printed)).toEqual([
            `place ${printRef(A01)} ${printAt(some({ x: 3.5, y: 5 }))}`,
            `place ${printRef(A02)} ${printAt(some({ x: 7.5, y: 5 }))}`,
        ]);
    });

    test("the delta is clamped so every centre stays within the extent: the group keeps its shape at the edge", () => {
        // Leftward past the edge: A01 stops at x 0, and A02 keeps its 4 m from it.
        expect(clampDelta(movers, -5, 0, extent)).toEqual({ dx: -2, dy: 0 });
        // Down past the floor's foot: both stop where the lowest reaches 14.
        expect(clampDelta(movers, 0, 20, extent)).toEqual({ dx: 0, dy: 11 });
        // Right past the far edge: A02 stops at 28.
        expect(clampDelta(movers, 30, 0, extent)).toEqual({ dx: 22, dy: 0 });
    });

    test("an item already outside the extent moves no further out, and is never pulled in", () => {
        const outside = [{ ref: A03, x: -1, y: 3 }];
        expect(clampDelta(outside, -2, 0, extent)).toEqual({ dx: 0, dy: 0 });
        expect(clampDelta(outside, 0.5, 0, extent)).toEqual({ dx: 0.5, dy: 0 });
    });

    test("a release where the drag began writes nothing", () => {
        expect(moveEdits(movers, { dx: 0, dy: 0 })).toEqual([]);
    });
});

describe("a session's fold", () => {
    test("the first pair sets both sides; from a member adds downstream, into a member upstream; two new items each to its side", () => {
        const one = foldPair({ sources: [], destinations: [] }, { from: A01, to: ODF });
        expect(printSides(one)).toBe(printSides({ sources: [A01], destinations: [ODF] }));
        expect(printSides(foldPair(one, { from: A01, to: MMR }))).toBe(printSides({ sources: [A01], destinations: [ODF, MMR] }));
        expect(printSides(foldPair(one, { from: A02, to: ODF }))).toBe(printSides({ sources: [A01, A02], destinations: [ODF] }));
        expect(printSides(foldPair(one, { from: A02, to: MMR }))).toBe(printSides({ sources: [A01, A02], destinations: [ODF, MMR] }));
    });

    test("a pair between two members changes nothing: a member never changes side", () => {
        const sides = foldSession([{ from: A01, to: ODF }, { from: A02, to: ODF }]);
        expect(printSides(foldPair(sides, { from: ODF, to: A02 }))).toBe(printSides(sides));
    });

    test("the first editable net kind whose sides hold the members grows the session; none holds one of mixed slots", () => {
        expect(netKindFor(KINDS, { sources: [A01, A02], destinations: [ODF] })).toBe("trunks");
        expect(netKindFor(KINDS, { sources: [PDU], destinations: [A01] })).toBe("feeds");
        expect(netKindFor(KINDS, { sources: [A01], destinations: [ODF, A02] })).toBeUndefined();
        const readOnly: EditKinds = { ...KINDS, nets: new Map([["trunks", { ...KINDS.nets.get("trunks")!, editable: false }]]) };
        expect(netKindFor(readOnly, { sources: [A01], destinations: [ODF] })).toBeUndefined();
    });
});

describe("Connect and its Shift session (SC9)", () => {
    test("a plain drag records a link of the Connect tool's kind, its key minted, and opens a session of it", () => {
        const step = connectStep(KINDS, drag(A02, ODF), minter(), DEFAULTS)!;
        expect(step.edits.map(printed)).toEqual([`link ${printRef(ref("fibre", "fibre-new-1"))} ${printEnds({ from: A02, to: ODF })}`]);
        expect(step.session.links.map((at) => printRef(at))).toEqual([printRef(ref("fibre", "fibre-new-1"))]);
        expect(step.session.net).toBeUndefined();
    });

    test("its kind's end holding no item of the target's slot refuses it, naming the end — nothing is recorded", () => {
        expect(read(connectCandidate(KINDS, drag(A01, PDU)))).toEqual({
            kind: "fibre", refusal: { why: "end", kind: "Fibre run", end: "end", item: "PDU-A" }, pairs: printPairs([{ from: A01, to: PDU }]),
        });
        expect(connectCandidate(KINDS, drag(PDU, A01)).refusal).toEqual({ why: "end", kind: "Fibre run", end: "start", item: "PDU-A" });
        expect(connectStep(KINDS, drag(A01, PDU), minter(), DEFAULTS)).toBeUndefined();
        expect(linkRefusal(KINDS.links.get("fibre")!, { ref: A01, label: "A01" }, { ref: ODF, label: "ODF-1" })).toBeUndefined();
    });

    test("the first Shift-drag grows the session into a net of the kind that holds it, deleting the link it absorbs — one step", () => {
        const first = connectStep(KINDS, drag(A02, ODF), minter(), DEFAULTS)!;
        // The drawing holds the new run as its first step left it.
        const drawn = { links: [...DRAWN.links, link(first.session.links[0]!, A02, ODF)], nets: DRAWN.nets };
        const mint = minter();
        const args = drag(A03, ODF, { session: first.session, shift: true, drawn });
        // The veto hears each of the trunk's legs: the run it gathers, a leg of the trunk now, and the new one.
        expect(read(connectCandidate(KINDS, args))).toEqual({ kind: "trunks", refusal: undefined, pairs: printPairs([{ from: A02, to: ODF }, { from: A03, to: ODF }]) });
        const grown = connectStep(KINDS, args, mint, DEFAULTS)!;
        expect(grown.edits.map(printed)).toEqual([
            `remove ${printRef(first.session.links[0]!)}`,
            `net ${printRef(ref("trunks", "trunks-new-1"))} ${printSides({ sources: [A02, A03], destinations: [ODF] })}`,
        ]);
        expect(grown.session.links).toEqual([]);
        expect(printRef(grown.session.net!)).toBe(printRef(ref("trunks", "trunks-new-1")));
    });

    test("each later Shift-drag writes the net's sides, as the drawing holds them; one between two members writes nothing", () => {
        const trunk = ref("trunks", "t1");
        const drawn = { links: DRAWN.links, nets: [...DRAWN.nets, net(trunk, [A02, A03], [ODF])] };
        const session: ConnectSession = { links: [], net: trunk };
        const step = connectStep(KINDS, drag(A01, ODF, { session, shift: true, drawn }), minter(), DEFAULTS)!;
        expect(step.edits.map(printed)).toEqual([`sides ${printRef(trunk)} ${printSides({ sources: [A02, A03, A01], destinations: [ODF] })}`]);
        expect(connectStep(KINDS, drag(A02, ODF, { session, shift: true, drawn }), minter(), DEFAULTS)).toBeUndefined();
        // From the frame to a rack: the rack would join downstream, among the frames, where the trunk holds none — the
        // draft names it.
        expect(connectCandidate(KINDS, drag(ODF, A01, { session, shift: true, drawn })).refusal)
            .toEqual({ why: "end", kind: "Fibre trunk", end: "end", item: "A01" });
        expect(netRefusal(KINDS.nets.get("trunks")!, { sources: [A01], destinations: [ODF] }, (at) => at.key)).toBeUndefined();
    });

    test("a session no net kind holds adds a link a drag, each absorbed if a later fold is held", () => {
        const first = connectStep(KINDS, drag(A01, ODF), minter(), DEFAULTS)!;
        const drawn = { links: [...DRAWN.links, link(first.session.links[0]!, A01, ODF)], nets: DRAWN.nets };
        // A01 → A02 folds a rack onto the frames' side: no net kind holds it, so a second run.
        const second = connectStep(KINDS, drag(A01, A02, { session: first.session, shift: true, drawn }), minter(), DEFAULTS)!;
        expect(second.edits.map((edit) => edit.op)).toEqual(["link"]);
        expect(second.session.links).toHaveLength(2);
    });

    test("a session the drawing no longer holds — taken back by Undo — is over: the drag records a plain link", () => {
        const session: ConnectSession = { links: [ref("fibre", "gone")], net: undefined };
        expect(read(connectCandidate(KINDS, drag(A03, ODF, { session, shift: true })))).toEqual({ kind: "fibre", refusal: undefined, pairs: printPairs([{ from: A03, to: ODF }]) });
        const step = connectStep(KINDS, drag(A03, ODF, { session, shift: true }), minter(), DEFAULTS)!;
        expect(step.edits.map((edit) => edit.op)).toEqual(["link"]);
    });

    test("a new link or net takes its other fields from the template of its own kind the library has selected, and from none of another kind's (§4.3, #1390)", () => {
        // A fibre run's template selected: the run takes its values; the trunk the session grows into, of another kind, its defaults.
        const uplink = new Uint8Array([1, 2, 3]);
        const fibreTemplate = (slot: string): option<Uint8Array> => (stringEqual(slot, "fibre") ? some(uplink) : none);
        const values = (edit: SchematicEdit | undefined) => (edit !== undefined && (edit.op === "link" || edit.op === "net") ? printValues(edit.values) : "no new row");
        const first = connectStep(KINDS, drag(A02, ODF), minter(), fibreTemplate)!;
        expect(values(first.edits[0])).toBe(printValues(some(uplink)));
        const drawn = { links: [...DRAWN.links, link(first.session.links[0]!, A02, ODF)], nets: DRAWN.nets };
        const grown = connectStep(KINDS, drag(A03, ODF, { session: first.session, shift: true, drawn }), minter(), fibreTemplate)!;
        expect(values(grown.edits.find((edit) => edit.op === "net"))).toBe(printValues(none));
    });
});

describe("Retarget and Extend (SC10)", () => {
    test("Retarget writes the end it moves; onto the link's other end, or where it was, nothing", () => {
        const u1 = { ref: ref("fibre", "u1"), ends: { from: A01, to: ODF } };
        expect(retargetEdits(u1, "to", MMR).map(printed)).toEqual([`ends ${printRef(u1.ref)} ${printEnds({ from: A01, to: MMR })}`]);
        expect(retargetEdits(u1, "from", A02).map(printed)).toEqual([`ends ${printRef(u1.ref)} ${printEnds({ from: A02, to: ODF })}`]);
        expect(retargetEdits(u1, "to", A01)).toEqual([]);
        expect(retargetEdits(u1, "to", ODF)).toEqual([]);
    });

    test("Extend adds an item to a net's destinations; a member already, nothing", () => {
        const feed = { ref: ref("feeds", "feed-a"), sides: { sources: [PDU], destinations: [A01, A02] } };
        expect(extendEdits(feed, A03).map(printed)).toEqual([`sides ${printRef(feed.ref)} ${printSides({ sources: [PDU], destinations: [A01, A02, A03] })}`]);
        expect(extendEdits(feed, A02)).toEqual([]);
    });

    test("an Extend joins each of the net's sources to the item it adds, whichever member the drag began at; a member already, none", () => {
        const trunk = { sources: [A01, A02], destinations: [ODF] };
        expect(printPairs(extendPairs(trunk, MMR))).toEqual(printPairs([{ from: A01, to: MMR }, { from: A02, to: MMR }]));
        expect(extendPairs(trunk, ODF)).toEqual([]);
        expect(extendPairs(trunk, A01)).toEqual([]);
    });
});

describe("the host's veto (#1401, D34, #1394)", () => {
    /** The data centre's veto: two frames are joined by a cross-connect, never a run. */
    const frames = East.compile(East.function([T.Candidate], OptionType(StringType), ($, candidate) => {
        const reason = $.let(none, OptionType(StringType));
        $.if(candidate.from.kind.equal("network").and(() => candidate.to.kind.equal("network")), ($2) => {
            $2.assign(reason, some("Two frames are joined by a cross-connect"));
        });
        return reason;
    }), []);

    test("its words refuse a candidate it refuses, and allow the rest; each verdict kept, so a candidate asked again asks it nothing", () => {
        let asked = 0;
        const veto = connectVeto((candidate) => { asked++; return frames(candidate); }, refOfId);
        expect(veto("fibre", entityId(MMR), entityId(ODF))).toBe("Two frames are joined by a cross-connect");
        expect(veto("fibre", entityId(A01), entityId(ODF))).toBeUndefined();
        expect(veto("fibre", entityId(MMR), entityId(ODF))).toBe("Two frames are joined by a cross-connect");
        expect(veto("fibre", entityId(A01), entityId(ODF))).toBeUndefined();
        expect(asked).toBe(2);
    });

    test("with no veto every connection is allowed; a veto that throws is logged and allows; an item it can't name it is never asked of, and allowed", () => {
        expect(connectVeto(undefined, refOfId)("fibre", entityId(MMR), entityId(ODF))).toBeUndefined();
        const broken = East.compile(East.function([T.Candidate], OptionType(StringType), ($, _candidate) => {
            const reason = $.let(none, OptionType(StringType));
            $.error("the veto broke");
            return reason;
        }), []);
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            expect(connectVeto(broken, refOfId)("fibre", entityId(MMR), entityId(ODF))).toBeUndefined();
            expect(logged).toHaveBeenCalledTimes(1);
        } finally {
            logged.mockRestore();
        }
        let asked = 0;
        const veto = connectVeto((candidate) => { asked++; return frames(candidate); }, (id) => (stringEqual(id, entityId(MMR)) ? undefined : refOfId(id)));
        expect(veto("fibre", entityId(MMR), entityId(ODF))).toBeUndefined();
        expect(asked).toBe(0);
    });

    test("a change of a net's sides joins each source with each destination one of the two is new to: a destination added, a source added; members taken off join none", () => {
        const PDU_B = ref("pdus", "PDU-B");
        const feed = { sources: [PDU], destinations: [A01, A02] };
        expect(printPairs(joinedPairs(feed, { sources: [PDU], destinations: [A01, A02, A03] }))).toEqual([`${printRef(PDU)} → ${printRef(A03)}`]);
        expect(printPairs(joinedPairs(feed, { sources: [PDU, PDU_B], destinations: [A01, A02] })))
            .toEqual([`${printRef(PDU_B)} → ${printRef(A01)}`, `${printRef(PDU_B)} → ${printRef(A02)}`]);
        expect(joinedPairs(feed, { sources: [PDU], destinations: [A02] })).toEqual([]);
        expect(joinedPairs(feed, feed)).toEqual([]);
    });

    /** The data centre's whole veto: two frames are joined by a cross-connect, and a trunk lands on a fibre frame, never the core. */
    const dataCentre = East.compile(East.function([T.Candidate], OptionType(StringType), ($, candidate) => {
        const reason = $.let(none, OptionType(StringType));
        $.if(candidate.from.kind.equal("network").and(() => candidate.to.kind.equal("network")), ($2) => {
            $2.assign(reason, some("Two frames are joined by a cross-connect"));
        });
        $.if(candidate.kind.equal("trunks").and(() => candidate.to.key.equal("CORE-1")), ($2) => {
            $2.assign(reason, some("A trunk lands on a fibre frame, never the core"));
        });
        return reason;
    }), []);

    test("a session's net is asked of every leg it would leave: a run onto the core gathered into a trunk is refused in the veto's words, though the pair dragged lands", () => {
        const veto = connectVeto(dataCentre, refOfId);
        // A03 to the core: a run, which the veto allows.
        const first = connectStep(KINDS, drag(A03, CORE), minter(), DEFAULTS)!;
        expect(vetoOfPairs(veto, "fibre", [{ from: A03, to: CORE }])).toBeUndefined();
        // Shift-dragged on to the fibre frame: the trunk it grows into would land on the core — refused, though A03 → ODF-1
        // alone would land.
        const drawn = { links: [...DRAWN.links, link(first.session.links[0]!, A03, CORE)], nets: DRAWN.nets };
        const candidate = connectCandidate(KINDS, drag(A03, ODF, { session: first.session, shift: true, drawn }));
        expect(read(candidate)).toEqual({ kind: "trunks", refusal: undefined, pairs: printPairs([{ from: A03, to: CORE }, { from: A03, to: ODF }]) });
        expect(vetoOfPairs(veto, candidate.kind!, candidate.pairs)).toBe("A trunk lands on a fibre frame, never the core");
        expect(vetoOfPairs(veto, "trunks", [{ from: A03, to: ODF }])).toBeUndefined();
    });

    test("an open net is asked of each pair a drag newly joins: a frame it holds dragged to another joins each of its racks to it, never the two frames to each other", () => {
        const veto = connectVeto(dataCentre, refOfId);
        const trunk = ref("trunks", "t1");
        const session: ConnectSession = { links: [], net: trunk };
        const drawn = { links: DRAWN.links, nets: [...DRAWN.nets, net(trunk, [A02, A03], [ODF])] };
        const candidate = connectCandidate(KINDS, drag(ODF, MMR, { session, shift: true, drawn }));
        expect(read(candidate)).toEqual({ kind: "trunks", refusal: undefined, pairs: printPairs([{ from: A02, to: MMR }, { from: A03, to: MMR }]) });
        expect(vetoOfPairs(veto, "trunks", candidate.pairs)).toBeUndefined();
        // Onto the core instead: each of its racks would land there — refused.
        expect(vetoOfPairs(veto, "trunks", connectCandidate(KINDS, drag(ODF, CORE, { session, shift: true, drawn })).pairs))
            .toBe("A trunk lands on a fibre frame, never the core");
    });
});

describe("Delete (SC5, SC10, D7)", () => {
    const select = (items: readonly SchematicRef[], picked: { key: string; leg: { end: "source" | "destination"; item: string } | null } | null = null) =>
        ({ items: new Set(items.map((at) => entityId(at))), link: picked });
    const edits = (result: ReturnType<typeof deleteEdits>) => ("edits" in result ? result.edits.map(printed) : result);

    test("the selected link is deleted, and the selected net", () => {
        expect(edits(deleteEdits(KINDS, DRAWN, select([], { key: entityId(ref("fibre", "u1")), leg: null })))).toEqual([`remove ${printRef(ref("fibre", "u1"))}`]);
        expect(edits(deleteEdits(KINDS, DRAWN, select([], { key: entityId(ref("feeds", "feed-a")), leg: null })))).toEqual([`remove ${printRef(ref("feeds", "feed-a"))}`]);
    });

    test("a net's leg takes its item off its side; its side's last member deletes the net", () => {
        const feed = entityId(ref("feeds", "feed-a"));
        expect(edits(deleteEdits(KINDS, DRAWN, select([], { key: feed, leg: { end: "destination", item: entityId(A02) } }))))
            .toEqual([`sides ${printRef(ref("feeds", "feed-a"))} ${printSides({ sources: [PDU], destinations: [A01] })}`]);
        expect(edits(deleteEdits(KINDS, DRAWN, select([], { key: feed, leg: { end: "source", item: entityId(PDU) } }))))
            .toEqual([`remove ${printRef(ref("feeds", "feed-a"))}`]);
    });

    test("the selected items go with every link naming one and every net leg naming one, in one step", () => {
        expect(edits(deleteEdits(KINDS, DRAWN, select([A01])))).toEqual([
            `remove ${printRef(A01)}`,
            `remove ${printRef(ref("fibre", "u1"))}`,
            `sides ${printRef(ref("feeds", "feed-a"))} ${printSides({ sources: [PDU], destinations: [A02] })}`,
        ]);
        // Both of the feed's racks: its fed side holds none, and the feed goes too.
        expect(edits(deleteEdits(KINDS, DRAWN, select([A01, A02])))).toEqual([
            `remove ${printRef(A01)}`, `remove ${printRef(A02)}`, `remove ${printRef(ref("fibre", "u1"))}`, `remove ${printRef(ref("feeds", "feed-a"))}`,
        ]);
    });

    test("an item of a kind bound read only stays: only the selection's written items go", () => {
        expect(edits(deleteEdits(KINDS, DRAWN, select([ODF])))).toEqual([]);
        expect(edits(deleteEdits(KINDS, DRAWN, select([A03, ODF])))).toEqual([`remove ${printRef(A03)}`]);
    });

    test("an item a read-only link or net names is not deleted: the Delete is refused, naming it", () => {
        const frozen: EditKinds = { ...KINDS, nets: new Map([["feeds", { ...KINDS.nets.get("feeds")!, editable: false }]]) };
        expect(deleteEdits(frozen, DRAWN, select([A02]))).toEqual({ refusal: { why: "named", item: "A02", kind: "Power feed", key: "feed-a" } });
        // A read-only link merely selected stays, and refuses nothing.
        const fixed: EditKinds = { ...KINDS, links: new Map([["fibre", { ...KINDS.links.get("fibre")!, editable: false }]]) };
        expect(edits(deleteEdits(fixed, DRAWN, select([], { key: entityId(ref("fibre", "u1")), leg: null })))).toEqual([]);
    });
});
