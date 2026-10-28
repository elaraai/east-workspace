/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The type of a binding listing a nested series index (#1435), held where it
 * is written: the build compiles this file, and each `same` below compiles
 * only while the type it names is exactly the one it says. The projection is
 * the record's row; the rail's indexes are the others; the nested part carries
 * how each collection is declared — what it holds, its times, its rollups — as
 * structure, every name a field's own; and `$.let` keeps all of it.
 */

import type { BlockBuilder, NullType, StructType, TypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import type { IndexedSource } from "@elaraai/east-ui/internal";
import { Data, type NestedPart } from "@elaraai/e3-ui/internal";
import * as ex from "./data-nested.examples.js";

/** Whether two types are the same. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/**
 * Compiles only where `A` is exactly `B`.
 *
 * @typeParam A - The type held
 * @typeParam B - The type it is said to be
 */
function same<A, B>(..._exact: Equal<A, B> extends true ? [] : [never]): void {
    // Held at compile time: nothing runs.
}

/** A binding's type arguments, from its expression. */
type Parts<S> = S extends IndexedSource<infer K, infer R, infer P, infer M, infer IK, infer N>
    ? { K: K; R: R; P: P; M: M; IK: IK; N: N } : never;

/**
 * A binding's parts, held where it is written: `partsOf(source).are<U>()`
 * compiles only where they are exactly `U`, `nested<U>()` where its nested
 * part is.
 *
 * @param _source - The binding
 * @returns Its checks
 */
const partsOf = <S,>(_source: S) => ({
    are: <U,>(..._exact: Equal<Parts<S>, U> extends true ? [] : [never]): void => undefined,
    nested: <U,>(..._exact: Equal<Parts<S>["N"], U> extends true ? [] : [never]): void => undefined,
});

/** An item's times from `start` to `end`, as a binding carries them. */
type Span = { from: StructType<{ start: NullType }>; to: StructType<{ end: NullType }> };

const machines = Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesBySiteStatus, ex.machinesInTime] });
type Machines = Parts<typeof machines>;

// A page's projection is the machine's own row type: each collection empty, never joined.
same<Machines["P"], typeof ex.NestedMachine>();
// The rail reads the index paging the machines, and no part of the nested one.
same<keyof Machines["M"]["fields"], "machines_by_site_status">();
// Each collection by its field: things dragged from their times, an alarm at its instant, values a day.
same<Machines["N"], NestedPart<StructType<{
    jobs: StructType<{ items: StructType<Span> }>;
    stops: StructType<{ items: StructType<Span> }>;
    alarms: StructType<{ items: StructType<{ at: StructType<{ at: NullType }> }> }>;
    load: StructType<{ values: NullType }>;
    output: StructType<{ values: NullType }>;
}>>>();

// A measure's readings, and the rollup its ledger keeps their subtotals by: each fold a struct of its aggregates.
partsOf(Data.bindPaged(ex.nestedLedgers, { indexes: [ex.ledgersByName, ex.ledgersInTime] })).nested<NestedPart<StructType<{
    measures: StructType<{ rows: StructType<{
        readings: StructType<{ values: StructType<{ rollup: StructType<{ sum: StructType<{ sum: NullType }> }> }> }>;
    }> }>;
}>>>();

// A part's jobs, filed under every part above it too, and the parts beneath it.
partsOf(Data.bindPaged(ex.nestedAssemblies, { indexes: [ex.assembliesByName, ex.assembliesInTime] })).nested<NestedPart<StructType<{
    parts: StructType<{ rows: StructType<{
        jobs: StructType<{ items: StructType<{ from: StructType<{ start: NullType }>; to: StructType<{ end: NullType }>; rollup: NullType }> }>;
        parts: StructType<{ recursive: NullType }>;
    }> }>;
}>>>();

/** A part of a Slice over several records: the handle of the source by its name, as its type holds it. */
type PartOf<H, Name extends string> = TypeOf<H> extends StructType<infer F>
    ? F extends { sources: StructType<infer P> } ? P extends { [K in Name]: StructType<infer Part> } ? Part : never : never : never;

/**
 * A Slice's part, held where it is written: `sliceOf(slice).carries<"rows",
 * M, N>()` compiles only where the part named carries exactly the binding's
 * index metadata `M` and nested part `N`.
 *
 * @param _slice - The Slice
 * @returns Its check
 */
const sliceOf = <H,>(_slice: H) => ({
    carries: <Name extends string, M, N>(..._exact: Equal<PartOf<H, Name>["indexes"], M> extends true
        ? Equal<PartOf<H, Name>["nested"], N> extends true ? [] : [never] : [never]): void => undefined,
});

// A Slice over the machines carries the binding's declarations on in its part's handle: a Plan reads its `rows` source's.
sliceOf(Slice.bindRecords("machines", { rows: { source: machines, fields: { site: { label: "Site" } } } }))
    .carries<"rows", Machines["M"], Machines["N"]>();

/**
 * What `$.let` keeps of a binding: every part of its type. Compiled, never
 * called.
 *
 * @param $ - A block
 */
export function heldThroughLet($: BlockBuilder<NullType>): void {
    partsOf($.let(machines)).are<Machines>();
}
