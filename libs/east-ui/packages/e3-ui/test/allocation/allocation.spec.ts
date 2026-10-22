/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's tag (#1371, `Builder Interfaces Spec.md` §6.1, §2): what it
 * refuses at build, each removed prop naming the form that replaces it (B4),
 * and the examples, compiled. A payload's build reads the app's records — the
 * bin kind's session, the lanes and the resources from their accessors — so
 * what a payload holds is checked on e3 itself, in e3-ui-components; here,
 * what is refused before anything is read, and the board's words and bands as
 * the tag resolves them.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, VariantType, none, some, variant,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import * as EastUI from "@elaraai/east-ui";
import { Slice, TimeStepType } from "@elaraai/east-ui";
import e3 from "@elaraai/e3";
import { Allocation, Data, Schedule } from "@elaraai/e3-ui";
import { AllocationPayloadType, Func, Record, allocationBands, allocationLabels, createAllocationPayload, type AllocationProps } from "@elaraai/e3-ui/internal";
import { Kiln, KilnBin } from "./kiln-yard.js";
import * as ex from "./allocation.examples.js";

describeEast("Allocation — inline bound examples", test => {
    Assert.examples(test, {
        allocationMinimal: ex.allocationMinimal, allocationKilnYard: ex.allocationKilnYard, allocationTable: ex.allocationTable, allocationLabels: ex.allocationLabels,
        allocationPublished: ex.allocationPublished, allocationNoPublish: ex.allocationNoPublish, allocationSplit: ex.allocationSplit,
        allocationWindowed: ex.allocationWindowed, allocationMobile: ex.allocationMobile, allocationCustomBin: ex.allocationCustomBin,
        allocationFitRule: ex.allocationFitRule,
    });
}, { platformFns: TestImpl });

/** The props over the kiln yard's records, its bins' row type theirs. */
type Props = AllocationProps<typeof KilnBin>;

/** What the props over the kiln yard's records hold before a test changes them: the bins, the bays, the kilns, the loads and the fit. */
interface Base {
    /** The props. */
    readonly props: Props;
    /** The bins, bound with their patch door. */
    readonly bins: unknown;
    /** The kilns, bound. */
    readonly yard: unknown;
}

/**
 * Builds a payload's East function over the kiln yard's records, the props the
 * test gives beside or in place of the base's — refused, if it is, as it is built.
 */
function payload(change: (base: Base) => Partial<Props> | Readonly<Record<string, unknown>> = () => ({})): void {
    East.function([], AllocationPayloadType, ($) => {
        const bins = $.let(Record.bind(ex.kilnBins, [ex.kilnBinsPatch]));
        const loads = $.let(Data.bind(ex.arrivals));
        const yard = $.let(Data.bind(ex.kilns));
        const bays = $.let(Data.bind(ex.yardBays));
        const fit = $.let(Func.bind(ex.yardFit));
        const props: Props = {
            fit,
            events: { bin: Schedule.events(bins, {
                name: "Bin", icon: "box", at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
            }) },
            resources: {
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max }),
            },
            arrivals: Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) }),
        };
        return createAllocationPayload({ ...props, ...change({ props, bins, yard }) } as Props);
    });
}

/** The kilns' kind, its accessors as given. */
const kilnsKind = (base: Base, config: object) =>
    Schedule.resources((base.yard as { read: () => never }).read(), { name: "Kilns", icon: "fire", label: (k: { name: unknown }) => k.name, ...config } as never);

test("Allocation is one tag; BuilderFrame, Builder and View are not part of its developer API, and east-ui has no Allocation", () => {
    assert.equal("Builder" in Allocation, false); assert.equal("View" in Allocation, false);
    assert.equal("Allocation" in EastUI, false);
    assert.doesNotThrow(() => payload());
});

