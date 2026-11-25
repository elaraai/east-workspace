# Wire migration rule

Every value e3 persists or ships is a beast2 value of a declared East type, but
a log, which is its runner's own text. A
struct's fields encode by position, so changing a type changes its wire: bytes
written under the old type do not decode under the new one. This document says
how a change to one is made, so that no change picks its own. The beast2
container itself is governed by
[`BEAST2_WIRE_VERSION.md`](./BEAST2_WIRE_VERSION.md).

What e3 keeps and ships names the release that wrote it — a repository's
record, an execution state, a package zip — and so does a transfer request,
beside the protocol number that decides whether a server takes it. The release
is the version the release scripts write into every package, and into
e3-types' `E3_RELEASE` with them (`scripts/set-npm-version.mjs`, guarded by
`scripts/check-version-drift.mjs`).

## One rule per kind

| Kind | Examples | At a change |
|---|---|---|
| **Package-borne** — written by the SDK at export and carried in a package | task objects, package objects, function objects, record, mutation and index objects, IR bundles, environment specs and the files they name (each a Blob), and the package zip's package ref and release (each a String) | Packages are re-exported with the new SDK. A package from an older SDK fails with an error that says to re-export it. An import refuses a zip a newer release exported, naming that release. |
| **Stored state** — written by e3 as it runs and kept in a repository | datasets and their segment manifests, record states, commits and deltas, execution status, the dataflow's execution state and its events, unit plans, kept function calls, and the repository's own records: its repository record and the upgrade under way, package refs, workspace state, dataset refs, execution owners and plan pointers, the adoption memo, locks and run records | The release that changes a stored form ships a repository upgrade step, and a repository an older release wrote is upgraded in place when that release first opens it: its records keep their states and histories. A reader refuses a stored form no step carried forward, naming the release that wrote it. A repository from before repositories recorded their upgrades is re-created: deployed again, and its data imported again. |

No reader keeps a decoder for an earlier form. Readers read the current form,
as writers write it; an upgrade step carries a repository's records into it,
and every other form is an error that says what to do.

A PR that changes a wire says which kind it changes.

## Making a change

- **A struct gains or loses a field, or a variant a case:** change the type.
  Where the old bytes could decode as something else, the reader refuses them
  by what it can see, rather than misreading them.
- **A stored form changes** — a record moves, is renamed or takes another
  type, or the dataflow's execution state gains an event: the release ships a
  named upgrade step that rewrites a repository's records into the new form.
  A change to a record's East type is every backend's, and its step goes
  through the storage backend (`REPOSITORY_UPGRADES` in e3-core's
  `repository-record.ts`), a dataflow run's state through the backend's
  run-state store (`StorageBackend.runStates`); a change to one backend's own layout — a local
  repository's files, the cloud's items — is that backend's step
  (`StorageBackend.upgrades`). A step is idempotent — it leaves a record
  already in the new form as it is — and once released it is never edited,
  reordered or removed. It applies in parts, so a host whose compute has a
  time limit applies a step of any size: each part goes on from where the last
  stopped, by a cursor of the step's own, which is kept beside the repository
  record (`RefStore.repositoryUpgradeRead`). Any process takes a step up from
  its cursor, and a step a crash cut short is taken up, not started again. A
  step's cursor, like the step, never changes once released. The repository
  record, which every backend keeps through its ref store, lists the steps a
  repository has had, each with the release that applied it, once each is
  done. Every way into a repository opens it (`repositoryOpen`): the steps it
  has not had are applied, the backend's before the shared ones, in order,
  before anything reads it and with the repository held still; and a
  repository that has had a step this e3 does not know is refused, naming the
  release that applied it. One with no repository record is refused before
  anything in it is read, naming the fix. A host whose requests have a time
  limit leaves the steps to a job of its own (`repositoryOpen`'s
  `apply: false`), which applies them a part per run
  (`repositoryUpgradeStep`).
- **A new object kind names other objects:** it carries a `kind` tag, and lands
  with a GC test. GC dispatches a tagged object on its tag, through a table
  listing the field names of each kind. An object whose fields begin with the
  kind's and that carries its tag is walked for the fields this build knows, so
  a later version that appends fields stays reachable. An object without a tag
  GC recognizes by its current shape.

## Frozen wires

These cannot change without breaking every reader of the bytes they name. A
change to one is a new version of the thing, not an edit to it.

- **The beast2 container:** its magic, its frame format and its index. Readers
  refuse index flag bits they do not know, so a new flag is a new container
  version.
- **The beast2 well-known type registry:** its ids are pinned.
- **A recursive type's id:** the first 62 bits of the SHA-256 of its beast2
  type-table section, written for the type alone. IR carries it, so a change
  to its definition changes the bytes of every program holding a recursive
  type.
- **The segment manifest** (`$segments`): readers recognize it by its exact
  field set, so a changed struct is a different object to every reader.

## Changes

- **east-ui's `UIComponentType` loses its heatmap `Calendar` arm (#1144, #1146)** — package-borne. Re-export packages with the current SDK: variant case indexes after Calendar change. The record-backed calendar is e3-ui's single `<Calendar>` extension; its renderer is in e3-ui-components. The shared Schedule kind also gains the by-key event read, schedule roles and inspector/overlap fields used by Plan and Calendar. Application event, resource and template records retain their own types; no stored record migration is introduced.

Each wire changed under this rule, with the kind it is.

- **east-ui's `UIComponentType` loses its `Plan` arm (#1177, #1191)** —
  package-borne. The canvas is e3-ui's `<Plan>`, carried as the `Plan`
  extension, its payload the canvas, its event kinds and their resources. A
  variant encodes its case by its index among its
  cases, which are sorted by name, so every case after `Plan` moves down one,
  and a UI value encoded under either type does not decode under the other.
  A UI task carries the type in its IR and in what it outputs, so packages are
  re-exported, and the dataflow computes each UI task's output again under the
  new type.
- **east-ui's `UIComponentType` loses its `Sheet` arm (#1179, #1216)** —
  package-borne. The spreadsheet is e3-ui's `<Sheet>`, carried as the `Sheet`
  extension, its payload the sheet and its panes. As with the Plan's arm,
  every case after `Sheet` moves down one, so a UI value encoded under either
  type does not decode under the other: packages are re-exported, and the
  dataflow computes each UI task's output again under the new type.
