/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { DictType, East, IntegerType, OptionType, PatchType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// A keyed record an editing surface saves through its patch door: the
// bindery's jobs, each under its id. `Record.toDraft` answers a batch of their
// edits as a draft of that patch (#1620): what a Save of the batch would
// commit, not committed.
export const BinderyJobType = StructType({ task: StringType, qty: IntegerType });
export const binderyJobs = e3.record("bindery_jobs", DictType(StringType, BinderyJobType), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

export const recordToDraft = example({
    keywords: ["Record", "toDraft", "draft", "pending Save", "batch", "ChangeSet", "onApply", "patch", "unsaved edits", "FuncDraftType", "not committed"],
    description: "A pending Save as a draft: Record.toDraft takes the batch Record.onApply takes and answers the patch that Save would commit as a draft of the record's patch mutation, for a function's call, with nothing committed — or the Save's refusal, or unchanged for a batch that changes nothing",
    fn: East.function([], StringType, ($) => {
        const board = $.let(Record.bind(binderyJobs));
        // The twin of `Record.onApply(board, { keyed: true })`: the same options, the same batch.
        const toDraft = $.const(Record.toDraft(board, { keyed: true }));
        // What an editing surface hands its Save: each entry's change from what it was as the edit began.
        const folded = $.const(some({ task: "Fold", qty: 200n }), OptionType(BinderyJobType));
        const refolded = $.const(some({ task: "Fold", qty: 250n }), OptionType(BinderyJobType));
        const absent = $.const(none, OptionType(BinderyJobType));
        const stitched = $.const(some({ task: "Stitch", qty: 250n }), OptionType(BinderyJobType));
        const pending = $.const({
            requestId: "", base: variant("revision", "a41c09d2"), label: "Fold and stitch 250",
            changes: [
                { id: "b1", patch: East.diff(folded, refolded), place: none },
                { id: "b2", patch: East.diff(absent, stitched), place: some(variant("keyOrder", null)) },
            ],
        }, Editing.Types.ChangeSet(BinderyJobType, StringType));
        return toDraft(pending).match({
            // The draft a bound function that lists the record takes with its call.
            draft: (_$, draft) => East.str`a draft of ${draft.record}.${draft.mutation}`,
            unchanged: _$ => East.str`nothing to send`,
            rejected: (_$, issues) => East.str`refused: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
            conflict: (_$, issues) => East.str`changed since the edit began: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
        });
    }),
    inputs: [],
    returns: "a draft of bindery_jobs.patch",
});

export const recordSaveDraft = example({
    keywords: ["Record", "onApply", "Save", "apply", "toDraft", "draft form", "struct", "$.const", "pending Save", "draft", "ChangeSet", "FuncDraftType", "not committed"],
    description: "What Record.onApply answers is the Save with its draft form, one struct: apply commits a batch, and toDraft answers the same batch as a draft of that commit, with nothing committed. A copy bound in a block keeps both, and a Sheet or a Plan handed it as its onApply takes both",
    fn: East.function([], StringType, ($) => {
        const board = $.let(Record.bind(binderyJobs));
        // One value, held in a block: a Sheet or a Plan takes it as its onApply.
        const save = $.const(Record.onApply(board, { keyed: true }));
        const folded = $.const(some({ task: "Fold", qty: 200n }), OptionType(BinderyJobType));
        const refolded = $.const(some({ task: "Fold", qty: 250n }), OptionType(BinderyJobType));
        const pending = $.const({
            requestId: "", base: variant("revision", "a41c09d2"), label: "Fold 250",
            changes: [{ id: "b1", patch: East.diff(folded, refolded), place: none }],
        }, Editing.Types.ChangeSet(BinderyJobType, StringType));
        // `save.apply(pending)` would commit the batch; `save.toDraft(pending)` answers it as a draft of that commit.
        return save.toDraft(pending).match({
            draft: (_$, draft) => East.str`a draft of ${draft.record}.${draft.mutation}, of ${East.print(draft.args.size())} argument`,
            unchanged: _$ => East.str`nothing to send`,
            rejected: (_$, issues) => East.str`refused: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
            conflict: (_$, issues) => East.str`changed since the edit began: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
        });
    }),
    inputs: [],
    returns: "a draft of bindery_jobs.patch, of 1 argument",
});

// A record whose rows hold their own key in a field: the crew, each member
// under their staff id, which the member's row carries too. `keyField` names
// that field, and a Save writes a new member's key into it.
export const CrewMemberType = StructType({ staff: StringType, name: StringType });
export const crew = e3.record("crew", DictType(StringType, CrewMemberType), {
    initial: new Map(),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

export const recordKeyField = example({
    keywords: ["Record", "onApply", "toDraft", "keyField", "key field", "rows hold their key", "new row", "newKey", "identity field", "insert", "add a row", "ChangeSet"],
    description: "A record whose rows hold their own key in a field: keyField names the field, and the Save writes a new row's key into it, whatever the batch drafted there. A new row's key is its editing session's to make, and to make again where another Save took it first, so only the Save knows the key the row is saved under",
    fn: East.function([], StringType, ($) => {
        const members = $.let(Record.bind(crew));
        // `staff` holds a member's key: `Record.onApply(members, { keyed: true, keyField: "staff" })` saves the same way.
        const toDraft = $.const(Record.toDraft(members, { keyed: true, keyField: "staff" }));
        const absent = $.const(none, OptionType(CrewMemberType));
        // A member added under the key S-1, their `staff` as the editing surface drafted it.
        const added = $.const(some({ staff: "", name: "Ada" }), OptionType(CrewMemberType));
        const pending = $.const({
            requestId: "", base: variant("revision", "a41c09d2"), label: "Add a member",
            changes: [{ id: "S-1", patch: East.diff(absent, added), place: some(variant("keyOrder", null)) }],
        }, Editing.Types.ChangeSet(CrewMemberType, StringType));
        return toDraft(pending).match({
            draft: ($, draft) => {
                // The patch that Save commits, laid over a crew of nobody.
                const patch = $.const(draft.args.get(0n).decodeBeast(PatchType(crew.type), "v2"));
                const saved = $.const(East.applyPatch(East.value(new Map(), crew.type), patch));
                return East.str`${saved.get("S-1").name} is saved under S-1 with staff ${saved.get("S-1").staff}`;
            },
            unchanged: _$ => East.str`nothing to send`,
            rejected: (_$, issues) => East.str`refused: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
            conflict: (_$, issues) => East.str`changed since the edit began: ${issues.map((_$, issue) => issue.message).stringJoin("; ")}`,
        });
    }),
    inputs: [],
    returns: "Ada is saved under S-1 with staff S-1",
});