describe("the props §2 removed, each refused naming its replacement (B4)", () => {
    test("`days` and `window`: the app's bins, its days, and the bin kind's source of the slice", () => {
        assert.throws(() => payload(() => ({ days: {} })),
            /Allocation: `days` is gone — the Allocation writes the app's own bins, events=\{\{ bin: Schedule\.events\(.*periods=\{Schedule\.periods\(.*every: "day"/);
        assert.throws(() => payload(() => ({ window: {} })),
            /Allocation: `window` is gone — the Allocation reads a day's bins through the bin kind's source of its slice, an interval index from `at` to `at`/);
    });

    test("`events` as Allocation.events: the bins are a Schedule.events kind, and what the board books from is `arrivals`", () => {
        assert.throws(() => (Allocation.events as () => never)(),
            /Allocation\.events is gone — what the board books from is arrivals=\{Allocation\.arrivals\(rows, \{ label, quantity, hold, … \}\)\}, and its `events` are its bins/);
        assert.throws(() => payload(() => ({ events: East.value([], ArrayType(StringType)) as never })),
            /Allocation: `events` holds the bins, one Schedule\.events kind — events=\{\{ bin: Schedule\.events\(.*\}\) \}\}; what the board books from is arrivals=\{Allocation\.arrivals/);
    });

    test("`lanes` and `resources` as values: the lanes' and the resources' Schedule.resources kinds", () => {
        assert.throws(() => payload(() => ({ lanes: [] })), /Allocation: `lanes` moves to `resources`: resources=\{\{ <lanes>: Schedule\.resources\(.*offset/);
        assert.throws(() => payload(() => ({ resources: East.value([], ArrayType(Allocation.Types.Resource)) as never })),
            /Allocation: `resources` holds Schedule\.resources kinds by slot — the lanes' \(the bin kind's `resource\.of`\) and the resources' \(its `parts\.of`\).* — Allocation\.resources values are gone/);
        assert.throws(() => (Allocation.lanes as () => never)(), /Allocation\.lanes is gone — the lanes are a Schedule\.resources kind under the slot the bin kind's `resource` names/);
        assert.throws(() => (Allocation.resources as () => never)(), /Allocation\.resources is gone — the resources are a Schedule\.resources kind under the slot the bin kind's `parts` name/);
    });

    test("`publish` and `quantity`: the app's days, and the quantity role's unit", () => {
        assert.throws(() => payload(() => ({ publish: false })), /Allocation: `publish` is gone — Publish is the app's own days, periods=\{Schedule\.periods\(.*leave `periods` out for no Publish/);
        assert.throws(() => payload(() => ({ quantity: { unit: "m³" } })), /Allocation: `quantity` is gone — the unit is the bin kind's `quantity` role's: .*quantity: \{ field, unit: "m³" \}/);
    });

    test("`inspector={{ bin }}`: the bin kind's own inspector", () => {
        assert.throws(() => payload(() => ({ inspector: { bin: undefined } })),
            /Allocation: `inspector` is true or false — a bin's own form is the bin kind's `inspector` \(Schedule\.events\(record, \{ …, inspector \}\)\)/);
        assert.doesNotThrow(() => payload(() => ({ inspector: true })));
    });

    test("`labels.event` and the Events tab: `labels.arrival` and the Arrivals tab", () => {
        assert.throws(() => payload(() => ({ labels: { event: "Load" } as never })), /Allocation: `labels\.event` is gone — the board's noun for what it books is `labels\.arrival`, "Arrival" by default/);
        assert.throws(() => (Allocation.library.events as () => never)(), /Allocation\.library\.events is gone — the Arrivals tab is Allocation\.library\.arrivals\(\)/);
        assert.doesNotThrow(() => payload(() => ({ labels: { arrival: "Load" }, library: [Allocation.library.arrivals(), Allocation.library.resources()] })));
    });
});

describe("the bins, the lanes and the resources", () => {
    test("`events` holds one kind, the bins", () => {
        assert.throws(() => payload((base) => ({ events: { bin: base.props.events.bin!, other: base.props.events.bin! } })),
            /Allocation: `events` holds one kind, the bins — and it holds 2 \(bin, other\)/);
        assert.throws(() => payload(() => ({ events: {} })), /Allocation: `events` holds the bins — events=\{\{ bin: Schedule\.events/);
    });

    test("`resources` holds the lanes' kind and the resources' kind, each read whole and keyed by String", () => {
        assert.throws(() => payload((base) => ({ resources: { ...base.props.resources, presses: base.props.resources.bays! } })),
            /Allocation: `resources` holds the lanes' kind \(`bays`, the slot events\.bin's resource names\) and the resources' kind \(`kilns`, the slot its parts name\) — and it holds `presses`/);
        assert.throws(() => payload((base) => ({ resources: { bays: base.props.resources.bays! } })),
            /Allocation: events\.bin's parts name the slot "kilns", and `resources` has no slot of that name \(bays\)/);
        assert.throws(() => payload((base) => ({ resources: { kilns: base.props.resources.kilns! } })),
            /Allocation: events\.bin's resource names the slot "bays", and `resources` has no slot of that name \(kilns\)/);
        assert.throws(() => payload((base) => ({ resources: { ...base.props.resources,
            kilns: Schedule.resources(Data.bindPaged(ex.kilns), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max }) } })),
        /Allocation: resources\.kilns is read whole — fits, checks and totals read every one — so give the rows as a Dict/);
        const numbered = e3.record("allocation_spec_numbered_kilns", DictType(IntegerType, Kiln), new Map());
        assert.throws(() => payload((base) => ({ resources: { ...base.props.resources,
            kilns: Schedule.resources(Data.bind(numbered).read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max }) } })),
        /Allocation: events\.bin's parts hold String keys of resources\.kilns, which is keyed by \.Integer — key the resources by String/);
        assert.throws(() => payload((base) => ({ resources: { ...base.props.resources,
            bays: Schedule.resources(Data.bindPaged(ex.yardBays), { name: "Bays", icon: "warehouse", label: b => b.name }) } })),
        /Allocation: resources\.bays is read whole — the board draws every lane, and slots and checks read every one — so give the rows as a Dict/);
    });

    test("a resources kind with no `min` or `max` accessor is refused", () => {
        const refusal = /Allocation: resources\.kilns gives each resource's `min` and `max` — Schedule\.resources\(kilns\.read\(\), \{ …, min: \(k\) => k\.min, max: \(k\) => k\.max \}\)/;
        assert.throws(() => payload((base) => ({ resources: { ...base.props.resources, kilns: kilnsKind(base, { max: (k: { max: unknown }) => k.max }) } })), refusal);
        assert.throws(() => payload((base) => ({ resources: { ...base.props.resources, kilns: kilnsKind(base, { min: (k: { min: unknown }) => k.min }) } })), refusal);
    });

    test("a bin kind that is no Allocation kind is refused: no lane, no parts, or a role it lacks, as its build names it", () => {
        const kind = (base: Base, config: object) => ({ events: { bin: Schedule.events(base.bins as never, {
            name: "Bin", icon: "box", at: "at", arrival: "load", quantity: { field: "m3" }, hold: "dryFor", ...config,
        } as never) } });
        assert.throws(() => payload((base) => kind(base, { parts: { field: "kilns", of: "kilns" } })),
            /Allocation: events\.bin books each bin into one lane — give it a `resource`, a String field naming a key of the lanes' kind/);
        assert.throws(() => payload((base) => kind(base, { resource: { field: "bay", of: "bays" } })),
            /Allocation: events\.bin allocates each bin to resources — give it `parts`, a Dict of String to Float field and the resources' slot/);
        assert.throws(() => payload((base) => kind(base, { resource: { field: "bay", of: "bays" }, parts: { field: "kilns", of: "kilns" }, arrival: undefined })),
            /Schedule\.events: "Bin": the Allocation books a bin's `arrival` — give it/);
    });

    test("a bin kind whose lane field names a kind per case, or whose slots the slice would name twice, is refused", () => {
        // A lane field with a case per kind: the board books each bin into one lane of one kind.
        const Cased = StructType({
            bay: VariantType({ north: StringType, south: StringType }), at: DateTimeType, load: OptionType(StringType), m3: FloatType,
            kilns: DictType(StringType, FloatType), dryFor: TimeStepType,
        });
        const cased = e3.record("allocation_spec_cased_bins", DictType(StringType, Cased), new Map());
        assert.throws(() => payload((base) => ({
            events: { bin: Schedule.events(Record.bind(cased, [e3.mutation.patch(cased)]), {
                name: "Bin", icon: "box", at: "at", resource: { field: "bay", of: { north: "bays", south: "yards" } }, arrival: "load",
                quantity: { field: "m3" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
            }) },
            resources: { ...base.props.resources, yards: base.props.resources.bays! },
        })), /Allocation: events\.bin books each bin into one lane — its `resource` is a String field naming a key of the lanes' kind, and this one names a kind per case \(bays, yards\)/);
        // The slice names a source after the bins' slot, the lanes', the resources' and the arrivals, each once.
        const twice = /Allocation: the slice names a source after the bins' slot \("(arrivals|bays)"\), the lanes' \("bays"\), the resources' \("kilns"\) and the arrivals/;
        assert.throws(() => payload((base) => ({ events: { arrivals: base.props.events.bin! } })), twice);
        assert.throws(() => payload((base) => ({ events: { bays: base.props.events.bin! } })), twice);
    });

    test("`arrivals` is Allocation.arrivals over the app's rows", () => {
        assert.throws(() => payload(() => ({ arrivals: East.value([], ArrayType(Allocation.Types.Arrival)) as never })),
            /Allocation: `arrivals` is Allocation\.arrivals\(rows, \{ label, quantity, hold, … \}\) over the app's rows — every arrival the day may book/);
        assert.throws(() => payload(() => ({ arrivals: undefined as never })), /Allocation: `arrivals` is Allocation\.arrivals/);
    });

    test("an arrival's `values` builds the bin kind's own fields, the ones no role maps, or it is refused naming both", () => {
        const loads = () => Data.bind(ex.arrivals).read();
        assert.doesNotThrow(() => payload(() => ({ arrivals: Allocation.arrivals(loads(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
            values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade, gradeMeasured: l.grade, instruction: l.instruction }) }) })));
        assert.throws(() => payload(() => ({ arrivals: Allocation.arrivals(loads(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
            values: l => ({ specBooked: l.spec }) }) })),
        /Allocation\.arrivals: `values` returns a booked bin's own fields, the bin kind's fields no role maps — \.Struct \[.*gradeBooked.*\] — and this one returns/);
    });
});

describe("the fit and the check, over the bins' row type", () => {
    test("`fit` is Func.bind of an e3.function from FitRequest(R) to FitResult; one bound over another row type is refused, naming both", () => {
        const Other = StructType({ grade: StringType });
        const otherFit = e3.function("allocation_spec_other_bins", East.function([Allocation.Types.FitRequest(Other)], Allocation.Types.FitResult, ($, req) => {
            const answer = $.const(Allocation.answer(Other));
            const rule = $.const(Allocation.fit);
            return answer(req, rule, "ranked");
        }));
        assert.throws(() => payload(() => ({ fit: Func.bind(otherFit) as never })),
            /Allocation: `fit` is bound over bin rows \.Struct \[.*grade.*\], and the bin kind's rows are \.Struct \[.*specBooked.*\] — bind a fit over Allocation\.Types\.FitRequest of the bins' row type/);
        const answersText = e3.function("allocation_spec_answers_text", East.function([Allocation.Types.FitRequest(KilnBin)], StringType, () => "nowhere"));
        assert.throws(() => payload(() => ({ fit: Func.bind(answersText) as never })), /Allocation: `fit` answers \.String, not Allocation\.Types\.FitResult/);
        const asksText = e3.function("allocation_spec_asks_text", East.function([StringType], Allocation.Types.FitResult, () => ({
            ask: variant("take", { resource: "K-101" }), resources: new Map(), bins: new Map(), arrivals: new Map(), reserve: none, basis: "none",
        })));
        assert.throws(() => payload(() => ({ fit: Func.bind(asksText) as never })), /Allocation: `fit` asks \.String, not Allocation\.Types\.FitRequest\(\.Struct \[/);
        const notBound = /Allocation: `fit` is Func\.bind of the app's e3\.function from Allocation\.Types\.FitRequest\(R\) to Allocation\.Types\.FitResult, R the bins' row type/;
        assert.throws(() => payload(() => ({ fit: East.value("yard_fit") as never })), notBound);
        assert.throws(() => payload(() => ({ fit: undefined as never })), notBound);
    });

    test("`check` is an East function from CheckContext(R) to Array<Issue>", () => {
        const fine = East.function([Allocation.Types.CheckContext(KilnBin)], ArrayType(Allocation.Types.Issue), () => []);
        assert.doesNotThrow(() => payload(() => ({ check: fine })));
        const otherRow = East.function([Allocation.Types.CheckContext(IntegerType)], ArrayType(Allocation.Types.Issue), () => []);
        assert.throws(() => payload(() => ({ check: otherRow as never })), /Allocation: `check` is an East function from Allocation\.Types\.CheckContext\(\.Struct \[.*\]\) to Array<Allocation\.Types\.Issue>/);
        assert.throws(() => payload(() => ({ check: East.function([StringType], ArrayType(Allocation.Types.Issue), () => []) as never })), /Allocation: `check` is an East function from Allocation\.Types\.CheckContext/);
    });
});

describe("the narrowing, the library and the columns", () => {
    const binSource = () => Data.bindPaged(ex.kilnBins, { indexes: [ex.kilnBinsByTime] });
    const baySource = () => Data.bindPaged(ex.yardBays, { indexes: [ex.yardBaysByArea] });
    const kilnSource = () => Data.bindPaged(ex.kilns, { indexes: [ex.kilnsByGroup] });
    const loadSource = () => Data.bindPaged(ex.arrivals, { indexes: [ex.arrivalsBySpec] });
    /** The bin kind given `entries`, read by key beside its source of the slice. */
    const withEntries = (base: Base) => ({ bin: Schedule.events(base.bins as never, {
        name: "Bin", icon: "box", entries: Data.bindPaged(ex.kilnBins), at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
        quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
    } as never) });

    test("`slice` is Slice.bindRecords, a source named after the bin kind's slot, the lanes', the resources' and `arrivals`", () => {
        assert.throws(() => payload(() => ({ slice: { slice: Slice.bind("spec.local", [{ name: "B-1" }], { fields: { name: { label: "Name" } } }) } as never })),
            /Allocation: `slice` is Slice\.bindRecords\(key, \{ bin, bays, kilns, arrivals \}\) — name each source after what it narrows/);
        assert.throws(() => payload(() => ({ slice: { slice: Slice.bindRecords("spec.lanes", { lanes: { source: baySource() } }) } })),
            /Allocation: `slice` narrows its bins \(bin\), its lanes \(bays\), its resources \(kilns\) and its arrivals — its source 'lanes' is none of them; name the sources `bin`, `bays`, `kilns` and `arrivals`/);
        // The bins' source reads them through their interval index; without `entries` beside it, a bin is never read by its key.
        assert.throws(() => payload(() => ({ slice: { slice: Slice.bindRecords("spec.bin", { bin: { source: binSource(), range: "at" } }) } })),
            /the builder's source "bin" reads only its narrowing — and one event, the inspector's or its editing's, is read by its key: give `entries` beside it/);
        // Each source alone, and every one together: the bins' source beside the kind's `entries`.
        for (const sources of [{ bays: { source: baySource() } }, { kilns: { source: kilnSource() } }, { arrivals: { source: loadSource() } },
            { bin: { source: binSource(), range: "at" } },
            { bin: { source: binSource(), range: "at" }, bays: { source: baySource() }, kilns: { source: kilnSource() }, arrivals: { source: loadSource() } }]) {
            assert.doesNotThrow(() => payload((base) => ({ ...("bin" in sources ? { events: withEntries(base) } : {}),
                slice: { slice: Slice.bindRecords("spec.yard", sources as never) } })), Object.keys(sources).join(", "));
        }
    });

    test("a library tab listed twice is refused, and so is a column key", () => {
        assert.throws(() => payload(() => ({ library: [Allocation.library.arrivals(), Allocation.library.arrivals()] })), /Allocation: duplicate library tab arrivals/);
        assert.throws(() => payload(() => ({ columns: [
            { key: "spec", label: "Spec", text: (b: { specBooked: never }) => b.specBooked }, { key: "spec", label: "Again", text: (b: { specMeasured: never }) => b.specMeasured },
        ] as never })), /Allocation: duplicate column spec/);
        assert.doesNotThrow(() => payload(() => ({ columns: [{ key: "spec", label: "Spec", text: (b: { specBooked: never }) => b.specBooked }] as never })));
    });

    test("`periods` is Schedule.periods over the app's days, and a library tab one of the board's two", () => {
        assert.throws(() => payload(() => ({ periods: {} as never })),
            /Allocation: `periods` is what the board publishes, the app's days — periods=\{Schedule\.periods\(Record\.bind\(days, \[daysPatch\]\), \{ every: "day", status \}\)\}/);
        assert.doesNotThrow(() => payload(() => ({ periods: Schedule.periods(Record.bind(ex.yardDays, [ex.yardDaysPatch]), {
            every: "day", status: { field: "state", draft: "draft", published: "issued" },
        }) })));
        assert.throws(() => payload(() => ({ library: [{ kind: "events" }] as never })),
            /Allocation: a library tab is Allocation\.library\.arrivals\(\) or Allocation\.library\.resources\(\) — and this one is events/);
    });

    test("table.bands and labels are refused at build, naming what is wrong", () => {
        assert.throws(() => payload(() => ({ table: { bands: [] } })), /needs at least one band, from 0/);
        assert.throws(() => payload(() => ({ table: { bands: [{ from: 6 }] } })), /first band starts at 0/);
        assert.throws(() => payload(() => ({ labels: { arrival: " " } })), /`labels\.arrival` must not be empty/);
    });
});

test("labels: the board's nouns, resolved — regular plurals and articles by default, given ones kept, what it books an Arrival, the quantity QTY", () => {
    assert.deepEqual(allocationLabels(undefined), {
        lane: { one: "Lane", other: "Lanes", article: "a" }, arrival: { one: "Arrival", other: "Arrivals", article: "an" },
        resource: { one: "Resource", other: "Resources", article: "a" }, quantity: "QTY",
    });
    assert.deepEqual(allocationLabels({ lane: "Bay", arrival: "Order", resource: { one: "Bus", other: "Buses" }, quantity: "Volume" }), {
        lane: { one: "Bay", other: "Bays", article: "a" }, arrival: { one: "Order", other: "Orders", article: "an" },
        resource: { one: "Bus", other: "Buses", article: "a" }, quantity: "Volume",
    });
    assert.deepEqual(allocationLabels({ lane: { one: "Unit", article: "a" } }).lane, { one: "Unit", other: "Units", article: "a" });
    assert.deepEqual(allocationLabels({ arrival: { one: "Delivery", other: "Deliveries" } }).arrival, { one: "Delivery", other: "Deliveries", article: "a" });
    assert.throws(() => allocationLabels({ event: "Load" } as never), /`labels\.event` is gone/);
});

test("table.bands: four by default; the app's own, from 0 and rising within the day, labelled or not; refused otherwise", () => {
    assert.deepEqual(allocationBands(undefined), [0, 6, 12, 18].map(from => ({ from, label: none })));
    assert.deepEqual(allocationBands([{ from: 0, label: "Night" }, { from: 7.5 }, { from: 18, label: "Evening" }]),
        [{ from: 0, label: some("Night") }, { from: 7.5, label: none }, { from: 18, label: some("Evening") }]);
    assert.throws(() => allocationBands([]), /needs at least one band, from 0/);
    assert.throws(() => allocationBands([{ from: 6 }]), /first band starts at 0/);
    assert.throws(() => allocationBands([{ from: 0 }, { from: 12 }, { from: 12 }]), /band 3 starts at 12, not after 12/);
    assert.throws(() => allocationBands([{ from: 0 }, { from: 24 }]), /band 2 starts at 24: a band starts within the day/);
});