- **east-ui's `UIComponentType`'s `EmptyState` arm loses its `glyph` (#1263)**
  — package-borne. An empty state's one mark is its `icon`, a Font Awesome
  solid icon, and `EmptyState`'s text `glyph` is refused at build. The arm's
  fields after `glyph` move up one, so a UI value encoded under either type
  does not decode under the other: packages are re-exported, and the dataflow
  computes each UI task's output again under the new type. A UI task's output
  is not stored state, so no repository upgrade step ships with it.
- **east-ui's `IconType` style `variant` keeps only `solid` (#1263)** —
  package-borne. East UI draws Font Awesome's solid set only: an icon's
  `prefix` stays a String, which a factory refuses at build when it is not
  `"fas"`, naming the icon, and `IconVariantType` loses its `brands`, `light`,
  `regular` and `thin` cases. `solid` moves from the fourth case to the first,
  so an icon's style that names its variant under either type does not decode
  under the other: packages are re-exported, and the dataflow computes each UI
  task's output again under the new type. As with the EmptyState's glyph, no
  repository upgrade step ships with it.

- **east-ui's `UIComponentType` loses its `Board` and `Roster` arms (#1162, #1174)** — package-borne. Re-export packages and recompute UI task outputs: the sorted variant case indexes change. Staffing now uses e3-ui's `Roster` extension. Its new `Roster.Types.Weeks` is an application record type; this change does not rewrite an existing backend record or introduce a repository upgrade step. Applications adopting it declare and seed their own weeks record.
- **east-ui's `UIComponentType` loses its `Flowchart` arm (#1243, #1244)** —
  package-borne. The flowchart is e3-ui's `<Flowchart>`, carried as the
  `Flowchart` extension, its payload its canvas, where its flows come from — a
  record of flows or the host's — and its panes. As with the Plan's and the
  Sheet's arms, every case after `Flowchart` moves down one, so a UI value
  encoded under either type does not decode under the other: packages are
  re-exported, and the dataflow computes each UI task's output again under the
  new type.
- **e3-types' `LockOperationType` gains `workspace_copy` (#1224)** — stored
  state: a lock's record names the operation that took it, and a workspace's
  copy takes both its locks as one. The case is named to sort after every case
  before it, so its tag is the last: a lock an earlier release wrote reads as
  itself, since a header whose variant holds the first cases of the asked
  type's reads as it, and no upgrade step is shipped. An earlier release
  refuses a copy's lock, naming both types, as it refuses any form it does not
  read.
- **east-ui's `UIComponentType` loses its `App`, `Pages` and `Route` arms
  (#1227)** — package-borne. An app's navigation is its host's; a page's own
  is its `Breadcrumb` and `NavList`, which stay. `App` sorts third among the
  cases, so nearly every case moves down, by one, two or three, and a UI value
  encoded under either type does not decode under the other: packages are
  re-exported, and the dataflow computes each UI task's output again under the
  new type. Until a package is re-exported, a reader that decodes its UI
  outputs against the type the package declares, as `UITaskPreview` does,
  still reads them, and one holding `App`, `Pages` or `Route` fails as it
  renders: the `nav_*` platform functions they call are gone.
- **e3-types' `RecordPlanType` gains `unassigned` and `unassign`, and the run
  summaries `waiting` (#1363)** — stored state, while a deploy runs. A record
  plan is a deploy's answer for a record declared with no initial value:
  `unassigned` for one the workspace does not hold, which the deploy leaves
  unassigned for its first state to be committed, and `unassign` for one the
  `reset` policy sends back to unassigned, having no initial value to reset it
  to. A deploy also reports its plans through the lock it holds, for a watcher
  to read (`LockProgressType`'s `deployment`: a `DeployProgressType` whose
  records are `RecordDeployStateType`, each naming its plan), and a server's
  deploy job carries them in its status (`WorkspaceDeployStatusType`), so a
  lock store keeps a plan for as long as a deploy runs. Both cases are named
  to sort after every case before them, so their tags are the last: a plan an
  earlier release wrote reads as itself, since a header whose variant holds
  the first cases of the asked type's reads as it, and no upgrade step is
  shipped; an earlier release refuses one this release wrote, naming both
  types, as it refuses any form it does not read. A package may now carry a
  record whose ref is `unassigned` — package-borne, with no type changed: a
  release before this one deploys such a package with the record declared and
  never minted, so a package declaring a record with no initial value is
  deployed by this release or later. A run leaves a task whose input is
  unassigned waiting, and its dependents with it, rather than fail: a task
  status, `waiting`, which the execution state holds as a string, so its form
  does not change, and no event, since a run's events are stored. The run
  summaries gain `waiting` — e3-types' `ExecutionStateSummaryType`, which a
  store derives from the task statuses, and the API's
  `DataflowExecutionSummaryType` and `DataflowResultType` — which no store
  keeps in those types' forms, so no upgrade step is shipped.
- **e3-types' `ApiExecutionStatusType` gains `stopping` (#1286)** — neither
  package-borne nor stored: the dataflow poll's answer, for a run asked to stop
  that has not yet stopped. The case is named to sort after every case before
  it, so its tag is the last: a client reads a poll a server of an earlier
  release answers, since a header whose variant holds the first cases of the
  asked type's reads as it, and a client of an earlier release refuses a poll
  this release answers, naming both types, as it refuses any type it does not
  read. The run summary a state store answers (`ExecutionStateSummaryType`)
  gains `cancelRequested`, which no store keeps in that type's form, so no
  upgrade step is shipped.
- **e3-ui's `Roster` narrows through `Slice.bindRecords` alone (#1340,
  #1342)** — package-borne. The `Roster` extension's payload loses
  `visiblePeople`, `visibleSource`, `recordSlice` and `duties`. Its `slice` is
  the chrome of a Slice over several records, each source's keys in a new
  `narrowed`, and its new `activities` lists every activity; an app's library
  tab (`RosterAuthorTabType`) gains the `source` it follows. `Roster.Types.Group`
  loses `skills`, `Roster.Types.Skill` gains `group`, and `Roster.Types.Context`
  trades `duties` for `activities`. A UI value encoded under either type does
  not decode under the other: packages are re-exported, and the dataflow
  computes each UI task's output again under the new type. A UI task's output is
  not stored state, so no repository upgrade step ships with it. An
  application's own record that holds `Roster.Types.Group` or
  `Roster.Types.Skill` values — a configuration's groups, or its duties —
  changes type with it; moving its skills and duties into an activities record
  is that record's own migration, as with any record whose type an application
  changes.
- **e3-ui's `Calendar` narrows through `Slice.bindRecords` alone (#1340,
  #1343)** — package-borne. The `Calendar` extension's payload loses its local
  `slice` and its `recordSlice`: its `slice` is the chrome of a Slice over
  several records — a source per event kind, resource kind and templates record
  it narrows — and each source's keys are in a new `narrowed`. The Schedule
  kinds it carries (`ScheduleKindType`, and with it the Plan's
  `PlanEventKindType`) gain `templatesSource`, the source a templates list
  names, and their backlog reads (`unscheduled`, `planUnscheduled`) take the
  window the canvas reads, `(from, to, drafts)`; an app's library tab
  (`ScheduleAuthorTabType`) gains the `source` it follows. A UI value encoded
  under either type does not decode under the other: packages are re-exported,
  and the dataflow computes each UI task's output again under the new type. A
  UI task's output is not stored state, so no repository upgrade step ships
  with it. A Calendar's templates written in the code become a templates record
  of the application's own, as with any record an application declares.
- **e3-ui's `Plan` narrows through `Slice.bindRecords` alone, its templates
  records (#1340, #1344)** — package-borne. The `Plan` extension's payload
  gains `narrowed`, each source's keys by its name; its canvas's `slice`
  (`PlanRootType`) becomes the chrome of a Slice over several records, and the
  canvas loses `recordSlice`. The resources' rows seam (`PlanEventBlocksType`)
  takes the resources the rail shows, by resource kind, after the ids the
  viewer hides. A UI value encoded under either type does not decode under the
  other: packages are re-exported, and the dataflow computes each UI task's
  output again under the new type. A UI task's output is not stored state, so
  no repository upgrade step ships with it. A Plan's templates written in the
  code become a templates record of the application's own, as with any record
  an application declares.
- **e3-ui's `Sheet` narrows through `Slice.bindRecords` alone, its
  templates records (#1340, #1345)** — package-borne. The `Sheet` extension's
  payload gains `narrowed`, each source's keys by its name; its root's `slice`
  becomes the chrome of a Slice over several records, and it loses
  `recordSlice`, `recordViews` and `onRecordViewsChange`. `Sheet.Types.View`
  goes: `views` holds `Sheet.Types.RecordView`, whose `narrowing` is every
  source's state by the source's name. A template on the wire
  (`SheetTemplateWireType`) gains the `source` its list follows, and an app's
  library tab (`SheetLibraryTabType`'s `tab`) gains the `source` it follows. A
  UI value encoded under either type does not decode under the other: packages
  are re-exported, and the dataflow computes each UI task's output again under
  the new type. A UI task's output is not stored state, so no repository
  upgrade step ships with it. An application's own record of saved views
  (`Array<Sheet.Types.View>` in a dataset a `Data.bind` shares) changes type
  with it; rewriting those views as `Sheet.Types.RecordView` is that record's
  own migration, as with any record whose type an application changes.
- **e3-ui's `Flowchart` narrows through `Slice.bindRecords` alone, its
  templates records (#1340, #1346)** — package-borne. The `Flowchart`
  extension's payload gains `slice`, the chrome of a Slice over several
  records — the `flows` source a record's Flows tab pages, and a source per
  templates list or tab that names one — and `narrowed`, each source's keys by
  its name; its `canvas` loses the local `slice` the host's tables were
  narrowed by. The paged arm of its `source` loses `chrome`, the one record's
  rail, and gains `search`, a page of the narrowing the Flows tab's own search
  finds. A library tab on the wire (`FlowchartLibraryTabType`) gains the
  `source` it follows: a templates list's, always; an app's tab's, when it
  names one. A UI value encoded under either type does not decode under the
  other: packages are re-exported, and the dataflow computes each UI task's
  output again under the new type. A UI task's output is not stored state, so
  no repository upgrade step ships with it. A Flowchart's templates written in
  the code, or held in an input, become a templates record of the
  application's own, keyed by each template's key, as with any record an
  application declares.
- **east-ui's `RowSourceType` gains `live`, and a record Slice's narrowed
  `data` names its narrowing (#1340, #1354)** — package-borne. A rail's
  narrowed source — a record Slice handle's `data`, `Slice.rows(slice,
  source)` — is one source per binding whatever the narrowing: its reads read
  the narrowing when they run, its `id` names the source alone, and it gains
  `query`, the narrowing it serves, printed (`Paged.Types.LiveSource`). A
  builder over it is not built again when a choice changes. `RowSourceType`
  gains the `live` arm that carries it; `live` sorts after `inline`, so `paged`
  and `pinned` move down one, and a UI value encoded under either type does not
  decode under the other. The record Slice's operations lose
  `slice_record_page`, `slice_record_seek` and `slice_record_data_count`, which
  took the narrowing as an argument, for `slice_record_data_page`,
  `slice_record_data_seek` and `slice_record_data_query`, which read it.
  Packages are re-exported, and the dataflow computes each UI task's output
  again under the new type. A UI task's output is not stored state, so no
  repository upgrade step ships with it.
- **e3-ui's `Roster` asks the app's fit (#1319, #1334)** — package-borne. The
  `Roster` extension's payload gains `fit`, after `check`: the binding of the
  app's `e3.function` a Find fix asks who fits (`Option<FuncBinding>`), none
  when the Roster offers no Find. A fix's `find` names its need as
  `Roster.Types.Need`, which holds the same cases as before, so a fix encodes
  as it did. A UI value encoded under either payload type does not decode
  under the other: packages are re-exported, and the dataflow computes each UI
  task's output again under the new type. A UI task's output is not stored
  state, so no repository upgrade step ships with it.
- **e3-ui's `Roster` takes the app's own records through Schedule's kinds
  (#1365, #1368, #1369)** — package-borne. The `Roster` extension's payload
  trades `sourceId`, and the `read`, `apply` and `window` over
  `Roster.Types.Weeks`, for its duty kind (`duty`, Schedule's Roster kind over
  the app's duty rows), its periods (`periods`, what `Schedule.periods`
  builds) and its targets (`targets`), each closed over beast2 bytes as
  Schedule's kinds are, so the payload is one type whatever the app's rows
  hold. It trades `forecast` for `targets`, `costs` for `pay` and `currency`,
  and its `inspector`'s forms for a Boolean: a duty's own form is its kind's
  `inspector`, a target's `Roster.targets`'. Its `check` takes its request as
  bytes, and an app's library tab is Schedule's (`ScheduleAuthorTabType`).
  `Roster.Types.Weeks` and `Roster.Types.Costs` are removed. The types over a
  week become constructors of the app's duty row type — `Assignment(R)`,
  `Week(R)`, `CheckContext(R)`, `FitRequest(R)` and the new `PayRequest(R)` —
  each assignment carrying the duty's own row and losing `offset`, `overtime`
  and `agreed`. `Status` is Schedule's period status, `Rules` loses `agree`,
  `Context` loses `costs`, `Coverage`'s hours lose `overtime`, `Issue`'s kind
  loses `agree`, `Fix` loses `agree` and its `start` names the later start's
  time rather than its hours, and `Proposal` names its `day`, `group` and
  `shift` in place of its week and slot. A UI value encoded under either type
  does not decode under the other: packages are re-exported, and the dataflow
  computes each UI task's output again under the new type. A UI task's output
  is not stored state, so no repository upgrade step ships with it. An
  application's weeks record (`Roster.Types.Weeks`, #1174) and its forecast
  and proposals records hold types that are removed or changed; moving them
  into the application's own records — its duties, the weeks of its rota and
  its targets — is those records' own migration, as with any record whose type
  an application changes.
- **Schedule's kinds take the Roster's and the Allocation's roles (#1365,
  #1367)** — package-borne. `Schedule.events` takes the builders' roles, and a
  kind builds two closed forms beside the Calendar's and Plan's —
  `ScheduleRosterKindType` and `ScheduleAllocationKindType` — which the
  Roster's and the Allocation's payloads carry, beside the closed periods of
  the new `Schedule.periods` (`SchedulePeriodsKindType`). The Calendar's and
  Plan's kinds on the wire (`ScheduleKindType`, `PlanEventKindType`) are
  unchanged. The Allocation's extension, which takes them too, is new in this
  release: no earlier release wrote it, so no form of it moves.
- **east-ui's `UIComponentType` loses its `Schematic` arm, and the schematic
  draws the app's records (#1384, #1386)** — package-borne. The schematic is
  e3-ui's `<Schematic>`, carried as the `Schematic` extension. Its payload is
  not the root the arm carried, the host's rows mapped to items, zones, links
  and nets: it carries a kind over the app's record for each
  (`SchematicItemKindType`, `SchematicZoneKindType`, `SchematicLinkKindType`,
  `SchematicNetKindType`), each closed over beast2 bytes as Schedule's kinds
  are, so the payload is one type whatever the app's rows hold; its layers;
  the chrome of a Slice over several records (`slice`) and each source's keys
  (`shown`); how a row the narrowing leaves out draws (`narrowed`); and its
  library's tabs. A prop the root took that the payload does not is refused at
  build, naming what replaces it. As with the Plan's, the Sheet's and the
  Flowchart's arms, every case after `Schematic` moves down one, so a UI value
  encoded under either type does not decode under the other: packages are
  re-exported, and the dataflow computes each UI task's output again under the
  new type. A UI task's output is not stored state, so no repository upgrade
  step ships with it.
- **e3 gains the area index, and the interval index a constructor of its own
  (#1385)** — package-borne, and no wire changes. `e3.recordIndex.area` builds
  an index object as every index's is: its key function, which the SDK
  generates as it generates an interval index's, and its projection, the whole
  row. A deploy builds an index its state lacks, so no upgrade step ships.
  `e3.recordIndex.interval` builds the object the `interval` option built, so
  no interval index changes form, and a package already exported deploys as it
  did; `e3.recordIndex` now refuses the option, naming the constructor, so a
  package's source that wrote it moves to the constructor before its next
  export.
- **east-ui's record Slice gains the `window` choice and the `area` index
  metadata (#1385)** — package-borne, and an application's saved views change
  type with it. `RecordSliceIndexType` gains `area` after `interval`, built
  only from a package's declarations, and `RecordSliceChoiceType` gains
  `window`, which a read gives an area index's `__area` and a rail never holds.
  A UI value encoded under either type does not decode under the other:
  packages are re-exported, and the dataflow computes each UI task's output
  again under the new type. A UI task's output is not stored state, so no
  repository upgrade step ships with it. `window` is named to sort after every
  case before it, so its tag is the last and theirs are kept — but a narrowing
  is a `Dict` of choices, and beast2 reads a collection's elements as exactly
  the asked type (east's `checkDecodeType`): a variant there holds every case
  of the asked type or does not read. So a narrowing an earlier release wrote
  does not decode under the new type. One a browser kept for a rail
  (`enableSlicePersistence`) is set aside, and the rail starts from its slice's
  `initial`. An application's own record of saved views
  (`Array<Sheet.Types.RecordView>`, whose `narrowing` is each source's state)
  changes type with it: a deploy resets an input that holds them to its
  package's value, since its type changed, and refuses a record that holds them
  until the record declares the migration that carries them across, as with any
  record whose type an application changes.
- **e3-ui's `Schematic` takes the Plan's props, and its layers and shapes from
  the app's rows (#1401)** — package-borne. The `Schematic` extension's
  payload trades `name` for `id`; its `inspector` is off unless given, a
  kind's own Details being its kind's `inspector`, which the kinds' wire
  already carried; it loses `selectZoomFocus` and the five callbacks —
  `onSelectionChange`, `onZoneSelectionChange`, `onSelectLink`,
  `onViewportChange` and `onItemOpen` — and gains `onSelect`, the whole
  selection as an `Array<Schematic.Types.Ref>`; and its `canConnect` takes a
  `Schematic.Types.Candidate`, `{ kind, from, to }`, and answers an
  `Option<String>`, where it took two references and answered a Boolean.
  `Schematic.Types.Layer` gains `color`, after `tone`, and the library's tabs
  on the wire (`SchematicLibraryTabType`) trade `templates` and `unplaced`,
  each naming a slot, for `templates` and `backlog`, each over every kind and
  holding `Null`. The selection, zone selection and viewport event types are
  removed. A UI value encoded under either type does not decode under the
  other: packages are re-exported, and the dataflow computes each UI task's
  output again under the new type. A UI task's output is not stored state, so
  no repository upgrade step ships with it. An application's record whose rows
  held a `Schematic.Types.Geometry` for a footprint or a zone's shape keeps
  its own fields instead — a radius, an outline's corners — from which an
  accessor makes the shape; rewriting its rows is that record's own migration,
  as with any record whose type an application changes.
- **e3-ui's `Sheet` draws its `rows` source's narrowing over the record's rows
  as the lens (#1349)** — package-borne, and an application's saved views
  change type with it. A sheet over the rows of its slice's `rows` source takes
  that source's record, every row in the record's order — a `pinned` arm over
  the record's own rows — where it took the narrowing's rows in a `live` arm,
  and draws the narrowing over them, placed by e3 from the source's index.
  `Sheet.Types.RecordView`'s `reveals` holds the runs of rows the planner
  opened by their first and last rows' keys (`Sheet.Types.Reveal`), where it
  held row positions. A UI value encoded under either type does not decode
  under the other: packages are re-exported, and the dataflow computes each UI
  task's output again under the new type. A UI task's output is not stored
  state, so no repository upgrade step ships with it. An application's own
  record of saved views (`Array<Sheet.Types.RecordView>`) changes type with
  it, as with `window` above: a deploy resets an input that holds them to its
  package's value, and refuses a record that holds them until the record
  declares the migration that carries them across.
- **e3 gains the series and summary indexes: an index object gains `form`, and
  a record's describe each index's `summary` (#1039)** — package-borne, and the
  describe route's answer. `RecordIndexObjectType` gains `form`, after
  `runner`: `entries` for an index as every package declared one before, or
  `summary`, naming the IR of the merge a summary's build sums its pieces by.
  An index object an earlier SDK exported does not decode under the new type:
  a read through it, or a reindex, is refused, naming the fix — re-export the
  package — and gc, which knows an index object by its current shape, no
  longer walks it, so the programs only it names are swept. A deploy of the
  re-exported package builds each index under its new object, so no upgrade
  step ships, and a record's state, its commits and its deltas keep their
  forms: a summary's arm of a delta (`RecordSummaryOpType`'s `add`) and its
  collection, `Dict<{ik, k: Null}, RecordSummaryTotals>`, are new, and no
  earlier release wrote either. `e3.recordIndex.series` builds an index object
  as the area index's does: its key function, which the SDK generates — an
  entry per time tile an event touches — and its projection, the whole row.
  The describe route's index entries (`RecordSignatureType`) gain `summary`,
  after `multi`, which tells a client to decode a summary's window with its
  `key` Null and never to join it: an answer of either release does not decode
  as the other's, and a client refuses an earlier server's answer, naming both
  types, as it refuses any type it does not read.
- **east-ui's record Slice gains the `series` and `summary` index metadata
  (#1039)** — package-borne. `RecordSliceIndexType` gains `series` and
  `summary`, after `area`: how a series or a summary index files a record's
  events (`RecordSliceTilingType` — its key field, its start and end fields,
  and its tile, `RecordSliceTileType`), built only from a package's
  declarations, which a binding marks a series or a summary index's `__tile`
  with, as it marks an area index's `__area`. Neither index serves the rail's
  narrowing, so `RecordSliceChoiceType` and `RecordSliceStateType` keep their
  forms, and no narrowing, kept or saved, changes type. A UI value encoded
  under either index type does not decode under the other: packages are
  re-exported, and the dataflow computes each UI task's output again under the
  new type. A UI task's output is not stored state, so no repository upgrade
  step ships with it.
- **e3-ui's `Sheet` lens draws only the rows its narrowing keeps:
  `Sheet.Types.RecordView` loses `context` and `reveals`, and
  `Sheet.Types.Reveal` goes** — package-borne, and an application's saved
  views change type with it. Under its `rows` source's narrowing a sheet draws
  only the record's rows the narrowing keeps, one after another, each at its
  row number — no rows beside them, no gaps and no runs opened — so a saved
  view holds every source's narrowing and its folds, and nothing of the lens.
  A UI value encoded under either type does not decode under the other:
  packages are re-exported, and the dataflow computes each UI task's output
  again under the new type. A UI task's output is not stored state, so no
  repository upgrade step ships with it. An application's own record of saved
  views (`Array<Sheet.Types.RecordView>`) changes type with it, as with the
  lens's first form above: a deploy resets an input that holds them to its
  package's value, and refuses a record that holds them until the record
  declares the migration that carries them across.
- **e3-ui's `Roster` gains the People layout's month, the app's week patterns
  and the shifts' colours (#1406)** — package-borne. The `Roster` extension's
  payload gains `patterns`, the app's week patterns (`Roster.Types.Pattern`:
  its `key`, its `label` and seven `Option<String>` `days` from the week's
  first day), and its `narrowed` keys a `patterns` source; its library's tabs
  on the wire (`RosterLibraryTabType`) gain `patterns`, holding the tab's
  `name` and `icon`; its settings gain `tileTimes` (`always` or `different`)
  and `letters`, and their `period` gains `month`, which sorts between `day`
  and `week`, so `week` moves down one; and each shift (`Roster.Types.Shift`)
  gains `color`, an `Option<ColorToken>`. east-ui gains `ColorTokenType` and
  `ColorShadeType`, public beside `ColorSchemeType`: a variant of the theme's
  hues, each holding a variant of its shades, `Style.ColorToken("teal",
  "500")` building one, for every component that takes a colour from here
  on. A UI value encoded under either type does not decode under the other:
  packages are re-exported, and the dataflow computes each UI task's output
  again under the new type. A UI task's output is not stored state, so no
  repository upgrade step ships with it. An application's record of shift
  times gains a colour field of its own, which `Roster.shifts`' `color`
  accessor reads the token from, and one of week patterns is a record of its
  own; adding either is that record's own migration, as with any record whose
  type an application changes. The Roster's persisted view — viewer state, a
  browser's own — gains a period per layout; a view kept under the old shape
  reads as the defaults.
- **e3-ui's five collection builders take the app's optimiser, and east-ui's
  editing origin gains `optimise` (#1409, #1411)** — package-borne. The
  `Roster`, `Calendar`, `Sheet`, `Plan` and `Allocation` extensions' payloads
  each gain `optimise`, the binding of the app's `e3.function` the Elara eye
  calls over the period in view (`Option<FuncBinding>`), `none` for a builder
  with no eye: after `fit` on the Roster's and the Allocation's, after
  `canDrop` on the Calendar's and the Plan's, after `inspector` on the
  Sheet's. The Calendar's and the Plan's resource kinds on the wire
  (`ScheduleResourcesType`, `PlanResourcesType`) each gain `keyType`,
  `rowType` and `records`, after their last field: the kind's key and row
  types, and its records read whole as bytes at `DictType(K, R)` when a run
  starts (`Option<() => Blob>`, `none` for a kind paged a window at a time) —
  what the run's request carries of the kind beside the events, as context.
  The Sheet's editing declaration on the wire (`SheetEditingType`) gains
  `project`, after `decode`: an entry as `entryType` bytes and its id to the
  wire row the source would show for it (`Sheet.Types.Row` bytes) — what a
  row the optimiser answers lands in the session as.
  east-ui's `EditingOriginType` gains the case `optimise`, a run's
  result recorded as one step of the session: it sorts between `move` and
  `pasted`, so every case after it moves down one, and it travels in the patch
  event (`EditingPatchEventTypeWith`) an app's patch observer reads at the
  same package version. A UI value encoded under either type does not decode
  under the other: packages are re-exported, and the dataflow computes each UI
  task's output again under the new type. A UI task's output is not stored
  state, so no repository upgrade step ships with it. The request and result
  types each builder's `Types` constructs (`OptimiseRequest`, `OptimiseResult`)
  are new, and an app's optimiser is an `e3.function` of its own package: no
  earlier release wrote either, so no form of them moves.
- **e3-ui's `Plan` blocks say what each entry makes of chart rows (#1398)** —
  package-borne. `Plan.Types.Block` gains `charts`, after `parent`: how many
  chart rows each of the block's entries makes, where every entry makes as
  many (`Option<Integer>`), `none` where that varies by entry — a `match` on a
  series that makes one, children whose rows hold one — and for a fixed
  block, which no entry makes. The narrow layout's Measures tab counts a paged
  source by it. It travels in the `Plan` extension's payload — the canvas's
  rows, a paged source's windows, the event kinds' blocks and a paged resource
  kind's — and `rows` moves down one after it, so a UI value encoded under
  either type does not decode under the other: packages are re-exported, and
  the dataflow computes each UI task's output again under the new type. A UI
  task's output is not stored state, so no repository upgrade step ships with
  it.
- **e3-ui's `Plan` event kinds read every event's row at once (#1409, R24)** —
  package-borne. The Plan's event kind on the wire (`PlanEventKindType`) gains
  `planRows`, after `planEvent`: its events' rows over a window and its
  backlog's beside them, by key, the drafts in place, as beast2 of the
  record's own `DictType(K, R)` — what a run's request finds each event's row
  in, read once a kind rather than once an event. It travels in the `Plan`
  extension's payload, and `inspector` moves down one after it, so a UI value
  encoded under either type does not decode under the other: packages are
  re-exported, and the dataflow computes each UI task's output again under the
  new type. A UI task's output is not stored state, so no repository upgrade
  step ships with it.
- **e3-ui's `Plan` reads its rows' collections by name, and a table's values
  take typed numbers (#1436)** — package-borne. `Plan.Types.Drop` gains `id`,
  after its other fields: the new item's id, which the renderer mints as the
  card lands and the series puts the item into its collection under.
  `Plan.Types.Gesture` gains the case `value` (`Plan.Types.ValueEdit`: the
  row, the table position, the bucket's start and the number typed, or `none`
  for a cleared cell), which sorts after `drop` and `move`, so their tags are
  kept. `Plan.Types.RowEdits` gains `values`, after `move`: the table
  positions whose values take a typed number. Each travels in the `Plan`
  extension's payload — a drop, a row's edits, and each editable series'
  write, which takes the gesture — so a UI value encoded under either type
  does not decode under the other: packages are re-exported, and the
  dataflow computes each UI task's output again under the new type. A UI
  task's output is not stored state, so no repository upgrade step ships with
  it.
- **e3's generated index keys nest the row's fields under `on`, e3's parts
  beside them (#1432)** — package-borne. An interval index's key is
  `{ on, node, at }`, an area index's `{ on, area }`, and a series or a
  summary index's `{ on, tile, key }`: `on` the declaration's leading fields at
  their key types, a struct with no fields when it lists none, where today's
  keys held them flat beside `__interval`, `__area` and `__tile`. No name is
  reserved, so `e3.recordIndex.area` no longer refuses a row field named
  `__area`, nor `.series` and `.summary` one named `__tile`. A definition's
  `on` is the leading fields alone. Each such index a package declares changes
  type, so it is rebuilt as the package is deployed, as any changed index is;
  an index is derived from its record, so no repository upgrade step ships.
- **east-ui's record Slice reads by area beside the narrowing, and a binding's
  index metadata names each index's kind (#1432)** — package-borne, and an
  application's saved views change type with it. `RecordSliceChoiceType` loses
  `window`: a read by area gives its clause apart, `RecordSliceAreaType`
  (`window` or `unplaced`), in `RecordSliceReadType` (`{ where, area }`), which
  `pageWhere`, `countWhere` and the scan take; the rail's state, its presets
  and `contains` keep the narrowing alone. `RecordSliceIndexType.fields` holds
  an index's row fields alone — a generated index's `on` — and the binding's
  metadata (`IndexedSourceType`'s `indexes`) gives each index as
  `{ fields, kind }`, `kind` its one case, `plain` or a generated kind's
  marker. A UI value encoded under either type does not decode under the
  other: packages are re-exported, and the dataflow computes each UI task's
  output again under the new type. A narrowing is a `Dict` of choices, read at
  exactly the type it was written with, so one kept or saved under the earlier
  type does not decode, and resets. A UI task's output is not stored state, so
  no repository upgrade step ships with it.
- **e3's series and summary indexes put the key first, and a series index
  files each event once, at the level its length fits (#1433)** —
  package-borne. A series index's key is `{ on, key, level, tile }`: each
  event filed once, at the finest level from its declared tile up to the year
  whose shortest tile holds its length, under that level's tile holding its
  start, or, past a year, under each year it touches — where it was filed
  under every tile it touched, `{ on, tile, key }`. `level` is e3-types'
  `RecordLevelType`. A summary index's key is `{ on, key, tile }`, its totals
  as they were. Each such index a package declares changes type, so it is
  rebuilt as the package is deployed, as any changed index is; an index is
  derived from its record, so no repository upgrade step ships.
- **e3 gains the nested form of the series index, and the record's other
  indexes carry its lean rows beside it (#1434)** — package-borne.
  `e3.recordIndex.series(name, record, { collections, tile, summary? })`
  builds an index object as every index's is: its key function a row's
  entries, `(K, V) → Dict<IK, P>`, as a summary's gives its contributions; its
  key e3-types' `NestedEntryKeyType`, `{ collection, row, path, run, level,
  tile, item }`; its value `NestedEntryType`. Beside it, each of the record's
  other indexes that carries nothing or the row carries the row without the
  listed collections instead, so it changes type. And every index's and
  mutation's program is generated anew — rows read a field at a time, and
  built, through East's builders for names held as values — so each index a
  package declares is rebuilt as the package is deployed, as any changed index
  is, and a deploy builds the nested index its state lacks. An index is
  derived from its record, so no repository upgrade step ships.
- **A recursive type is written under the hash of its type table (#1202,
  #1462)** — package-borne, and no type changes. The `id` a recursive type's
  `wrapper` and its `ref`s carry was a counter of the process that wrote it,
  so one program's IR held other ids in another process or runtime; it is the
  first 62 bits of the SHA-256 of the type's beast2 type table, which every
  runtime writes alike, and a decoder names each wrapper it reads by it. IR,
  function manifests and package objects that hold a recursive type get new
  bytes once: packages are re-exported, and the dataflow runs each task over
  them again. A dataset's type is its type table, which writes no id, and a
  segment manifest writes its collection's type renamed canonically, so
  neither changes, and no repository upgrade step ships with it. A reader
  takes an id as the bytes give it, so IR an earlier SDK wrote still reads.
- **e3-ui's `Flowchart` draws one flowchart over the app's records (#1498,
  #1500)** — package-borne. The `Flowchart` extension's payload is not one
  flow of a record of flows or the host's: it trades `source` and `open` for a
  kind over the app's record for each of its states and transitions and,
  beside them, its lanes and its decisions (`FlowchartStateKindType`,
  `FlowchartTransitionKindType`, `FlowchartLaneKindType`,
  `FlowchartDecisionKindType`), each closed over beast2 bytes as the
  Schematic's kinds are, so the payload is one type whatever the app's rows
  hold. Each source's keys move from `narrowed` to `shown`, and `narrowed`
  says how a row the narrowing leaves out draws, `hide` or `dim`. Its
  `inspector` is a Boolean, a kind's own Details being its kind's
  `inspector`. The library's tabs on the wire (`FlowchartLibraryTabType`) lose
  `flows` and gain `lanes`; a kind's tab holds its `name` and `icon` alone
  (`FlowchartKindTabWireType`), its cards being on its kind, and an app's tab
  is Schedule's (`ScheduleAuthorTabType`). `Flowchart.Types.Flows`, `Flow`,
  `State`, `Link`, `Lane` and `Trigger` are removed. A UI value encoded under
  either type does not decode under the other: packages are re-exported, and
  the dataflow computes each UI task's output again under the new type. A UI
  task's output is not stored state, so no repository upgrade step ships with
  it. An application's record of flows (`Flowchart.Types.Flows`) holds a type
  that is removed; moving its flows into records of its own — its states, its
  transitions, its lanes and its decisions, each keyed by String, each row its
  own type — is those records' own migration, as with any record whose type an
  application changes.
- **e3-ui's `Flowchart`'s states and transitions gain their details (#1498,
  #1507)** — package-borne. The `Flowchart` extension's payload's state and
  transition kinds (`FlowchartStateKindType`, `FlowchartTransitionKindType`)
  each gain a last field, `details`, an Option of `FlowchartDetailsType`: the
  reads the app gives the kind — `Flowchart.figure`, `.histogram`, `.list` and
  `.tags`, each described once with where it shows — and its rows' values,
  read as the kind is, whole or by key, closed behind one function over a
  row's bytes (`FlowchartDetailRowType`), so the payload stays one type
  whatever the app's rows hold. `Flowchart.Types.TagColor` is new: a tag's
  palette and variant, for an app that keeps its tags' looks as data. A UI
  value encoded under either type does not decode under the other: packages
  are re-exported, and the dataflow computes each UI task's output again under
  the new type. A UI task's output is not stored state, and the details are
  the app's own records, read only, so no repository upgrade step ships with
  it.
- **e3's functions take inputs: a function object gains `inputs`, and its
  `inputTypes` becomes `argTypes`, as a function's signature does (#1514)** —
  package-borne, and the function routes' answer. `FunctionObjectType` gains
  `inputs`, after `bodyIr`: the paths of the datasets a call reads from its
  workspace, which a call passes the body before the caller's arguments; and
  its `inputTypes` becomes `argTypes`, the arguments a caller passes alone. A
  function object an earlier SDK exported does not decode under the new type:
  a call, a list or a describe of its package's functions is refused, naming
  the fix — re-export the package — and gc, which knows a function object by
  its current shape, no longer walks it, so the body and the environment only
  it names are swept: re-export a package with functions before a gc. Packages
  are re-exported, so no repository upgrade step ships. The function routes'
  signature (`FunctionSignatureType`, which list and describe answer) gains
  `inputs` and trades `inputTypes` for `argTypes` alike: an answer of either
  release does not decode as the other's, and a client refuses a server's
  answer of the other release, naming both types, as it refuses any type it
  does not read — so `e3 call`, e3-ui's `Func.bind` and the server they call
  are of one release. A call's result names the inputs it read before its
  dataset arguments, in `ExecuteResultType`'s `inputs`, whose type does not
  change.
- **e3 keeps the calls of named functions through a workspace (#1554)** —
  stored state, new, and new API types beside it. A call is a record of the
  repository's call store, `FunctionCallJobType` (e3-types `function-call.ts`):
  the call as the API answers it, `FunctionCallType`, and what its run needs
  and no reader is shown. The store is new — a repository opens with none — so
  no earlier release wrote a form of it, and no repository upgrade step ships;
  a change to its type from here on ships one, as any stored form's does. The
  API's types for a call (`FunctionCallStateType`, `FunctionCallArgType`,
  `FunctionCallSummaryType`, `FunctionCallType`, `FunctionCallStatusType`,
  `FunctionCallAnswerType`, `FunctionCallPageType`) are new, and the routes that
  answer them too, so no client reads an earlier answer of them: an earlier
  server has no `…/functions/:fn/calls` route, answers it 404, and
  e3-api-client calls it through the sync route, whose types do not change.
  A one-shot started as a call (`…/one-shot/calls`) is kept the same way, its
  program its caller's: the call's `function` (`FunctionCallSummaryType`'s and
  `FunctionCallType`'s) and its `package` are Options, `none` for it, and its
  job's `functionObject` names the anonymous function object its start stored,
  which the call alone roots. An earlier server has no `…/one-shot/calls`
  route, answers it 404, and e3-api-client runs the one-shot within one request
  (`…/one-shot`), whose types do not change.
  `ErrorType` gains no case: a call the workspace does not keep is `internal`.
  `FunctionCallStateType` and `FunctionCallStatusType` are kept forms: a case
  either gains is named to sort after every case before it, so its tag is the
  last.
- **e3's split calls gain `first`, a cancel, and a report of how they ran
  (#1104, #1105, #1110)** — neither package-borne nor stored in a repository:
  the split-call routes' request and answer, and a transfer store's record of
  a call's job. `SplitCallRequestType`'s output gains `first`, a call that
  stops once it has its first `limit` elements; `SplitCallStatusType` gains
  `cancelled`, and its `completed` gains `report`, how the call ran
  (`SplitCallReportType`); and e3-core's job record (`SplitCallJobType`) gains
  `first`, its status (`SplitCallJobStatusType`) `cancelled`, and its outcome
  `report`. `first` sorts between `dict` and `fold`, and `cancelled` before
  every case. A struct that gains a field reads under neither type whatever
  its variants' cases are named, so with `completed`'s struct changed no
  naming would keep an answer readable, and the cases keep the names that say
  them: a request or an answer of either release does not decode as the
  other's. A server refuses a client's request of the other release, and a
  client the server's answer, naming both types, as each refuses any type it
  does not read — so `e3`, the query builder and the server they call are of
  one release, as the function routes' are (#1514). A store keeps a job's
  record while its call runs and for minutes after it ends, and no upgrade
  step ships: a split call in flight as its server's release changes is lost
  — its record no longer decodes, and its poll fails — and a relaunch is
  served the units it finished from the execution cache.
- **TypeScript writes a variant's cases in name order, and a struct's fields
  in the order given, whatever their names (#1574, #1578)** —
  package-borne, and an application's stored state that holds such a
  variant. A variant's cases are in East's order, their names as strings
  sort, by code point, and a case's tag is its position there. TypeScript
  held a variant's cases as an object, which lists a name that is an array
  index — `"50"`, `"100"` — before every other, in numeric order, and it took
  that order for the cases': its type values, so the type section beast2
  writes and each case's tag, listed `"50"` before `"100"`, where east-c and
  east-py — and every runtime's comparisons — put `"100"` first. It also
  sorted names by UTF-16 code unit, so a name with a character past U+FFFF
  sorted before one in U+E000–U+FFFF where the two first differ (`"𝐀"`,
  U+1D400, before `"Ａ"`, U+FF21), which the others put after it, flipping
  such a variant's tags, its recursive ids and its default. A value
  TypeScript wrote read on east-c or east-py as another case. TypeScript now
  sorts the cases by code point and lists them so wherever their order shows:
  a type's `cases` object lists them in that order (`Object.keys`), as do its
  type value and so the bytes it writes, a printed type, a type's default and
  a match's arms, so every runtime writes one form. Only a variant with a
  case so named changes: east-ui's `ColorShadeType`, and with it
  `ColorTokenType` and each type that holds one; no type of e3's own, nor of
  e3-cloud's, holds one. Their type values, the ids of the recursive types
  holding them and the IR of every program holding them get new bytes once:
  packages are re-exported, and the dataflow computes each UI task's output
  again under the new type.

  A struct's fields are in the order its type gives them, and TypeScript's
  object of them could not keep a field named like an array index in its
  place: `StructType({ b, "10": …, "2": … })` listed `"2"`, `"10"`, `b`, where
  python's declaration keeps `b`, `"10"`, `"2"`. `StructType` now refuses a
  field so named given as an object, naming the list it takes instead —
  `StructType([["b", …], ["10", …], ["2", …]])` — which keeps its order, as
  the type's `fields` object lists it; a type value of a struct reads as the
  struct it lists, in that order. A struct with such a field is declared as a
  list before its package is next exported: listing its fields in the order
  the object gave them keeps the bytes an earlier TypeScript wrote of it. No
  type e3, e3-cloud or east-ui declares has such a field. e3's tree types —
  a struct of a package's dataset names at each level — list the names in
  the package structure's order, by code point (`"10"` before `"2"`), where
  an earlier release's object listed a name like an integer first, in numeric
  order. A level holding a dataset so named and another whose name sorts
  before it by code point (`"2"` beside `"10"` or `"1a"`) makes a tree of
  another type: a tree an earlier release stored of it is refused as another
  type, never misread. No package deployed today names its datasets so, and
  no repository upgrade step ships: a workspace of such a package is removed
  and deployed again.

  Bytes an earlier TypeScript wrote of such a variant are refused, never read
  as another type. A type value, or a beast2 type table, that lists a
  variant's cases out of East's order is refused on every runtime —
  TypeScript's `fromEastTypeValue`, east-c's type values and type tables, and
  east-py's through east-c's — naming the fix, which is to re-export the
  package or reset the state: east-c and east-py had sorted such a header and
  read its tags at other positions. And every reader of a collection checks
  the header's type against the type it was asked for, as the whole decode
  does, refusing one of another type, naming both: the pages, whole or
  through a range reader, the lazy value, the segment iterator, and a
  manifest, its own type at open and each segment's header as it is read.
  Before, those decoded the segments by the asked type's positions. So no
  form of them is carried forward. A deploy refuses an application's record
  that holds such a variant, a field of a `ColorToken`, as a changed type with
  no migration: deploy with `--schema=reset` to reset it to the package's
  initial value, setting again what was changed since. Until then a read of
  the record's state is refused. An input that holds one and
  was set in the workspace is reset to the package's value, as any input whose
  type changed. No repository upgrade step ships, since no type e3 stores for
  itself holds such a variant.
- **A record's programs run on east-c unless they name a runner (#1573)** —
  package-borne, and no type changes. A mutation or an index declared with no
  `runner` names east-c with no platform (`DEFAULT_RECORD_RUNNER`) where it
  named east-node with east-node-std: its program calls no platform function
  (`checkPure` refuses one), and east-c runs a write's program in tens of
  milliseconds where east-node took a quarter of a second. A mutation's and an
  index's object name their runner, so a package re-exported changes each
  such object: a deploy of it keeps each record's state and history, with a
  `$deploy` commit, as for any changed mutation, and rebuilds each index once,
  under its new object, as for any changed index. A package an earlier SDK
  exported deploys as it did, its programs on the runners it named. A local e3
  whose east-c cannot run — none is found, or the one found records no result,
  as a launcher with no native binary does — runs a record's program on
  east-node, saying so in the execution's log, and e3 in a browser runs it as
  it runs every unit. No stored form changes, so no repository upgrade step
  ships.
- **e3-ui's `Sheet` takes a system of records' column kinds, and a new entry's
  key and the fields no person can set from the app** — package-borne.
  `Sheet.Types.ColumnKind` gains `title`, `person`, `boolean`, `toggle`,
  `cycle`, `age` and `audit`, the kinds e3-ui's `<Record>` builds its grid
  from and `<Sheet>` refuses at build, and its `quantity` arm gains `unit`,
  after `uom`: one unit for every row. A variant encodes its case by its index
  among its cases, which are sorted by name, so every case after `action`
  moves down. The root (`Sheet.Types.Root`) trades
  `newRowId`, which took nothing and returned a key's text, for `newKey`, an
  East function from the keys taken, each as its text, to a new one
  (`Option<Function([Set<String>], String)>`); with none, the renderer mints a
  UUID. Its editing declaration (`SheetEditingType`) gains `unsettable`, after
  `newGroup`: a new row's and a new group's required fields that no column,
  band cell or form sets, each with the label the sheet gives it
  (`SheetUnsettableType`), which only the app's `newRow` and `newGroup` give.
  A UI value encoded under either type does not decode under the other:
  packages are re-exported, and the dataflow computes each UI task's output
  again under the new type. A UI task's output is not stored state, so no
  repository upgrade step ships with it. The `Record` extension and
  `Record.Types.Change`, the last change a row's field holds for an audit
  column, are new: no earlier release wrote either, so no form of them moves.
- **east-ui's editing session loses its apply mode: every edit waits for
  Save** — package-borne. The shared session's fields (`EditingSessionFields`:
  east-ui's `EditingType` and `SnapGridEditingType`, e3-ui's `PlanEditingType`
  and `SheetEditingType`) lose `mode`, which chose between Save and applying
  each ready gesture as it landed, and e3-ui's Plan settings
  (`PlanSettingsType`) lose `applyMode`, keeping `date`. They travel in
  east-ui's `SnapGrid` arm and in every e3-ui builder's payload, each Schedule
  kind's session among them, so a UI value encoded under either type does not
  decode under the other: packages are re-exported, and the dataflow computes
  each UI task's output again under the new type. A UI task's output is not
  stored state, so no repository upgrade step ships with it.
- **e3-ui's new rows take the app's `values` (#1526)** — package-borne. A new
  row's fields no role maps are the app's East function of what the builder
  decided of it, closed into its kind's `create` as their defaults were, so
  the Allocation's bin kind, the Schematic's link and net kinds and the cover
  targets keep their forms. Two kinds' functions change type: the Roster's
  duty kind (`ScheduleRosterKindType`) takes a new duty in its `create`
  (`Roster.Types.NewDuty`: its roles and the pattern that made it), where it
  took the roles, and the periods (`SchedulePeriodsKindType`) take the
  period's start before its row in `publish` and `dismiss`, which the
  periods' `values` makes a new row from. They travel in the `Roster`'s and
  the `Allocation`'s payloads, so a UI value encoded under either type does
  not decode under the other: packages are re-exported, and the dataflow
  computes each UI task's output again under the new type. A UI task's output
  is not stored state, and a new row is the app's record's own, so no
  repository upgrade step ships with it.
- **e3-ui's `Flowchart` and `Schematic` take records keyed by any key type
  (#1549)** — package-borne. Each kind on the wire — `FlowchartStateKindType`,
  `FlowchartTransitionKindType`, `FlowchartLaneKindType`,
  `FlowchartDecisionKindType`, `SchematicItemKindType`,
  `SchematicZoneKindType`, `SchematicLinkKindType` and
  `SchematicNetKindType` — gains `keyType`, after its last field: its
  record's key type. Each kind a gesture makes rows of — every one but the
  decisions and the zones — gains `rowKey` before it: the kind's `key`, a new
  row's key's text from its row's bytes, `none` without `key`. Keys travel as
  their text, as before. A UI value encoded under either type does not decode
  under the other: packages are re-exported, and the dataflow computes each UI
  task's output again under the new type. A UI task's output is not stored
  state, so no repository upgrade step ships with it. An application's records
  keep their types: one keyed by String reads as it did, and re-keying one by
  another type is that record's own migration (`migration.rekey`). The form's
  specs keep their type (`FieldSpecType`): a variant whose cases hold data gets
  the `select` editor and its cases' specs, where it got `readonly`.
- **e3-ui's `Record` reads its columns from data at the browser's day, and
  writes them through the Sheet's decode** — package-borne. `SheetColumnType`
  gains `from` and `mark`, after `detailCell`: a column from data's column and
  member, the field it reads and writes, and whether its cells take a clear
  (`SheetColumnFromType`); and where the column's marks cross, two unrendered
  cells beside it, its words and whether it locks (`SheetMarkCellsType`). The
  root (`Sheet.Types.Root`) gains `cellsAt`, after `editing`: a row's cells at
  a day, over its entry or its draft (`SheetReadFromType`), which the renderer
  calls with the browser's local calendar date at UTC midnight — a row from
  the source holds none of them. Its editing declaration's `decode`
  (`SheetEditingType`) takes that day after the prior wire row, and writes
  each cell from data a gesture changed through its column's `write`. They
  travel in the `Sheet` and `Record` extensions' payloads, so a UI value
  encoded under either type does not decode under the other: packages are
  re-exported, and the dataflow computes each UI task's output again under the
  new type. A UI task's output is not stored state, and a column from data
  reads and writes a field the app's record already holds, as it holds it, so
  no repository upgrade step ships with it.
- **e3-ui's `Plan` items carry a status, the builders' one (#1541)** —
  package-borne. `Plan.Types.Run.status` is an `Option` of
  `Plan.Types.Status` (`{ label, tone, ring }`: its words, its tone and
  whether it draws as an open ring) where it was an `Option` of a tone;
  `Plan.Types.BucketEvent` loses `tone` and holds `status`, the same `Option`,
  in its place; `Plan.Types.Chip` gains `status` after `state`, and
  `Plan.Types.EventMark` after `kind`. `Plan.Types.Status` is the type an
  event kind's status case already is (`Schedule.Types.Status`, and the
  Schematic's `Schematic.Types.Status`): one definition
  (e3-ui's `utils/status.ts`) under the three names, so the Schedule's and the
  Schematic's kinds on the wire do not change. The four items travel in the
  `Plan` extension's payload — the canvas's rows, a paged source's windows,
  the event kinds' blocks and a paged resource kind's — so a UI value encoded
  under either type does not decode under the other: packages are
  re-exported, and the dataflow computes each UI task's output again under
  the new type. A UI task's output is not stored state, so no repository
  upgrade step ships with it. An application's records keep their types: a
  status is made by the series' map, from whatever the row holds.
- **A record's ref remembers its last 16 keyed requests (#1599)** — stored
  state, and no type changes. A record's ref holds its version vector, a
  `Dict<String, String>`, and in it the commit protocol's reserved entries.
  Beside `$idem` and `$idem.commit`, which keep their meaning — the last keyed
  mutation's key and the commit that answers it — it gains `$idem.log`: the
  keyed requests before the last, each by its key's SHA-256 and the commit
  that answers it, under the head commit the entry was written at
  (e3-core's `records.ts`, `RECORD_KEYS_REMEMBERED`). A ref an earlier release
  wrote holds no such entry and reads as one that remembers its last request
  alone, so no repository upgrade step ships. An earlier release carries the
  entry as it carries any reserved entry it does not know, and does not keep
  it: past a commit of its own the entry names another head than the ref's,
  and this release reads it as none, so a request it named is a new request,
  as it was to that release. The API's types do not change: a request
  repeated under a key the record remembers is answered `committed` with a
  commit and a state, as the last one always was — the commit that answered
  it first, and the state the record holds as the repeat is answered, where
  it was that commit's own, which a record has left once anything is written
  since. A backend implements nothing for it, since a ref store keeps a ref's
  version vector whole.
- **e3-rack's replies lose e3's response type: rack protocol 3 and hub control
  protocol 3 (#1634)** — neither package-borne nor stored: what a rack's agent
  and its source exchange (`/api/rack/*`), and what a hub and the e3 processes
  of its machine exchange over its sockets. Every reply was e3-types'
  `ResponseType(T)`, whose type holds the API's `ErrorType`, which gains cases
  with releases; a rack serves the hubs of several releases, a hub the e3 of
  several projects, and beast2 reads a blob only as the type its header names,
  so no reply decoded across releases. A success is now the BEAST2 of the
  route's own type, and a refusal a status and JSON (the machine protocol) or
  plain text (the sockets). The machine protocol is numbered (`RACK_PROTOCOL`,
  3) and named in every request's `x-e3-rack-protocol`; `GET /api/rack/hello`
  answers it in JSON before any credential. Two structs gain one String each,
  `RackLeaseRequestType`'s `offer` and `RackHeartbeatRequestType`'s `report`,
  whose text is JSON read for the fields a build knows, as a lease's event and
  result already are (a result gains `reason` and `retries` there, and a
  lease's `resources` `reserveBytes`, what a rack books for it, at most its
  cap; no type changes for either): what grows from here on is JSON, and the structs keep their
  forms. The hub's status (`HubStatusType`) gains `outcomes`, and its capacity
  snapshot's racks (`CapacitySnapshotType`) `features`, `target` and `problem`.
  An agent and a source of other protocols refuse each other by name (`426
  upgrade-required`, and `incompatible` in `e3 rack list`), and an e3 that
  finds a hub whose hello it cannot read asks it to drain and runs locally:
  e3, the hub and the rack's agent are released together. No form is stored
  in these types, so no repository upgrade step ships.
- **e3-rack's `RackRuleType` gains `memoryLimit` and `gpu` (#1634, #1633)** —
  stored state, of a local repository's own layout: its rack policy,
  `rack/policy.beast2`, which the rack package reads and writes. A rule gains
  `memoryLimit`, after `allowHostCoupled` — an `Option<Integer>` of bytes, the
  most one piece of the rule's work may be capped at on a rack — and `gpu`, a
  Boolean. The policy's header names the whole policy type, so one an earlier
  release stored does not decode under the new type, and the release ships the
  first step of the local backend's own (`LOCAL_REPOSITORY_UPGRADES`, e3-core's
  `storage/local/rack-policy-limits.ts`): `rack-policy-limits` rewrites the
  file when the repository is opened, every rule as it was, with no memory
  limit and no GPU. A repository with no policy file has the defaults and is
  left without one; a file in neither form is left as it is, and a read
  refuses it as before, naming its reset. The step's two forms are frozen in
  e3-core, which the rack package depends on and not the other way: the form
  it writes is held to `RackPolicyType` by the rack package's own test, over a
  policy release 1.0.107 stored. An earlier release refuses a repository that
  has had the step, naming this release, as it refuses any step it does not
  know.
- **A lease may name an environment, and a local repository keeps the layers
  of one built for a rack (#1633)** — no type changes. A lease's event already
  carried `environment`, and the storage route already answered a manifest and
  its layers (`RackStorageRequestType.envManifest`,
  `RackStorageResponseType.env`): the local hub refused both, and now serves
  them from the session that owns the repository. A result's `reason` gains
  the code `environment-failed`, which a reader that does not know it takes as
  a rack's fault, as it takes any. What is kept is new, of a local
  repository's own layout: `rack/env-layers`, the gzip tar layers of an
  environment installed for a rack's platform (`blobs/sha256-<hex>`) and the
  manifests that name them (`manifests/<envHash>-<e3 release>-<platform>.json`,
  e3-rack's `EnvLayerManifest`, JSON). It is what a build made and can make
  again, never state: a manifest names the release that built it, in its name
  and in itself; a release reads only the manifests of its own name, and builds
  what it does not find; an earlier release never looks there; and gc removes a
  manifest whose environment nothing reaches and each layer no kept manifest
  names. So no repository upgrade step ships, and a later release that packs
  layers otherwise builds its own beside these.
- **e3's functions list the records a call may draft: a function object and
  its signature gain `drafts` (#1619)** — package-borne, and the function
  routes' answer. `FunctionObjectType` gains `drafts`, after `inputs`: the
  names of the records a call may pass drafts of, each a record one of the
  function's inputs reads, and none for a function that lists none. A
  function object an earlier SDK exported does not decode under the new type:
  a call, a list or a describe of its package's functions is refused, naming
  the fix — re-export the package — and gc, which knows a function object by
  its current shape, no longer walks it, so the body and the environment only
  it names are swept: re-export a package with functions before a gc. Packages
  are re-exported, so no repository upgrade step ships for it. The function
  routes' signature (`FunctionSignatureType`, which list and describe answer)
  gains `drafts`, after `inputs`, alike: an answer of either release does not
  decode as the other's, and a client refuses a server's answer of the other
  release, naming both types, as it refuses any type it does not read — so
  `e3 call`, e3-ui's `Func.bind` and the server they call are of one release.
- **A function's call passes drafts: the call request gains `drafts`
  (#1619)** — neither package-borne nor stored in a repository: the function
  routes' request. `FunctionCallRequestType` gains `drafts`, after `limits`:
  the unsaved edits a call lays over the records its function reads, in
  order, each a record, one of its mutations and that mutation's arguments
  (`FunctionDraftType`); none for a call that passes none. A struct that gains
  a field reads under neither type, so a request of either release does not
  decode as the other's: a server refuses a client's request of the other
  release, naming both types, as it refuses any type it does not read — and
  `e3 call`, e3-ui's `Func.bind` and the server they call are of one release
  already, by the function's signature (above). A program that calls e3 from
  East, through e3-api-client's `e3_function_call`, holds the request's type
  in its IR, and is package-borne by it: one an earlier SDK exported is
  refused as its runner checks it, naming the type the function takes and the
  one the program passes — re-export its package. No store keeps a request: a
  kept call holds its drafts in a form of its own (below), so no repository
  upgrade step ships for it.
- **A call's result names the records it drafted and what of its drafts ended
  it, and may end `conflict` (#1619)** — neither package-borne nor stored in a
  repository: the function, one-shot and split-call routes' answers.
  `ExecuteResultType` gains `drafts`, after `inputs`: each record the call
  drafted, once, with the commit it stood at as the call started, which its
  drafts were laid over (`FunctionDraftedType`), and none for a call that
  passed no draft. It gains `draftEnd`, after `drafts`: what of its drafts
  ended a call before its function ran (`FunctionDraftEndType`) — `draft`, the
  draft whose mutation failed or ran out of the call's time, with its record,
  its mutation, its place among the call's, their count and how it ended
  (`FunctionDraftFailureType`), or `laid`, every draft laid as the call's
  timeout ended, and how many — and none for any other end. A caller reads
  that from the result, never from its stderr, whose first line says it for
  people, and which a function's own output may begin the same way. And its
  `outcome` gains `conflict`, a draft that no longer fits its record, with
  the record, the mutation, the draft's place among the call's and the
  refusal's words (`FunctionDraftConflictType`). The result is what a sync call answers, and
  two more answers hold it: a kept call's status (`FunctionCallStatusType`'s
  `completed`) and a split call's (`SplitCallStatusType`'s `completed`, as its
  `result`). A one-shot and a split call take no draft, so theirs names none,
  no draft ends it, and it never ends `conflict`; its type changes all the
  same. With the struct changed,
  no naming of the case would keep an answer readable (#1104, above), so it
  has the name a Save's outcome has (`MutationResultType`): an answer of
  either release does not decode as the other's, and a client refuses a
  server's answer of the other release, naming both types — so `e3`, e3-ui's
  `Func.bind`, the query builder and the server they call are of one release,
  as they were. A program that calls `e3_function_call` or
  `e3_one_shot_execute` holds the result's type in its IR, and is refused as
  one that holds the request's is: re-export its package. No store keeps a
  result — a kept call keeps a state of its own (below), and a split call's
  job an outcome of its own (`SplitCallOutcomeType`), whose type does not
  change — so no repository upgrade step ships for it.
- **A kept call holds its drafts and what of them ended it, and may end
  `conflict` (#1619)** — stored state, and the call routes' answers.
  `FunctionCallType` gains `drafts`, after `inputs`: each draft the call
  passed, in order (`FunctionCallDraftType`) — its record, its mutation, and
  its arguments by the object they were stored as, `none` for a mutation that
  takes none. It gains `draftEnd`, after `drafts`: what of its drafts ended
  it, as its result names it (above), which a store writes as the call ends
  (`FunctionCallEnd`'s `draftEnd`) and the call store's contract suite holds
  every backend to. The
  commit a drafted record stood at is the record's, held once for it below and
  named by the call's result (`FunctionDraftedType`), never once a draft.
  `FunctionCallStateType` gains `conflict`, how a call ended whose draft no
  longer fits its record (`FunctionDraftConflictType`). The record a store
  keeps (`FunctionCallJobType`) gains `drafted`, after `keep`: for each record
  the call drafts, what its run lays the drafts from
  (`FunctionCallDraftedType`) — where the workspace holds the record, the
  state it held as the call started and the commit it stood at, read together,
  and the object of each mutation its drafts name — so the run reads the
  workspace no more, and lays the same state however often it runs. gc
  keeps what a kept call names (`functionCallRoots`), and so, for as long as
  the call is kept: each draft's arguments, each drafted record's state and
  mutations, and among its inputs the drafted state, which nothing else
  names.
  The release ships the repository upgrade step `function-call-drafts`
  (e3-core `upgrades/function-call-drafts.ts`): every call an earlier release
  kept is rewritten in the new form, holding no draft and none ending it,
  whatever its state. It
  reads each call as its store holds it and writes it back the same way
  (`FunctionCallStore.readStored`, which every backend's call store
  implements). A unit of the step is a call, keyed `<workspace>/<id>`, 16 at
  a time. A call whose lifetime has ended is carried too, and forgotten at its
  next read, as it would have been; a call already in the new form is left as
  it is, and so is one in neither form.
  `conflict` sorts second among a call's states, where #1554 (above) had a
  new case of `FunctionCallStateType` named to sort last. That keeps an
  earlier call readable where a case is all a release adds; here the call's
  struct gains a field beside it, so no naming would (#1104, above), and the
  state has the name a Save's outcome has. The call routes' answers hold the
  call, its state or its result (`FunctionCallType`,
  `FunctionCallSummaryType`, `FunctionCallPageType`, `FunctionCallStatusType`,
  `FunctionCallAnswerType`), and change with them: an answer of either
  release does not decode as the other's, and a client refuses a server's
  answer of the other release, naming both types — so `e3 call`, e3-ui's
  `Func.bind` and the server they call are of one release, as the function's
  signature already holds them.
- **east-ui's editing session gains its draft form, and e3-ui's bound record
  the draft of each mutation (#1620)** — package-borne. The shared session's
  fields (`EditingSessionFields`: east-ui's `EditingType` and
  `SnapGridEditingType`, e3-ui's `PlanEditingType` and `SheetEditingType`)
  gain `toDraft`, after `onApply`: the batch `onApply` takes, over the same
  bytes, answered as a draft of the source's write and not written
  (`EditingWireToDraftType`) — the draft's bytes, no change, or the refusal a
  Save of the batch meets before it writes. A session that saves through
  e3-ui's `Record.onApply` holds one: a Schedule kind's that saves to its
  record, a Sheet's over a record, and a Sheet's or a Plan's handed
  `Record.onApply` as its Save. Every other holds `none`: the SnapGrid's, the
  query builder's and Studio's, whose Save is the builder's own function, and
  a Save of the host's own. The fields travel in east-ui's `SnapGrid` arm and
  in every e3-ui builder's payload, each Schedule kind's session among them,
  so a UI value encoded under either type does not decode under the other:
  packages are re-exported, and the dataflow computes each UI task's output
  again under the new type. e3-ui's `Record.bind` handle
  (`RecordBindHandleType`) gains `draft`, after `commit`: one function for
  each mutation the handle binds, from the arguments `mutate.<name>` takes to
  the mutation's call as a draft (`FuncDraftType`, which is e3-types'
  `FunctionDraftType`), made by a new UI platform function, `record_draft`. A
  program that binds a record holds the handle's type in its IR; one an
  earlier SDK exported names a handle with no `draft`, and is bound one
  without, as a handle has what its type names — it is re-exported for its
  session's fields all the same. A UI task's output is not stored state, and a
  draft is written nowhere, so no repository upgrade step ships with it.
- **e3-ui's bound function names the records its function lists, and its
  call sends drafts (#1620)** — package-borne. `Func.bind`'s platform function
  (`function_bind`) takes a second argument, after the function's name: the
  names of the records the function lists in its `drafts`. The handle's
  `binding` (`FuncBindingType`) gains `drafts`, after `name`, which holds
  them, and its `error` (`FuncErrorType`) gains the kind `conflict`, a draft
  that no longer fits its record (e3-types' `FunctionDraftConflictType`),
  which sorts first among its kinds. A function that lists no record keeps the
  handle it had (`FuncBindHandleType`) but for those two. One that lists a
  record has a handle type of its own (`FuncBindDraftsHandleType`): its `call`
  takes the call's drafts after the function's arguments, an Array of
  `FuncDraftType`, and it gains `drafted`, after `read` — the records drafted
  by the call that gave `read`'s result, each with the commit it stood at
  (`FuncDraftedType`, which is e3-types' `FunctionDraftedType`). Behind the
  handles, `function_call` takes the drafts as a third argument, and
  `function_drafted` is a new UI platform function, which the function
  platform's list carries wherever it is spread. A program that binds a
  function holds the bind's call and the handle's type in its IR: one an
  earlier SDK exported passes `function_bind` the name alone, and is refused
  as it is checked, naming the count (`Platform function 'function_bind'
  expects 2 arguments but got 1`) — re-export its package. The binding travels
  in five builders' payloads as well — the Calendar's, the Plan's and the
  Sheet's `optimise`, and the Roster's and the Allocation's `fit` and
  `optimise` — so a UI value encoded under either type does not decode under
  the other, and the dataflow computes each UI task's output again under the
  new type. A UI task's output is not stored state, and a call's drafts ride
  the function routes' request, whose change is #1619's (above), so no
  repository upgrade step ships with it.
- **east-ui's record Slice takes its page's scope (#1621)** — package-borne.
  A source's config (`RecordSliceConfigType`) gains `scope`, after `presets`:
  each scoped field's exact values, as `.east` literals, in a `values` clause
  (`RecordSliceWhereType`). The record bind's platform function
  (`slice_bind_record`) takes a fifth type parameter, the scoped fields — a
  Struct with a Null field named for each — and the handle it answers
  (`RecordSliceHandleType`) gains them as `scoped`, after `source`, and
  `pageBase`, after `pageWhere`: a page of the rows the page holds of the
  source, the scope's on a scoped page, which a Sheet's rows read. A program
  that binds a record Slice holds the bind's type parameters in its IR: one an
  earlier SDK exported names four, and is refused as it is checked, naming the
  count (`Platform function 'slice_bind_record' expects 5 type parameters,
  got 4`) — re-export its package. The config travels in the handle every
  payload with a rail over records embeds (`RecordSliceBindType`'s `config`),
  east-ui's and each e3-ui builder's, so a UI value encoded under either type
  does not decode under the other, and the dataflow computes each UI task's
  output again under the new type. The narrowing the store keeps
  (`RecordSliceStateType`) is unchanged, and holds the viewer's choices alone,
  never the scope, so a narrowing kept or a view saved under the earlier type
  still decodes. A UI task's output is not stored state, so no repository
  upgrade step ships with it.
- **A task's and a function's inputs name the index of a record they read
  (#1617)** — package-borne, and the task and function routes' answers.
  `TaskInputType` gains `index`, after `path`: the index of the record at
  `path` the input reads, by its name on the record, and `none` for the dataset
  itself. `FunctionObjectType`'s `inputs` is an Array of `FunctionInputType` —
  a path, and the same `index` — where it was an Array of paths. A task object
  or a function object an earlier SDK exported does not decode under the new
  type: a run, a status, a call, a list or a describe of its package is
  refused, naming the fix — re-export the package. gc walks each as it did: it
  reads an object under the type its own header names, and what it walks of
  either — a program, what an output folds with, an environment — is where it
  was. Packages are re-exported, so no repository upgrade step ships for it.
  The answers that hold them change with them — a task's details
  (`TaskDetailsType`'s `inputs`) and a function's signature
  (`FunctionSignatureType`'s `inputs`) — so an answer of either release does
  not decode as the other's, and a client refuses a server's answer of the
  other release, naming both types: `e3`, e3-ui and the server they call are
  of one release, as they were. A dataflow's graph, which a stored run's state
  holds, names each input by its dataset's path alone, as it did — an index's
  by its record's — so no stored run changes, and which index an input reads
  is the task object's. An execution is keyed by the objects it read: for an
  index, the manifest its record's state names for it, which a backend finds
  through the store's own reads (e3-core `inputObject`). No execution recorded
  before names one, so none is re-keyed.
- **A call's result and a kept call name the index an input read (#1617)** —
  the function, one-shot and split-call routes' answers, and stored state.
  `ExecuteResultType`'s `inputs` and `FunctionCallType`'s are each an Array of
  `InputReadType` — a path, the `index` of the record there that was read, and
  the hash the dataset was pinned at — where an entry was a path and a hash.
  For an index the hash is its record's, the state it was read at, which is
  the hash the call's other inputs of that record name; a dataset argument, a
  one-shot's and a split call's among them, names no index. An answer of
  either release does not decode as the other's, and a client refuses a
  server's answer of the other release, naming both types. A program that
  calls `e3_function_call` or `e3_one_shot_execute` holds the result's type in
  its IR, and one an earlier SDK exported is refused as its runner checks it:
  re-export its package. A split call's job keeps what it read in a form of
  its own, a path and a hash, which does not change.
  The release ships the repository upgrade step `function-call-index-inputs`
  (e3-core `upgrades/function-call-index-inputs.ts`), after
  `function-call-drafts`: every call an earlier release kept is rewritten in
  the new form, each of its inputs naming no index, whatever its state. It
  reads the form `function-call-drafts` writes, as that step froze it, and
  each call as its store holds it, and writes it back the same way
  (`FunctionCallStore.readStored`, which every backend's call store
  implements). A unit of the step is a call, keyed `<workspace>/<id>`, 16 at
  a time. A call whose lifetime has ended is carried too, and forgotten at its
  next read, as it would have been; a call already in the new form is left as
  it is, and so is one in neither form. gc keeps what a kept call names, an
  input's hash among them: for an index, its record's state, which names the
  index's manifest.
- **e3-ui's builders ask their optimiser of the period in view and land a
  patch, and a bound function names the records it reads (#1622)** —
  package-borne. The request and result types each builder's `Types` gives
  (#1409, above) change whole. A request carries no row. The Calendar's and
  the Plan's (`ScheduleOptimiseRequestType`, a type where it was a constructor
  over the kinds' rows) is `{ from, to, period, run, slice }`. The Roster's is
  the same type, or given `{ edges: true }` that with `fixed`, a Set of the
  keys of the duties at the week's edges the answer must leave as they are.
  The Allocation's is `{ day, run, slice }`, and the Sheet's `{ run, slice }`,
  or over one entry's rows `{ run, slice, entry }`, the entry's key at the
  record's key type. `period` is the new `OptimisePeriodType`, a variant of
  `day`, `week`, `month`, `quarter` and `year`, each with no value, and
  `slice` the new `OptimiseSliceType`: each rail source's narrowing by the
  source's name (`Dict<String, RecordSliceWhereType>`). A result is a patch of
  each record the builder edits — `PatchType` of the record's type, what
  `East.diff` answers — where it was the rows complete: `{ events: { <slot>:
  Patch } }`, `{ duties: Patch }`, `{ bins: Patch }` and `{ rows: Patch }`.
  The Roster's is one form for both requests, its `edges` gone. No builder
  takes the earlier types, and none reads an answer of them. An app's
  optimiser is an `e3.function` of its own package, and re-exporting does not
  carry it: it is written again to the new request, reading what it needs from
  the workspace and listing in `drafts` each record it reads that the builder
  edits. A page that hands a builder a function of the earlier types is
  refused as it is built, naming what the function asks.
  `Func.bind`'s platform function (`function_bind`) takes a third argument,
  after the records the function lists in `drafts`: the names of the records
  the function reads, each taken as an input itself or by an index of it. The
  handle's `binding` (`FuncBindingType`) gains `reads`, after `drafts`, which
  holds them. A program that binds a function holds the bind's call in its IR:
  one an earlier SDK exported passes two arguments, and is refused as it is
  checked, naming the count (`Platform function 'function_bind' expects 3
  arguments but got 2`) — re-export its package. The Sheet's payload's
  `optimise` is an `Option<SheetOptimiseBindingType>` where it was an
  `Option<FuncBindingType>`: the binding, and beside it the record the sheet
  saves to by its name, the type of the rows its Save reaches and, over one
  entry's rows, the record's key type with the entry's key as bytes at it. The
  Calendar's and the Plan's resource kinds on the wire
  (`ScheduleResourcesType`, `PlanResourcesType`) lose `keyType`, `rowType` and
  `records`, which #1409 (above) gave them for a request to carry, and
  `ScheduleResourceRecordsType` goes with them. The binding travels in the
  five builders' payloads — the Calendar's, the Plan's and the Sheet's
  `optimise`, and the Roster's and the Allocation's `fit` and `optimise` — so
  a UI value encoded under either type does not decode under the other:
  packages are re-exported, and the dataflow computes each UI task's output
  again under the new type. A Sheet's and a Record's page over a rail hands
  the record itself, `record` beside `slice`, where it handed
  `onApply={Record.onApply(record, { keyed: true })}`, which is refused as the
  page is built, naming `record`. A UI task's output is not stored state, and
  a run's call is a function call as any other, kept as #1619 (above) keeps
  one, so no repository upgrade step ships with it.
- **e3-ui's Roster and Allocation ask their fit the question and the page's
  scope, and the call carries their unsaved edits as drafts (#1624)** —
  package-borne. The request types each builder's `Types` gives change whole,
  each a type where it was a constructor over the builder's rows. The Roster's
  (`RosterFitRequestType`) is `{ need, slot, start, scope }`, where it carried
  the week's duties each with its row, the week's targets, every person, the
  configuration and every slot's coverage. The Allocation's
  (`AllocationFitRequestType`) is `{ day, ask, scope }`, where it carried the
  day's bins each with its row and the board's context. `scope` is an
  `OptimiseSliceType` (#1622, above): each rail source's scope by the source's
  name, its fields alone. The answers' types (`RosterFitResultType`,
  `AllocationFitResultType`) are as they were; an answer holds a verdict for
  each subject the function considered. Each builder's `Types` gains what a
  fit's function makes of what it read — `Roster.Types.FitContext` and
  `Roster.Types.Candidate`, and `Allocation.Types.FitContext` — and the
  ready-made rules are plain East functions over them, none a constructor over
  the rows: `Roster.fit(words?)`, `Roster.answer`, `Roster.window`,
  `Allocation.candidates`, `Allocation.answer` and `Allocation.lookahead`.
  `Schedule.Types` gains the two builders' readings of a row,
  `RosterRoles` and `AllocationRoles`, which a context holds. No builder takes
  the earlier request types, and none reads a function of them. An app's fit
  is an `e3.function` of its own package, and re-exporting does not carry it:
  it is written again to the new request, reading what it needs from the
  workspace — its builder's rows through an index of their record — and
  listing in `drafts` each record it reads that the builder edits. A page that
  hands a builder a function of the earlier types is refused as it is built,
  naming what the function asks; one whose function reads a record the builder
  edits and lists no draft of it is refused as it is evaluated, naming the
  record. The binding the payloads carry (`FuncBindingType`) is as #1622 left
  it, and a fit's now names the drafts its function lists. A fit's call is a
  function call as any other, kept as #1619 (above) keeps one, and no stored
  form changes, so no repository upgrade step ships with it.
- **e3-ui's `Plan` draws its event kinds on its own rows, which are the
  resources (#1541, U1, U2)** — package-borne. The `Plan` extension's payload
  loses `resources`, the resource kinds (`PlanResourcesType`, each holding its
  rows, `PlanResourceRowType`), and `blocks`, the seam that made their rows
  (`PlanEventBlocksType`); its `paged`, the seam over a paged resource kind's
  windows (`PlanEventPagedType`), becomes a Boolean, whether the canvas's rows
  are read a page at a time. It gains `landings`, after `plan`: the series of
  its own rows the event kinds land on (`PlanLandingType`), each resources
  series and `kinds` case by its key, with its name, the ways its
  kinds draw, the kinds landing on it, its own series' keys, and whether its
  resources are the canvas's own entries, read by their keys over rows read a
  page at a time. And it gains `seam`, after `events`: how the events join the
  canvas's rows (`PlanEventSeamType`) — `placed`, the events read over a
  window and filed by landing, by way of drawing and by resource
  (`PlanEventPlacedType`, a struct where it was a dict), and `place`, which
  fills the landing rows of any window with them. `PlanEventShownType` goes.
  The canvas's root (`PlanRootType`) gains `unnarrowed`, after `rows`: where
  the rail's `rows` source gives the canvas its rows, every row that source
  narrows, made by the same series — what a pane names a resource the
  narrowing leaves out by, its row read by its key — and none otherwise. A
  series value (`Plan.Types.Series`) gains the arms `resources` and `kinds`;
  its cases are in name order, so the tags of those after `kinds` move. The
  library's Series tab lists no resource kind and no measure, so a viewer's
  hidden ids that named one (`resources.<slot>`, `measures.<key>`), kept by
  the browser, name nothing, and hide nothing.
  `Schedule.resources` loses its Plan half: `Schedule.Types.PlanResources` and
  `Schedule.Types.PlanResourceRow` are removed, and the options only a Plan
  read (`parent`, `sub`, `value`, `status`, `rollup`, `collapsed`,
  `measures`) are refused, each naming `Plan.series.resources`' own; the
  Calendar's, the Roster's and the Allocation's resource kinds keep their
  forms. A Plan given `resources` is refused at build, naming the series that
  replace it. A UI value encoded under either type does not decode under the
  other: packages are re-exported, and the dataflow computes each UI task's
  output again under the new type. A UI task's output is not stored state, so
  no repository upgrade step ships with it. An application's records keep
  their types: the resources a Plan drew are the rows of the record its `data`
  or its rail's `rows` source reads, and moving resources kept in records of
  their own into one record is that record's own migration, as with any
  record whose type an application changes.
- **e3-ui's `Plan` has one drop veto, over what a drop would do (#1541,
  U7)** — package-borne. The canvas's root (`PlanRootType`) keeps `canDrop`,
  whose type changes: an Option of a function from what a drop would do
  (`PlanCandidateType`, `Plan.Types.Candidate`) to an Option of its refusal's
  words, where it was a function from a drag event (east-ui's `DragEventType`)
  to a Boolean. The `Plan` extension's payload loses its own `canDrop`, the
  event kinds' veto over the schedule family's candidate
  (`PlanEventCanDropType`): the root's is the one check of both. A candidate
  says the gesture (`add`, `move`, `remove`, `resize`), the event kind or the
  data series it lands in or leaves, what is dragged — a template, a library
  tab's card, a backlog event, an event, or a data series' item
  (`PlanItemRefType`) — what it lands on, the row it would land on, typed, its
  lane, and its instants there. It is asked, and never stored.
  `Schedule.Types.Candidate` stays the Calendar's, the Roster's and the
  Allocation's. A Plan given a check of either older type is refused at build,
  naming what it is rewritten against. A UI value encoded under either type
  does not decode under the other: packages are re-exported, and the dataflow
  computes each UI task's output again under the new type. A UI task's output
  is not stored state, so no repository upgrade step ships with it.
- **e3-ui's `Plan` holds one event or item where it is (#1541, U9)** —
  package-borne. One event as a Plan draws it (`PlanEventItemType`) gains
  `locked`, last: whether its kind's `locked`, a new option of
  `Schedule.events`, holds it where it is, read with the event and its drafts
  in place, and `false` for a kind with no such rule. A run, a bucket's tile,
  a chip and an event mark (`PlanRunType`, `PlanBucketEventType`,
  `PlanChipType`, `PlanEventMarkType`) each gain `locked`, last: an event
  kind's from its event, a data series' from its item's map, `false` where the
  map leaves it out. An event kind as every builder takes it
  (`ScheduleKindType`, so the Calendar's, the Roster's and the Allocation's
  kinds too) gains `locked` after `ready`: none, or the kind's rule over
  entries, one answer each, which the builders' shared recorder asks of the
  row a gesture finds. A locked event is not moved, resized, changed or
  removed in any builder, and an optimiser's answer that changes it is
  refused; a Plan also draws it with a lock. Nothing is stored of it: the rule
  is the application's, over its own rows. A UI value encoded under either type does not decode under the
  other: packages are re-exported, and the dataflow computes each UI task's
  output again under the new type. A UI task's output is not stored state, so
  no repository upgrade step ships with it.
- **A Plan's library tab says what its cards make (#1541, U1)** —
  package-borne. An author's tab of a Plan's library (`PlanAuthorTabType`, the
  `tab` case of `PlanLibraryTabType`) is the tab every builder's library takes
  (`ScheduleAuthorTabType`) with `create` after it: none, or the event kind
  its cards make an event of, by its slot, and each card's key with what a
  drop reads of the template its kind knows it by — its key, name, group,
  start on a whole day and duration (`PlanTabCreateType`, each a
  `ScheduleCardMadeType`); the template's values stay with its kind. The
  Calendar's, the Roster's, the Flowchart's and the Schematic's tabs keep
  their form. An event kind's `write` makes an event from a card's template
  as from one of its own, under a key of the tab's — its name and the card's
  key as East prints the pair, `(tab="Orders", card="O-1")`, which no other
  tab's card shares — and the kind's `templates` list none of them; the
  gesture is `create`, unchanged. A UI value encoded under
  either type does not decode under the other: packages are re-exported, and
  the dataflow computes each UI task's output again under the new type. A UI
  task's output is not stored state, so no repository upgrade step ships with
  it.
- **A Plan carries its link kinds (#1541, U10)** — package-borne. The Plan's
  payload (`PlanPayloadType`) gains `linkKinds` and `canConnect`, last. The
  first is each link kind `<Plan links>` lists by slot, in that order
  (`PlanLinkKindType`): what every kind over the application's record carries
  of its record (whether it is editable, its session with its patch door, its
  form, its setter and its row type), its slot, name and icon, the event kinds
  each of its ends may name, how many links it holds, its stored links — each
  one's two events and its quantity beside its row's bytes, none past the cap
  an event kind is read under — a drafted link's same roles, its templates
  (each as an event kind's are, `ScheduleTemplateType`, its values every field
  of a link but its two ends), a new link from its two ends and a template's
  values, or none, its key's builder and its key type. The second is the connect
  veto (`PlanCanConnectType`, over `PlanConnectCandidateType`: the link kind
  and the two events), none where the Plan gives none. The canvas's own
  `links` hold the links built in code, as before. A link kind's links are
  rows of the application's own record, in its own row type: nothing of them
  is stored in a form of e3's. A UI value encoded under either type does not
  decode under the other: packages are re-exported, and the dataflow computes
  each UI task's output again under the new type. A UI task's output is not
  stored state, so no repository upgrade step ships with it.
- **A nested series index holds its keys in their own types (#1540)** —
  package-borne, and stored. A nested series index's entry key
  (`NestedEntryKeyType(rowKey, id)`) holds a child row's key, on the path from a
  row down to a node, and an item's id as the index's ids
  (`NestedIdType`): one variant with a case for each collection of child rows
  and of items, named by its place's field names joined with a dot
  (`nestedIdCase`), each holding that collection's Dict's key type. A path
  (`NestedPathType(id)`) is a list of ids, and an item (`NestedItemType`) is
  `id` an id, `at` an instant, `under` a path and an id, or `none`; they were
  text (`RecordNestedPathType`'s String steps and `RecordNestedItemType`, which
  is removed). A collection's place stays `RecordNestedPathType`, its field
  names, and a span's key (`NestedSpanKeyType`) is unchanged. So child rows
  and items may be keyed by any type a Dict is but a DateTime, and their keys
  sort in their types' own order. Every nested series index's stored form
  changes, one whose child rows and items are keyed by String included: a
  package is re-exported, and a deploy builds each nested series index again
  under its new index object, as it builds any index whose object changed; no
  repository upgrade step ships, and no reader keeps the earlier form. A page's
  reader names a node by its typed path, and a task's or a function's reader
  takes one (`path: [variant('members', key)]`).
- **A Plan's events land a step beneath their resource (#1541, U1)** —
  package-borne. An event as the Plan draws it (`PlanEventItemType`) gains
  `child`, last: the key of the row beneath its resource it is on, as that
  row's path ends in it (a String key as it is, any other as East prints it),
  none for a kind with no `child` and for an event whose field holds none. An
  event kind (`PlanEventKindType`) gains `child`: the field holding that key
  and the resources series its rows are of, none for a kind landing on its
  resource's own rows. A landing series (`PlanLandingType`) gains `under`,
  last: for a series a kind's `child` lands on, the landing series its rows
  stand beneath; none for every other, however deep it is nested;
  its `kinds` and `draws` count a kind with a `child` on the series its child
  names, never on its resource's. An event's `lane` is a variant field's
  case, by name, where the kind's `lane` names a variant. The events a window
  files (`PlanEventPlacedType`) keep their type: a series beneath a resource
  files them under the resource's key and the child's, as East prints the two
  together. A UI value encoded under either type does not decode under the
  other: packages are re-exported, and the dataflow computes each UI task's
  output again under the new type. A UI task's output is not stored state, so
  no repository upgrade step ships with it.
- **e3-types' `EnvironmentSpecType` gains `workspace_python`, and every reader
  refuses a spec an earlier SDK exported (#1654)** — package-borne. A
  workspace member's environment names the member, so its build installs the
  member's own dependencies and not its workspace's: `workspace_python`, the
  root's manifest and lock, the members it is of (`subjects`), the sdists of
  the local packages they reach, and the registry distributions it requires
  beside them. The case sorts last, so the five before it keep their tags,
  and a spec an earlier SDK exported decodes under the new type, since a
  header whose variant holds the first cases of the asked type's reads as it.
  But gc, which knows a spec by its current shape, would take such a spec for
  a leaf and sweep the manifest, the lock and the sdists it names, and a later
  build of its environment would fail on a missing object. So every reader of
  a spec — a build, a package export's walk of its objects, the check that an
  environment fits a rack's tier — reads it at exactly the current type
  (e3-types' `decodeEnvironmentSpec`), and refuses another, naming the fix:
  `the environment <hash> was exported by an older e3 SDK — re-export its
  package with the current one`. A spec's bytes hold its type, so every
  spec's bytes and hash change with the case, and each task of a re-exported
  package that names an environment runs again. Packages are re-exported, so
  no repository upgrade step ships.
- **e3-ui's builders make a new row's key by the app's rule, and read every
  key at its record's type** — package-borne. The kind every builder takes
  over an app's record of events (`ScheduleKindType`: the Calendar's events,
  the Plan's event kinds, which carry its fields, and the Roster's duties and
  the Allocation's bins, each inside its builder's own kind) gains `newKey`
  and `rowKey`, after `entries`: the app's rule for a new row's key, given the
  keys taken, each as its text (`Option<Function([Set<String>], String)>`),
  and the key's text the app's `rowKey` builds from a row's bytes
  (`Option<Function([Blob], String)>`), `none` for a kind given neither. The
  Roster's cover targets (`RosterTargetsKindType`) gain the same two after
  `entries`, and the fields the Flowchart's and the Schematic's kinds and the
  Plan's link kinds share (`KindSideFields`) gain `newKey` after `entries`,
  each of them holding its `rowKey` already. The Sheet's editing declaration
  (`SheetEditingType`) gains `underKey` and `rowKey`, last: over a record
  whose entries hold their own key in a field (`keyField`), an entry's draft
  and wire row with a key's text put in that field and in the cell of any
  column over it; over one whose keys the app builds from them (`rowKey`), an
  entry's key's text from its bytes. A Plan's link kind (`PlanLinkKindType`)
  gains `write`, after `create`: a link's row with its ends written from the
  two events given, which is how a link follows an event it joins that moves
  under another key. The Plan's root (`PlanRootType`) gains `rowsKeyType`,
  after `unnarrowed`: the key type `data` holds its entries by, which its key
  searches read a typed key at and order the keys they find by, none for a
  Plan with no `data`. The fit's and the optimiser's types over a builder's
  rows take their record's key type: `Allocation.Types.FitAsk`, `FitRequest`,
  `FitContext`, `FitResult` and `Candidate`, and `Roster.Types.FitContext`
  and `Candidate`, are constructors (`FitRequest({ key })`) where they were
  types, and `Roster.Types.OptimiseRequest({ edges: true, key })` holds
  `fixed` at the duties' key type. At the default key, String, each is the
  type it was, so the fit of an app over records keyed by String takes and
  answers what it did; one over another key type is new. An app's source
  changes all the same, whatever its keys: each of these was a value and is
  now a function to call. `Allocation.Types.FitAsk`, `FitRequest`,
  `FitContext`, `FitResult` and `Candidate`, and `Roster.Types.FitContext` and
  `Candidate`, are written `Allocation.Types.FitRequest()`; the ready-made
  parts `Allocation.fit`, `candidates`, `answer` and `lookahead`, and
  `Roster.answer`, are written `Allocation.answer()`. An app written against
  the release before does not compile until each is called. The shared
  session's declaration (`EditingType`) keeps its fields, and a keyed session
  now says one it always left `none`: `idField`, the field of an entry that
  holds its key, of the key's own type, where its kind names one (`keyField`).
  The session reads none of it for a keyed source; the builder's renderer
  keeps a new row's key there. A UI value encoded under either type does
  not decode under the other: packages are re-exported, and the dataflow
  computes each UI task's output again under the new type. A UI task's output
  is not stored state, and an application's records keep their types, so no
  repository upgrade step ships with it.
- **A rack lease's result gains `phases` (#1723)** — neither package-borne nor
  stored: JSON inside the completion's `resultJson` (`RackLeaseResult`), as
  its `reason` and `retries` are, read for the fields a build knows
  (`readRackPhases`): each mark of the lease's time on its rack, in ms after
  the rack received its grant, and the bytes it fetched, read from its cache
  and sent. No BEAST2 struct changes, rack protocol 3 stays as it is and the
  hub control protocol takes no step for it: a hub or a source that knows no
  phases takes the field as nothing, and a rack's agent of an earlier release
  sends none, of which a run prints nothing more. In process, e3-core's
  `ExecutionResult`, `TaskResult`, `TaskCompletedCallback` and e3-types'
  `PartitionProgress` gain an optional `timing`, the line a run prints of
  them; none is encoded, so no repository upgrade step ships.
- **e3-rack's `RackPolicyType` gains `weighFetch` (#1722)** — stored state, of
  a local repository's own layout: its rack policy, `rack/policy.beast2`. The
  policy gains `weighFetch`, a Boolean after `retryTaskFailuresLocally`:
  whether a task or a unit whose closure the racks do not hold would take
  longer to fetch over their link than it last ran runs locally. It is off
  unless the policy turns it on (`e3 rack policy . defaults --weigh-fetch`),
  for a new policy (`DEFAULT_RACK_POLICY`) as for one carried over: off, no
  fetch cost is asked of the hub and work is placed as before it. The
  policy's header names the whole policy type, so one an earlier release
  stored does not decode under the new type, and the release ships the local
  backend's second step (`LOCAL_REPOSITORY_UPGRADES`, e3-core's
  `storage/local/rack-policy-weigh-fetch.ts`): `rack-policy-weigh-fetch`
  rewrites the file in the form `rack-policy-limits` writes, which runs before
  it, into the new one, everything as it was and `weighFetch` off, as a new
  policy has it: an upgraded repository places its work as it did. A repository with no policy file is left without one; a
  file in no form the steps know is left as it is, and a read refuses it as
  before, naming its reset. The step's written form is frozen in e3-core and
  held to `RackPolicyType` by the rack package's own test, over the policy
  release 1.0.107 stored, carried through every step. An earlier release
  refuses a repository that has had the step, naming this release.
- **e3-rack's hub control protocol 6: a session asks what work would fetch
  (#1722), and ends a split scope** — neither package-borne nor stored: what a
  hub and the e3 processes of its sessions exchange over its socket. One
  release moves the protocol from 5 to 6 for two routes, one step:
  - `POST /v1/sessions/:id/fetch-costs` (`FetchCostRequestType`,
    `FetchCostResultType`): of the objects a task or a unit reads, each rack's
    link rate as the hub measures it from the data URLs it serves, and which
    of those objects it served that rack whole; the request names the scope
    the work's lease names (`scope`, an `Option` of its id), and a rack a
    lease of that scope wrote an object on holds it too, which the answer
    lists among its racks.
  - `POST /v1/sessions/:id/scopes/end` (`EndScopeType`): the split task's
    execution a session's units named has ended, so the racks it was granted
    to let what they kept of it go (below). A session's own scope, under a
    policy that keeps what work wrote for the session, is ended by no request:
    the session's end ends it.

  The protocol is negotiated exactly (`HUB_PROTOCOL`), so an e3 that finds a
  hub of protocol 5 asks it to drain and runs locally that once, as for any
  older number. The hub keeps what it measures and the scopes it was told of
  in memory; no form is stored, so no repository upgrade step ships.
- **e3-rack's `RackPolicyType` gains `defaultMerges`, and `RackRuleType`
  `merges`** — stored state, of a local repository's own layout: its rack
  policy, `rack/policy.beast2`. The policy gains `defaultMerges`, a variant
  `rack | local` after `weighFetch`, and a rule `merges`, an `Option` of it
  after `gpu`: where the merge and combine units of a split task the rule
  sends to a rack run, the rule's own else the policy's. The policy's header
  names the whole policy type, so one an earlier release stored does not
  decode under the new type, and the release ships the local backend's third
  step (`LOCAL_REPOSITORY_UPGRADES`, e3-core's
  `storage/local/rack-policy-merges.ts`): `rack-policy-merges` rewrites the
  file in the form `rack-policy-weigh-fetch` writes, which runs before it
  (after `rack-policy-limits`), into the new one, everything as it was,
  `weighFetch` among it, no rule naming merges of its own, and
  `defaultMerges` `rack`: every merge runs where it ran before. Both fields
  ship in the one release, so a repository an earlier release wrote takes
  the steps in order on its next open (`rack-policy-keep` after it, below).
  A repository with no policy
  file is left without one; a file in no form the steps know is left as it
  is, and a read refuses it as before, naming its reset. The step's written
  form is frozen in e3-core and held to `RackPolicyType` by the rack
  package's own test, over the policy release 1.0.107 stored, carried
  through every step. An earlier release refuses a repository that has had
  the step, naming this release. No wire between e3, a hub and a rack
  changes: a merge its policy keeps here is never leased, nor weighed for
  what it would fetch.
- **e3-rack's storage replies carry larger objects inline, and a hub serves a
  rack more transfers at once** — neither package-borne nor stored: what a
  rack's agent and its source exchange (`/api/rack/storage`, `GET
  /api/rack/hello`). No type changes. A storage request may name, in the
  `x-e3-rack-inline-max` header (`RACK_INLINE_MAX_HEADER`), the largest object
  it takes inline in the reply; a hub serves one of at most that size, and at
  most 64 KiB (`RACK_INLINE_OBJECT_MAX`), as the `inline` descriptor it always
  could, within 2 MiB of inline bytes a reply (`RACK_INLINE_REPLY_BYTES`), the
  rest as URLs. A request that names none is served as every request was,
  objects of at most 4 KiB inline (`RACK_INLINE_OBJECT_DEFAULT`); a source
  that does not read the header serves it so too. A hub's hello names
  `inline-objects` (`RACK_INLINE_OBJECTS`), and an agent names a size only to
  a source that does: so an agent and a source of either release keep working
  with each other. A hub's hello's `limits.transfersAtOnce` is 32
  (`RACK_TRANSFERS_AT_ONCE`): an agent takes what the hello says, and one that
  asks for more is told to ask again (`429 busy`), as before. No form is stored
  in these, so no repository upgrade step ships.
- **A unit's rack lease names its split task's execution** — neither
  package-borne nor stored. e3-core gives each unit of a split task the
  execution it runs in, `SplitScope` (a random id, whether a later unit reads
  what the unit writes, and a signal that ends with the execution),
  runtime-only, never hashed or recorded. A unit's lease event, JSON already,
  gains an optional `scope` (`{ "id", "feeds" }`); a rack's report names the
  feature `split-scopes`; and a heartbeat's answer may carry the header
  `x-e3-rack-scopes-ended`, a JSON array of ids, of at most 12 KiB
  (`RACK_SCOPES_ENDED_BYTES`) so an HTTP client's 16 KiB of headers takes it,
  the rest named by the next answers; a reader takes up to 1,024. No BEAST2 struct of rack
  protocol 3 changes, so the rack protocol keeps its number: the hub grants a
  lease with its scope only to a rack whose report names the feature, and
  sends the header only to such a rack, so an agent from before it is granted
  the same lease without one, and an agent that names it, under a hub from
  before it, is never told a scope and keeps nothing. A session ends a scope
  through the control route `POST /v1/sessions/:id/scopes/end`, which is part
  of hub control protocol 6 (above), the one step that also brings
  `fetch-costs`. Nothing is stored, so no repository upgrade step ships.
  Under a policy that keeps what work wrote for the session (below), a whole
  task's lease names a scope too, the session's own, in the same field and to
  the same racks; a call's names none. The feature keeps its name: a rack
  that names it keeps any lease scope's objects, a split task's or a
  session's. Both ship in the one release, so no agent that names the feature
  knew it as a split task's alone.
- **e3-rack's `RackPolicyType` gains `keep`** — stored state, of a local
  repository's own layout: its rack policy, `rack/policy.beast2`. The policy
  gains `keep`, a variant `split | session` after `defaultMerges`: how long a
  rack that keeps a scope's objects keeps what the policy's leases wrote
  there, for a split task's later units (`split`, as before), or for every
  later task and unit of the rack session (`session`: one `e3 dataflow run`,
  or one `e3 watch --start --rack` across its re-runs), whose every task's and
  unit's lease then names the session's own scope. The policy's header names
  the whole policy type, so one an earlier release stored does not decode
  under the new type, and the release ships the local backend's fourth step
  (`LOCAL_REPOSITORY_UPGRADES`, e3-core's `storage/local/rack-policy-keep.ts`):
  `rack-policy-keep` rewrites the file in the form `rack-policy-merges`
  writes, which runs before it (after `rack-policy-limits` and
  `rack-policy-weigh-fetch`), into the new one, everything as it was and
  `keep` `split`: a rack keeps what it kept before. All four steps ship in
  the one release, so a repository an earlier release wrote takes them in
  order on its next open. A repository with no policy file is left without
  one; a file in no form the steps know is left as it is, and a read refuses
  it as before, naming its reset. The step's written form is frozen in
  e3-core and held to `RackPolicyType` by the rack package's own test, over
  the policy release 1.0.107 stored, carried through every step. An earlier
  release refuses a repository that has had the step, naming this release.
  The wires it uses are the lease scope above and hub control protocol 6's
  `fetch-costs`, whose `scope` this release brings with the protocol: no
  further step of either.
- **e3-rack's `HubConfigType` gains `dataOrigins`: hub control protocol 7, a
  hub state step, and a hello's `data-origins`** — three wires, none
  package-borne:
  - Stored state, of no repository: a hub's own configuration,
    `hub-config.beast2` in its private home, which the hub alone reads and
    writes (`hub/config.ts`). The configuration gains `dataOrigins`, an
    `Array<String>` after `tls`: further origins of the same listener over
    which the hub spreads the data URLs it gives a rack. The file's value
    names its whole type, so one an earlier release stored does not decode
    under the new type, and the hub's own step, `hub-config-data-origins`
    (`upgradeHubConfig`), rewrites it as the hub starts, holding its lock,
    before it reads its configuration: everything as it was and no data
    origin, so an upgraded hub serves every data URL where it did. The step
    is idempotent; a file in no form it knows is left as it is, and the read
    refuses it naming the release its envelope says wrote it. The earlier
    form is frozen (`HubConfigBeforeDataOriginsType`) and held by the rack
    package's test to a configuration release 1.0.115 stored. An earlier
    release that finds the rewritten file refuses it as a form it does not
    read, as it would any other: hub state outside a repository keeps no
    record of its steps, and a hub is run by one e3 at a time.
  - What a hub and the e3 processes of its machine exchange over its socket:
    `GET` and `POST /v1/config` carry the configuration, so hub control
    protocol moves from 6 to 7 (`HUB_PROTOCOL`). It is negotiated exactly: an
    e3 that finds a hub of protocol 6 asks it to drain and runs locally that
    once, as for any older number.
  - What a rack's agent and its source exchange, as JSON, so rack protocol 3
    keeps its number: a source configured with data origins names
    `data-origins` (`RACK_DATA_ORIGINS`) in its hello and lists them in a new
    field, `dataOrigins`, which a reader takes only beside the feature, as
    HTTP(S) origins, at most 16 (`RACK_DATA_ORIGINS_MAX`), passing over any
    other entry; a source with none says the hello it said before. A rack's
    report names the feature when its agent fetches a data URL on any origin
    its source's hello lists, through the source's pinned certificate. The
    hub builds a data URL on them only for a rack whose report names the
    feature, so an agent from before it is given every URL on the advertised
    origin, and an agent that names it, under a source from before it, is
    told of none and fetches from the source's origin alone.
- **e3-ui's saved queries hold the names of the data sources they read, and
  their tags (#1758)** — an application's record, and package-borne.
  `Query.Types.SavedQuery` gains `tags` after `description` and `sources`
  after `root`, each a set of text: what a person tagged the query, and the
  names of its root, which every write gives through one function. A saved
  queries record is an application's own, declared at e3-ui's type, and one an
  earlier release wrote is carried by that record's own migration, as with any
  record whose type an application changes: the release ships the step,
  `Query.migrations.sourcesAndTags` — listed as `migration.rows("sources_and_tags",
  …)`, its types frozen copies (`e3-ui`'s `query/migrations.ts`) — which a
  deploy runs, giving each query its root's names and no tags; a record
  declared at the new type without it is refused at the deploy, the workspace
  keeping what it held. The type travels in the query builder's and the query
  library's payloads — the bound record's `read`, and `Query.Types.Open`, whose
  `new` case holds a saved query — so a UI value encoded under either type
  does not decode under the other: packages are re-exported, and the dataflow
  computes each UI task's output again under the new type. What a browser kept
  of the earlier form — this viewer's recent runs, each a saved query as East
  prints it, and the open query of a builder that holds its own — does not
  read under the new type, and is nothing kept: the recent runs start empty,
  and such a builder opens a new query on its first data source.
