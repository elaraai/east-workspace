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
one record of cases   every kind of decision, each row a case and its verdict — waiting, as the model
                      writes it; each option's change a variant, its tag the kind of decision, its
                      value a patch of the record that kind changes
        │ read by
<DecisionQueue>       whole, or a page at a time through the rail's source, in its order; a person
                      opens a case, answers its question, modifies its change, decides
        │ writes, at Save
the case's own row    its verdict, and the option taken, the answer, the reason and the note
the changed records   on Apply, the option's patch, through each record's patch door
        │ read by
the models' next run  leaves a decided case as it is; reads an override's reason and note
```

Nothing waits for a run: an applied change lands in its builder's record at
Save, where the `<Roster>`, the `<Plan>` or the `<Sheet>` over that record
shows it as it shows any edit.

## Who owns what

| Data | Whose | What the queue does with it |
|---|---|---|
| The cases | One record of the app's: the models fill it through the app's own mutation (e3's tasks read records and never write them, so a task's output is filled into it first), and each row carries the verdict a person gives it | Reads it — whole through `Record.bind(record)`, or through the rail's `decisions` source a page at a time — and writes each verdict into its case's row through the record's patch door, the fields the verdict's roles name and no other (`DecisionQueue.decisions`) |
| The records a change lands in | The app's own, the ones its builders edit | Reads the rows a change touches to draw it against them; Apply drafts the option's patch through the target kind's own write, and Save commits it through the record's patch door |

The queue reads the cases as the Plan and the Sheet read rows. With no
`slice` it reads the record whole, in its key order. With a rail —
`Slice.bindRecords(key, { decisions: { source, … } })`, its source
`Data.bindPaged(record, { indexes })` over the same record — it reads the
narrowing a page at a time as the list scrolls, in the index's order, and
`entries: Data.bindPaged(record)` beside it reads a case by key: a case
drafted, and Save's confirmation. Either way the queue sorts nothing and caps
nothing: each case stands where its source places it, a waiting one as its
card and a decided one as its receipt, and the toolbar's count is e3's.

Which cases a rail shows is the app's own index's. It declares one on the
verdict's tag — the case's judgement — beside whatever else it narrows by:

```ts
indexes: (index) => ({
    reorders_by_judgement: index.key(East.function([StringType, Reorder], StructType({ judgement: StringType, store: StringType, range: StringType }),
        (_$, _key, r) => ({ judgement: r.verdict.getTag(), store: r.store, range: r.range }))),
}),
```

and the rail's source lists it, opening on the cases waiting (`initial: {
judgement: ["waiting"] }`). A verdict stands for its key: a run that proposes
again writes a new case under a new key.

## The roles

Every part of a card is a role, an East function over the app's row — `title:
p => p.headline`, `value: p => p.saving.subtract(p.cost)` — so the app's
record keeps its own names and shape; an option's roles read the option, its
key and its case. A record whose every row is one proposal maps the option's
roles beside the case's, with no `options`. The verdict's roles are fields of
the case's row, by name, which the queue writes: `verdict`, a variant field
whose waiting case holds Null, as the model writes it on every new case, and
whose applied, overridden, deferred and handed-off cases each hold Null or
`{ at: DateTime }`, when it was given; and optionally `option`, `answer`,
`reason` and `note`. A role left out turns off what it drives, and every field
no role names reads back as it was.

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
the verdict in the case's row — as every editing builder's gestures are:
Undo, Redo and Discard reach it. The card becomes its receipt where it stood,
whose Undo is the history's while the verdict is its last step, and the
keyboard goes to the next waiting case's head, which neither opens nor
scrolls. Save writes each record through its patch door, a request each; a
conflict, a refusal or an unknown outcome is the session's banner, with Retry
where it applies. A case the Save takes out of the rail's narrowing — an
applied one, while the rail shows the cases waiting — leaves the list, and the
Save notice says how many left the view. A case decided in another session
shows its receipt, with no Undo.

A case's question gates Apply: an answer of No blocks it, Don't know turns
Defer into Hand off. The app's own check on a row — its target's `ready` —
holds Apply in its own words while an edit leaves a row it refuses. A routine
case, its `routine` role, is marked so on its card and decided as any other.

## What the models do with it

A model's next run reads the cases' record as a task reads any record: it
leaves a decided case as it is, keeps what an override's `reason` and `note`
say the model got wrong, and reads the answers to its questions.

## What is gone

The handle (`Decision.bind`), the stored decision envelope
(`Decision.Types.Decision`, `Decision.make` and its parts), the judgement
record and the constraint contract, the facets and the lever builder, and
`<DecisionJournal>` and `<Diff>` are removed. So are the queue's own sort and
its grouping props (`groups`, `groupBy`, `collapsible`): the cases stand in
their source's order, narrowed by the app's indexes. A journal of the verdicts
is the cases' record, shown as the app shows any record of its own: a Sheet
over it, narrowed by the judgement.

## Examples

`test/decision/decision.examples.tsx`, each with its DOM test on e3 in
e3-ui-components (`src/decision/`):

- `decisionQueueMinimal` — one record of proposals, each its own one
  decision and its verdict, read whole, two kinds landing in the Sheet's work
  orders and a price list.
- `decisionQueueOps` — the full queue: a rail over the cases through the
  app's indexes on their judgement, opening on those waiting, eleven kinds of
  decision landing in every builder and in the records no builder draws.
- `decisionQueueReadOnly` — the smallest queue under `readOnly`.
- `decisionQueueRecordIndexes` — 20,000 cases read a page at a time through
  the rail's indexes, in the index's order; a case drafted and the rows a
  change touches read by key.
- `decisionQueuePhone` — the full queue in a phone-width frame.
- `decisionQueuePreviews` — a case for each preview and mark.
