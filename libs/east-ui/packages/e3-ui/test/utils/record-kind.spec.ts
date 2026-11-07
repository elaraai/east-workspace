/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The machinery every kind over the app's record shares (`utils/record-kind.ts`), over records keyed by other types
 * than String (#1549): a bakery's steps keyed by number, and the moves between them keyed by the two steps each joins.
 *
 * - The rows a read holds, each by its key's text — an Integer's digits, a struct as East prints it — its roles
 *   hearing the key at the record's key type, through an accessor among them.
 * - A drafted row's roles, and the rows a reader read, each from its key's text.
 * - The app's check, over a drafted row and its key at its type.
 * - A card's write, at any depth of the row.
 * - The record's session: its key type on the wire, one entry read by its key's text, and Save through the patch
 *   door, which writes each change under its key at the record's key type.
 *
 * e3-ui's specs read and write no e3: each record is a handle as `Record.bind` gives one, its patch door answering
 * with the record the patch writes, printed.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, BooleanType, DictType, East, FunctionType, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, printFor, some, variant,
    type EastType, type ExprType,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { EditingReadinessType } from "@elaraai/east-ui/internal";
import { DatasetStatusType, RecordCommitInfoType } from "@elaraai/e3-types";
import { RecordBindHandleType, RecordErrorType, RecordMutateStatusType, RecordOutcomeType } from "@elaraai/e3-ui";
import { KindSideFields, accessorRole, kindWholeRows, readOf, recordSide, rowsReadOf, storedRows } from "@elaraai/e3-ui/internal";

// ============================================================================
// The bakery's records
// ============================================================================

/** A step: what its card names, and the station it stands at. */
const Step = StructType({ name: StringType, station: IntegerType });
/** A step's roles: its name, and the step after it — its key and one — which only a key at its own type gives. */
const StepRoles = StructType({ name: StringType, next: IntegerType });
const StepEntry = StructType({ roles: StepRoles, row: BlobType });
const Steps = DictType(IntegerType, Step);
/** The spec's step kind on the wire: the record's side, and its rows, its rows read and a drafted row's roles. */
const StepKind = StructType({
    ...KindSideFields,
    rows: FunctionType([], OptionType(DictType(StringType, StepEntry))),
    rowsOf: FunctionType([BlobType], DictType(StringType, StepEntry)),
    read: FunctionType([BlobType, StringType], StepRoles),
});

/** A move's key: the two steps it joins. */
const MoveKey = StructType({ from: IntegerType, to: IntegerType });
const Move = StructType({ note: StringType });
/** A move's roles: its note, and the steps it joins, each from its key. */
const MoveRoles = StructType({ note: StringType, from: IntegerType, to: IntegerType });
const MoveEntry = StructType({ roles: MoveRoles, row: BlobType });
const Moves = DictType(MoveKey, Move);
const MoveKind = StructType({
    ...KindSideFields,
    rows: FunctionType([], OptionType(DictType(StringType, MoveEntry))),
    rowsOf: FunctionType([BlobType], DictType(StringType, MoveEntry)),
    read: FunctionType([BlobType, StringType], MoveRoles),
});

const stepBytes = encodeBeast2For(Step);
const stepOf = decodeBeast2For(Step);
const stepEqual = equalFor(Step);
const stepRolesEqual = equalFor(StepRoles);
const moveBytes = encodeBeast2For(Move);
const moveRolesEqual = equalFor(MoveRoles);
const textsEqual = equalFor(ArrayType(StringType));
const readinessEqual = equalFor(EditingReadinessType);
const integerText = printFor(IntegerType);
const moveText = printFor(MoveKey);

// ============================================================================
// The kinds, built as a builder builds one and called
// ============================================================================

/** The steps, a kind over a record keyed by Integer: bound with its patch door, read whole, its accessor and check over the key. */
const steps = East.compile(East.function([], StepKind, ($) => {
    const read = $.const(East.function([], Steps, (_$2) => new SortedMap([
        [2n, { name: "Weigh", station: 1n }],
        [9n, { name: "Proof", station: 1n }],
        [10n, { name: "Mix", station: 1n }],
    ], compareFor(IntegerType))));
    const handle = $.let({
        read,
        status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
        history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
        mutate: {
            pending: East.function([], BooleanType, (_$2) => false),
            status: East.function([], RecordMutateStatusType, (_$2) => variant("idle", null)),
            error: East.function([], OptionType(RecordErrorType), (_$2) => none),
            cancel: East.function([], NullType, (_$2) => null),
            patch: East.function([PatchType(Steps)], NullType, (_$2) => null),
        },
        // The patch door: committed, the record the patch writes printed as its state — what Save sent, at its key type.
        commit: {
            patch: East.asyncFunction([StringType, PatchType(Steps)], RecordOutcomeType, (_$2, _id, patch) =>
                variant("committed", { commitHash: "c", stateHash: East.print(East.applyPatch(read(), patch)) })),
        },
        start: East.function([], NullType, (_$2) => null),
        binding: { name: "spec_steps", mutations: ["patch"] },
    }, RecordBindHandleType(Steps, { patch: [PatchType(Steps)] }));
    const bound = { form: "record", handle: handle as unknown as ExprType<EastType>, keyType: IntegerType, rowType: Step } as const;
    const next = $.const(accessorRole(IntegerType, Step, "Spec.steps", "next", IntegerType, "an Integer",
        (_row: ExprType<typeof Step>, key: ExprType<IntegerType>) => key.add(1n))!);
    const rolesOf = $.const(East.function([Step, IntegerType], StepRoles, (_$2, row, key) => ({ name: row.name, next: next(row, key) })));
    const side = recordSide(bound, undefined, undefined, {
        // The app's check over a drafted step and its key, the key a number: step 9 waits for its station.
        ready: (_row: ExprType<typeof Step>, key: ExprType<IntegerType>) => key.equal(9n).ifElse(
            () => variant("incomplete", [{ field: "station", message: "Step 9 waits for its station" }]),
            () => variant("ready", null),
        ),
    }, [], "Spec.steps");
    return {
        ...side,
        rows: storedRows(kindWholeRows(bound.handle, IntegerType, Step), IntegerType, rolesOf as never, StepEntry),
        rowsOf: rowsReadOf(IntegerType, Step, rolesOf as never, StepEntry),
        read: readOf(IntegerType, Step, rolesOf as never, StepRoles),
    } as never;
}), [])();

/** The moves, a kind over a record keyed by a struct, East's Dict over it a SortedMap in East's order. */
const moves = East.compile(East.function([], MoveKind, ($) => {
    const read = $.const(East.function([], Moves, (_$2) => new SortedMap([
        [{ from: 10n, to: 20n }, { note: "Mixed dough to proof" }],
        [{ from: 20n, to: 30n }, { note: "Proofed dough to the oven" }],
        [{ from: 30n, to: 40n }, { note: "Loaves to cool" }],
    ], compareFor(MoveKey))));
    const handle = $.let({
        read,
        status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
        history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
        mutate: {
            pending: East.function([], BooleanType, (_$2) => false),
            status: East.function([], RecordMutateStatusType, (_$2) => variant("idle", null)),
            error: East.function([], OptionType(RecordErrorType), (_$2) => none),
            cancel: East.function([], NullType, (_$2) => null),
            patch: East.function([PatchType(Moves)], NullType, (_$2) => null),
        },
        commit: {
            patch: East.asyncFunction([StringType, PatchType(Moves)], RecordOutcomeType, (_$2, _id, patch) =>
                variant("committed", { commitHash: "c", stateHash: East.print(East.applyPatch(read(), patch)) })),
        },
        start: East.function([], NullType, (_$2) => null),
        binding: { name: "spec_moves", mutations: ["patch"] },
    }, RecordBindHandleType(Moves, { patch: [PatchType(Moves)] }));
    const bound = { form: "record", handle: handle as unknown as ExprType<EastType>, keyType: MoveKey, rowType: Move } as const;
    const from = $.const(accessorRole(MoveKey, Move, "Spec.moves", "from", IntegerType, "an Integer",
        (_row: ExprType<typeof Move>, key: ExprType<typeof MoveKey>) => key.from)!);
    const rolesOf = $.const(East.function([Move, MoveKey], MoveRoles, (_$2, row, key) => ({ note: row.note, from: from(row, key), to: key.to })));
    const side = recordSide(bound, undefined, undefined, {}, [], "Spec.moves");
    return {
        ...side,
        rows: storedRows(kindWholeRows(bound.handle, MoveKey, Move), MoveKey, rolesOf as never, MoveEntry),
        rowsOf: rowsReadOf(MoveKey, Move, rolesOf as never, MoveEntry),
        read: readOf(MoveKey, Move, rolesOf as never, MoveRoles),
    } as never;
}), [])();

// ============================================================================
// The reads, the roles and the check
// ============================================================================

describe("a kind's rows travel by their keys' text, and its roles hear each key at the record's key type", () => {
    test("an Integer-keyed record's rows: by their digits, each step's next its key and one, through the accessor", () => {
        const rows = steps.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        // Text order on the wire: the renderer orders them by the key type.
        assert.ok(textsEqual([...rows.value.keys()], ["10", "2", "9"]));
        assert.ok(stepRolesEqual(rows.value.get("10")!.roles, { name: "Mix", next: 11n }));
        assert.ok(stepRolesEqual(rows.value.get("2")!.roles, { name: "Weigh", next: 3n }));
        assert.ok(stepEqual(stepOf(rows.value.get("9")!.row), { name: "Proof", station: 1n }), "the row crosses whole");
    });

    test("a struct-keyed record's rows: by their keys as East prints them, each move's ends from its key", () => {
        const rows = moves.rows();
        if (rows.type !== "some") assert.fail("a record read whole holds its rows");
        const mixToProof = moveText({ from: 10n, to: 20n });
        assert.equal(mixToProof, "(from=10, to=20)");
        assert.ok(textsEqual([...rows.value.keys()], [mixToProof, moveText({ from: 20n, to: 30n }), moveText({ from: 30n, to: 40n })]));
        assert.ok(moveRolesEqual(rows.value.get(mixToProof)!.roles, { note: "Mixed dough to proof", from: 10n, to: 20n }));
    });

    test("a drafted row's roles, and the rows a reader read, from their keys' text parsed back at the key type", () => {
        assert.ok(stepRolesEqual(steps.read(stepBytes({ name: "Shape", station: 2n }), integerText(41n)), { name: "Shape", next: 42n }));
        const read = steps.rowsOf(encodeBeast2For(ArrayType(StructType({ key: StringType, row: Step })))([{ key: "41", row: { name: "Shape", station: 2n } }]));
        assert.ok(textsEqual([...read.keys()], ["41"]));
        assert.ok(stepRolesEqual(read.get("41")!.roles, { name: "Shape", next: 42n }));

        const bakeToMix = moveText({ from: 30n, to: 10n });
        assert.ok(moveRolesEqual(moves.read(moveBytes({ note: "Back to the bench" }), bakeToMix), { note: "Back to the bench", from: 30n, to: 10n }));
        const readMoves = moves.rowsOf(encodeBeast2For(ArrayType(StructType({ key: StringType, row: Move })))([{ key: bakeToMix, row: { note: "Back to the bench" } }]));
        assert.ok(moveRolesEqual(readMoves.get(bakeToMix)!.roles, { note: "Back to the bench", from: 30n, to: 10n }));
    });

    test("the app's check hears a drafted row's key at its type: step 9 waits, step 10 is ready", () => {
        if (steps.ready.type !== "some") assert.fail("the app's check crosses");
        const [nine, ten] = steps.ready.value([
            { id: "9", entry: stepBytes({ name: "Proof", station: 1n }) },
            { id: "10", entry: stepBytes({ name: "Mix", station: 1n }) },
        ]);
        assert.ok(readinessEqual(nine!, variant("incomplete", [{ field: "station", message: "Step 9 waits for its station" }])));
        assert.ok(readinessEqual(ten!, variant("ready", null)));
    });

    test("a card's write sets a field of the row, whatever the record's key", () => {
        const set = steps.set(stepBytes({ name: "Mix", station: 1n }), [{ path: ["station"], value: encodeBeast2For(IntegerType)(3n) }]);
        if (set.type !== "some") assert.fail("station is the step's");
        assert.ok(stepEqual(stepOf(set.value), { name: "Mix", station: 3n }));
    });
});

// ============================================================================
// The record's session
// ============================================================================

describe("the record's session is at the record's key type: its read by key and its Save", () => {
    test("its key type on the wire, and one entry read by its key's text", () => {
        if (steps.editing.type !== "some" || moves.editing.type !== "some") assert.fail("bound with its patch door, each is editable");
        assert.equal(steps.editable, true);
        const stepsKey = steps.editing.value.keyType;
        const movesKey = moves.editing.value.keyType;
        if (stepsKey.type !== "some" || movesKey.type !== "some") assert.fail("a keyed record's session says its key type");
        assert.ok(isTypeEqual(fromEastTypeValue(stepsKey.value), IntegerType));
        assert.ok(isTypeEqual(fromEastTypeValue(movesKey.value), MoveKey));
        const mix = steps.editing.value.readEntry("10", 0n);
        if (mix.type !== "some") assert.fail("step 10 is held");
        assert.ok(stepEqual(stepOf(mix.value), { name: "Mix", station: 1n }));
        assert.equal(steps.editing.value.readEntry("11", 0n).type, "none", "a key the record does not hold");
        const proof = moves.editing.value.readEntry(moveText({ from: 20n, to: 30n }), 0n);
        if (proof.type !== "some") assert.fail("the move from 20 to 30 is held");
        assert.ok(equalFor(Move)(decodeBeast2For(Move)(proof.value), { note: "Proofed dough to the oven" }));
    });

    test("Save writes each change under its key at the record's key type: a new step and a moved one", async () => {
        if (steps.editing.type !== "some") assert.fail("editable");
        const apply = steps.editing.value.onApply;
        if (apply.type !== "some" || apply.value.type !== "async") assert.fail("Save goes through the patch door, awaited");
        const batch = East.compile(East.function([], BlobType, ($) => {
            const absent = $.const(none, OptionType(Step));
            const bake = $.const(some({ name: "Bake", station: 2n }), OptionType(Step));
            const proof = $.const(some({ name: "Proof", station: 1n }), OptionType(Step));
            const proofed = $.const(some({ name: "Proof", station: 3n }), OptionType(Step));
            const changes = $.const({
                requestId: "spec-steps", base: variant("revision", "r1"), label: "Add a step, and move one",
                changes: [
                    { id: "11", patch: East.diff(absent, bake), place: some(variant("keyOrder", null)) },
                    { id: "9", patch: East.diff(proof, proofed), place: none },
                ],
            }, Editing.Types.ChangeSet(Step, IntegerType));
            return East.Blob.encodeBeast(changes, "v2");
        }), [])();
        const result = await apply.value.value(batch);
        if (result.type !== "applied" || result.value.revision.type !== "some") assert.fail(`Save applies: ${result.type}`);
        assert.equal(result.value.revision.value, printFor(Steps)(new SortedMap([
            [2n, { name: "Weigh", station: 1n }],
            [9n, { name: "Proof", station: 3n }],
            [10n, { name: "Mix", station: 1n }],
            [11n, { name: "Bake", station: 2n }],
        ], compareFor(IntegerType))));
    });

    test("Save writes a struct-keyed row under its key: a move from Bake back to Mix", async () => {
        if (moves.editing.type !== "some") assert.fail("editable");
        const apply = moves.editing.value.onApply;
        if (apply.type !== "some" || apply.value.type !== "async") assert.fail("Save goes through the patch door, awaited");
        const bakeToMix = moveText({ from: 30n, to: 10n });
        const batch = East.compile(East.function([], BlobType, ($) => {
            const absent = $.const(none, OptionType(Move));
            const back = $.const(some({ note: "Back to the bench" }), OptionType(Move));
            const changes = $.const({
                requestId: "spec-moves", base: variant("revision", "r1"), label: "Connect Bake to Mix",
                changes: [{ id: bakeToMix, patch: East.diff(absent, back), place: some(variant("keyOrder", null)) }],
            }, Editing.Types.ChangeSet(Move, MoveKey));
            return East.Blob.encodeBeast(changes, "v2");
        }), [])();
        const result = await apply.value.value(batch);
        if (result.type !== "applied" || result.value.revision.type !== "some") assert.fail(`Save applies: ${result.type}`);
        assert.equal(result.value.revision.value, printFor(Moves)(new SortedMap([
            [{ from: 10n, to: 20n }, { note: "Mixed dough to proof" }],
            [{ from: 20n, to: 30n }, { note: "Proofed dough to the oven" }],
            [{ from: 30n, to: 10n }, { note: "Back to the bench" }],
            [{ from: 30n, to: 40n }, { note: "Loaves to cool" }],
        ], compareFor(MoveKey))));
    });
});
