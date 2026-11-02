# Record migrations — how a record's type changes

Part of the `e3` skill.

| Form | Function | Runs as |
|---|---|---|
| `migration.value(name, fn)` | `(Old) => New`, over any record | one unit; its runner opens the state lazily |
| `migration.rows(name, fn)` | a Dict's rows, `(K, V1) => V2` with the keys kept, or an Array's elements, `(T1) => T2` | a task split over the state: a piece at a time, in parallel, each piece cached |
| `migration.rekey(name, fn)` | a Dict's entries, `(K1, V1) => { key: K2, value: V2 }`, or a Set's elements, `(T1) => T2` | the same split task, its pieces merged by key: two Dict rows landing on one key fail the deploy, naming it; two Set elements are one |

A record's steps are one chain: the list `migrations` returns, in order, each
step taking the record as the step before it leaves it, and the last leaving it
as its declared type — each checked where the record is declared.
A step's name is an identifier, unique on the record, and a workspace records the
steps it has applied by name — so moving a step's code, or re-exporting it with a
newer e3, does not run it again, and an edit to an applied step's body is not
detected. The functions are pure, synchronous East.

```typescript
const RowV1Type = StructType({ title: StringType });
const RowV2Type = StructType({ title: StringType, owner: StringType });
const plans = e3.record('plans', DictType(StringType, RowV2Type), {
  initial: new Map(),
  migrations: (migration) => [
    migration.rows('add_owner', East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: 'unassigned' }))),
    // The next version adds its step here, after this one.
  ],
});
const pkg = e3.package('planning', '2.0.0', plans);
```

What a deploy does with each record, decided before it writes anything:

| The workspace holds | Against the package's chain | The deploy |
|---|---|---|
| no state | — | mints `$init` from the initial value, the whole chain counted applied; declared with no initial value, leaves it unassigned (`unassigned`) for `e3 seed` |
| state | every step applied, the type unchanged | keeps it, with a `$deploy` commit when the package changed |
| state | a proper prefix applied | runs the rest, a `$migrate:<name>` commit each |
| state | every step applied, but the type changed | refused: a type change needs a migration, or `--schema reset` |
| state | applied steps the chain does not start with | refused, naming the steps applied and those declared |
| a record the package no longer declares | — | refused unless `--allow-drop-records` |

`--schema <policy>` on `e3 workspace deploy` and `e3 watch`: `migrate` (the
default), `fail` (run no migration; refuse) or `reset` (reset the record to its
initial value, with a `$reset` commit (`reset`); one declared with no initial
value goes back to unassigned (`unassign`), for `e3 seed` again). `--plan` prints what the deploy would do
to each record, index and input and writes nothing — from a zip or a source it
imports nothing, and a server plans only a package it holds. The steps run
before the deploy writes: a failed step leaves the workspace as it was, and a
deploy run again is served the steps that finished from the cache.

What a deploy does with each input — a dataset an `e3.input` declares, which
people set:

| The input now | Its type | The deploy |
|---|---|---|
| holds the value the deployed package gave it, or is new | — | the new package's value (`package`) |
| someone set it | — | the new package's value under `--inputs reset`, the default, and says it reset it (`reset`) |
| someone set it | the new package's | kept, under `--inputs keep-edited` (`keep`) |
| someone set it | changed | the new package's value, and says why (`reset`) |
| the deployed package took it from a file, and it holds a value | — | the new package's value under either policy, since a value set since cannot be told from the file's, and says so (`reset`) |
| the new package takes it from a file | — | its file, as every deploy does (`file`); a deploy that reads no file, a server's, leaves it unset for its client to send |
| the new package no longer declares it | — | gone, with its value (`drop`) |
