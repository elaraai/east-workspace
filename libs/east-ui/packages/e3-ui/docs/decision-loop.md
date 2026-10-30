# Decision loop

How a decision travels from an app's models to a person and back, with
`<DecisionQueue>` at its middle. The queue's design — its props, roles,
targets, behaviour and looks — is
[`Decision Queue Spec.md`](../../../docs/proposals/Decision%20Queue%20Spec.md);
this note is the loop around it.

## The loop

```
the app's records     duties · print jobs · machine maintenance · bins · work orders · list prices · …
                      — what the app's builders edit: <Roster>, <Plan>, <Calendar>, <Allocation>, <Sheet>
        │ read by
the app's models      its tasks: an optimiser, a forecast, a rule
        │ propose, through the app's own mutation
one record of cases   every kind of decision; each option's change a variant — its tag the kind
                      of decision, its value a patch of the record that kind changes
        │ read by
<DecisionQueue>       a person opens a case, answers its question, modifies its change, decides
        │ writes, at Save
the verdicts record   a verdict under each case's key
the changed records   on Apply, the option's patch, through each record's patch door
        │ read by
the models' next run  leaves out each case a verdict holds; reads an override's reason and note
```

Nothing waits for a run: an applied change lands in its builder's record at
Save, where the `<Roster>`, the `<Plan>` or the `<Sheet>` over that record
shows it as it shows any edit.

## Who owns what

| Data | Whose | What the queue does with it |
|---|---|---|
| The cases | The models': a record of the app's, filled by its own mutation (e3's tasks read records and never write them), or a task's output | Reads them — whole through `Data.bind`, or through the rail's `decisions` source a page at a time with `Data.bindPaged`, at most 1,000 — and never writes them (`DecisionQueue.decisions`) |
| The verdicts | The people's: the app's record, keyed by the case's key | Reads them by key through their `entries`, never whole, and writes them through their patch door (`DecisionQueue.verdicts`, `Record.bind`) |
| The records a change lands in | The app's own, the ones its builders edit | Reads the rows a change touches to draw it against them; Apply drafts the option's patch through the target kind's own write, and Save commits it through the record's patch door |

A case shows while no verdict, saved or drafted, holds its key. A verdict
stands for its key: a run that proposes again mints a new one.

## The roles

Every part of a card is a role, an East function over the app's row — `title:
p => p.headline`, `value: p => p.saving.subtract(p.cost)` — so the app's
record keeps its own names and shape; an option's roles read the option, its
key and its case. A record whose every row is one proposal maps the option's
roles beside the case's, with no `options`. The verdicts' roles are fields,
which the queue writes: `verdict` (a variant of applied, overridden, deferred
and handed off, each holding when it was given), and optionally `option`,
`answer`, `reason` and `note`; a role left out turns off what it drives.

The change role reads the option's change, a variant, and maps each tag to a
target — where that kind of decision draws:

| Target | Draws |
|---|---|
| `DecisionQueue.change.roster` | the duties, as the Roster draws them: a crop, a map by people, or `map: "cost"` by the app's own pay |
| `DecisionQueue.change.plan` | the events, as the Plan draws them: a crop of lanes, or a map of its resources |
| `DecisionQueue.change.calendar` | the events of a day, as the Calendar draws them, beside the overlaps they leave |
| `DecisionQueue.change.allocation` | the bins, as the Allocation draws them, each resource's load before → after |
| `DecisionQueue.change.sheet` | the first three changed rows, in the Sheet's columns |
| `DecisionQueue.change.record` | a record no builder draws: its changed fields, or its mix (`measure`), or its groups (`group`, counted through an index) |
| `DecisionQueue.change.zones` | areas changing zone |
| `DecisionQueue.change.projection` | each option's own series against a limit |

A builder's target takes the props of the builder's own tag — the duty kind,
the people, the shifts, the pay — the same consts handed to both, so the
preview draws the change as that builder would and Modify edits each changed
row in the builder's own inspector form.

## Deciding

Apply, Override, Defer and Hand off each draft one step of the queue's
session, across every record it writes — the change, as Modify left it, and
the verdict — as every editing builder's gestures are: Undo, Redo and Discard
reach it, and the card becomes a receipt in its place whose Undo is the
history's. The Routine band's Apply all is one step over every routine case
whose Apply is on. Save writes each record through its patch door, a request
each; a conflict, a refusal or an unknown outcome is the session's banner,
with Retry where it applies.

A case's question gates Apply: an answer of No blocks it, Don't know turns
Defer into Hand off. The app's own check on a row — its target's `ready` —
holds Apply in its own words while an edit leaves a row it refuses.

## What the models do with it

A model's next run reads the verdicts as a task reads any record: it leaves
out the cases a verdict holds, keeps what an override's `reason` and `note`
say the model got wrong, and reads the answers to its questions.

## What is gone

The handle (`Decision.bind`), the stored decision envelope
(`Decision.Types.Decision`, `Decision.make` and its parts), the judgement
record and the constraint contract, the facets and the lever builder, and
`<DecisionJournal>` and `<Diff>` are removed. A journal of the verdicts is the
verdicts record, shown as the app shows any record of its own: a Sheet over
it.

## Examples

`test/decision/decision.examples.tsx`, each with its DOM test on e3 in
e3-ui-components (`src/decision/`):

- `decisionQueueMinimal` — one record of proposals, each its own one
  decision, two kinds landing in the Sheet's work orders and a price list.
- `decisionQueueOps` — the full queue: a rail over the cases, eleven kinds of
  decision landing in every builder and in the records no builder draws.
- `decisionQueueReadOnly` — the smallest queue under `readOnly`.
- `decisionQueueRecordIndexes` — 20,000 cases read a page at a time through
  the rail's indexes, the verdicts and the rows a change touches read by key.
- `decisionQueuePhone` — the full queue in a phone-width frame.
- `decisionQueueRoutine` — the Routine band and its batch.
- `decisionQueuePreviews` — a case for each preview and mark.
