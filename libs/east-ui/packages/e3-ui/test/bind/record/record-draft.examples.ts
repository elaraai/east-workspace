/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { DictType, East, IntegerType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
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
