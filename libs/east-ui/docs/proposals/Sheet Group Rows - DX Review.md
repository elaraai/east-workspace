# Sheet group rows: DX proposal and implementation review

Reviewed 13 September 2026. Library/API proposal only; no component-library or issue changes. The companion HTML mock now includes an incomplete-row visual exploration.

References: [group-row mock](<Sheet Spec - Group Rows.html>), [baseline mock](<Sheet Spec.html>), and the current `east-ui` authoring layer and `east-ui-components` renderer. I loaded the east-contribute skill, inspected both mocks in Chromium, and ran focused in-memory reproductions against the current Sheet source.

## Recommendation

**Keep groups as the data, paging, and search unit. Give group summaries their own typed fields and layout, then add explicit structural editing capabilities.** The useful change is to how authors describe and manipulate a group, while retaining the existing nested source contract.

The group-based shape is a good foundation. Following your latest direction, restrict children to `ArrayType(Line)`; the outer group source can still be keyed and paged:

```text
paged source of groups
  group: group fields + Array<Line>
    summary
    editable lines
```

I would preserve the typed line columns, registers, driver, link cells, and group-aware suggestion context. I would change the summary API, line identity, structural edit events, and capability declarations.

**Search remains source-backed and returns groups. There is no local search in this proposal.** In particular, I would not reproduce the mock's “Painting only” line filtering, locally calculated search matches, or a locally enumerated global plan picker.

## What exists, and what the mock changes

| Concern | Current implementation | Proposed direction |
| --- | --- | --- |
| Source shape | Groups contain array or dictionary lines; paging operates on groups | Keep group paging; accept only `Array<Line>` children |
| Summary | Title spans initial line columns; other group cells must sit under compatible line columns | Full-width summary with its own typed fields |
| Membership | Nested containment; a common extent rule | Derive markers and rails from the containing group's identity |
| Line identity | Array index or dictionary key | Array order plus stable line IDs |
| Insertion | Blank line at each group end; new-group ghost at the sheet end | Explicit before/after insertion and group-boundary insertion |
| Moving | No structural move event | Typed line moves; group moves only when the source supports them |
| Deletion | Select lines, delete them, then delete the empty group | Separate “delete selected lines” and “delete group with its lines” intents |
| Search | Paged key seek exists; a separate slice lens can filter resident lines | Use group seek/query only for this experience |
| Unassigned lines | No first-class representation outside groups | Requires a source-owned representation; never synthesize a global collection from loaded pages |

The summary restriction is explicit in [root.ts:540](../../packages/east-ui/src/collections/sheet/root.ts): every `group.cells` entry must name a declared line column, and its payload type must match that column. Consequently, adding a plan owner or plan status depends on an unrelated decision about the line columns. The mock removes that coupling entirely.

## 1. Make the summary independent of line columns

I would add a structured `summary` declaration to `Sheet.group`, retaining `cells` as the existing aligned layout for compatibility. A summary's field keys should refer to the **group's fields**, using the existing column builders for parsing, formatting, registers, and editability.

This is a proposed API sketch, not code that compiles today. Assume `PlanType` has `id`, `name`, `start`, `end`, `owner`, `status`, and an array of lines with stable `id` fields:

```tsx
<Sheet
    data={planSource}
    group={Sheet.group(PlanType, "lines", {
        lineId: "id",
        label: "Plan",
        summary: {
            title: "name",
            fields: {
                start: Sheet.column.date(PlanType, {
                    header: "Start", editable: false,
                }),
                end: Sheet.column.date(PlanType, {
                    header: "End", editable: false,
                }),
                lines: Sheet.column.integer(PlanType, {
                    header: "Lines", value: p => p.lines.length(),
                }),
                owner: Sheet.column.text(PlanType, {
                    header: "Owner", editable: false,
                }),
                status: Sheet.column.enum(PlanType, "statuses", {
                    header: "Status", editable: false,
                }),
            },
            trailing: ["status"],
        },
        marker: { label: p => p.name },
    })}
    columns={lineColumns}
    registers={registers}
    applyMode="batch"
    onPatch={observePlanChanges}
    onApply={applyPlanChanges}
/>
```

The summary renders across the available column area: name, date window, line count, owner, and trailing status. Its fields do not inherit the line grid's widths or payload restrictions. A small date-range presentation option could combine start/end without changing their underlying field identity.

The mock only edits the name. Preserve that behavior through field editability, while allowing other applications to opt into editing summary fields. Title editability should also be explicit; today it is always constructed as an editable text cell unless the whole Sheet is read-only.

I would start with this structured summary rather than requiring authors to build its layout and interaction through an arbitrary UI callback. Sheet can then own keyboard navigation, renaming, selection, focus, and accessibility. A custom display slot can follow if concrete applications need it.

Reusing `Sheet.column.*` also avoids growing a second nearly identical family of `Sheet.group.cell.*` builders. The public type should restrict summary fields to supported kinds and reject mutually exclusive aligned-cell and summary layouts clearly.

## 2. Make membership visible without duplicating it

Nested containment remains the authority: each rendered line gets its group ID from its parent. Authors should not have to maintain a second `planId` field purely for the gutter.

Add a group marker declaration with an accessible label and optional semantic color. The renderer can provide a deterministic color from group identity when none is supplied. Color must remain stable across paging and query changes; assigning colors by the currently loaded index would make the same plan change color.

The renderer owns the marker, selection checkbox, drag handle, rail continuity, and hover/focus label. These sit outside configurable line columns. The author supplies identity and presentation facts, not per-row rail geometry.

A rail joins adjacent lines of the same group and breaks at a group boundary, an unloaded region, or an unassigned container. It must not imply membership across unknown content. Keep the existing sticky group context when scrolling through long groups.

Also replace hard-coded “plan” text in generic Sheet controls with the declared group label. The current renderer uses “plan” in ghost rows, fold labels, selection hints, and counts.

## 3. Add stable line identity and explicit structural operations

Restrict the children field to `ArrayType(Line)`. Its array order is the planner's line order. Remove the dictionary-child overload, `keyed` child branch, and dictionary-specific `newLineKey` option; this avoids carrying two child addressing and ordering models through the public API and renderer. Existing dictionary-child callers would explicitly convert their data to an ordered array.

Array lines currently acquire wire keys from their indices in [bridge.ts:839](../../packages/east-ui/src/collections/sheet/bridge.ts). Add `lineId: "id"` and use that stable identity for selection, pending edits, suggestion anchors, and mutations. The array index remains a position, never the identity of a line that can move. Require stable IDs for structural editing; simple existing positional sheets can retain their current behavior during migration. New-line creation must populate the declared ID field.

This simplification applies only to children. It does not require changing a keyed/paged group source into an array, and it does not make that outer source freely reorderable.

The mutation contract should express intent directly:

| Intent | Required information |
| --- | --- |
| Insert a line | Destination group, explicit position, complete new line |
| Move lines | Stable line IDs, original group(s), destination group, destination position |
| Insert a group | Complete new group and a source-supported insertion position |
| Move a group | Group ID and a source-supported destination |
| Delete lines | Explicit line IDs within their groups |
| Delete a group | Group ID and explicit inclusion of its lines |

Use a position variant such as `start`, `end`, `before(id)`, and `after(id)`. The existing API assigns different meanings to `none` for group insertion and line insertion; explicit positions are easier to implement correctly.

**One user gesture should be one atomic edit transaction.** Moving a line between groups must remove it from the old group and add it to the new one together. Pasting across groups should likewise have one transaction boundary. The recommended `onApply` East function receives the complete change set for either source arm. A compatibility adapter can apply the complete transaction before invoking the existing inline `onUpdate`.

Typed events should expose `groupId`, `lineId`, and the actual edited field. Today a grouped event's `row` means the whole group, `rowId` means group ID, and a group cell's `key` is its presentation column or `$title`. That vocabulary makes persistence handlers unnecessarily dependent on layout. Retain old events through an adapter if compatibility is needed.

Provide East-function creation hooks returning complete `PlanType`/`LineType` values. The current bridge defaults undeclared fields when creating records. Applications need a natural place to set required IDs, initial status, owner, and other domain defaults. The group context should also permit line-level ownership/suggestion eligibility: currently the group `owned` flag is inherited by every line, which cannot express mixed released and draft lines in one plan.

## 4. Declare what the source can actually mutate

A callable `onEdit` should not automatically imply support for every structural gesture. Declare capabilities for inserting lines/groups, moving lines within/between groups, deleting groups, and reordering groups. Show or enable the corresponding affordance only when its operation is supported.

A group source backed by a key-ordered dictionary cannot adopt arbitrary visual group order without an ordering model that the source understands. **Do not implement the mock's free group dragging as an optimistic local reorder of a keyed source.** Similarly, inserting a group at an arbitrary visual boundary may be incompatible with canonical key order. These operations need host support; otherwise keep source order and disable them.

For permitted operations, the renderer should handle the mock's interactions consistently:

- Insert above/below creates a visible draft using stable source anchors, even after a query changes the viewport. It does not emit a domain insertion until the draft is valid.
- Insert inside a group defaults to that group.
- At a boundary, show the membership choices the source actually permits in the docked strip.
- New-group insertion snaps to a group boundary.
- Selecting a group and selecting its lines are distinguishable. Deleting the group includes its lines regardless of which happen to be visible.
- Pending mutations remain identifiable until acknowledged or rejected; errors must not leave apparently saved changes indefinitely.

An editable blank line can exist within a loaded group because that group's lines are present. Global group creation should use source-supported placement rather than requiring all groups to become resident first.

## 5. Keep search and saved views source-backed

The existing paged seek path already searches source keys, rebases residency, and lands selection on the group's band: [use-seek.ts](../../packages/east-ui-components/src/collections/sheet/use-seek.ts) and [index.tsx:1264](../../packages/east-ui-components/src/collections/sheet/index.tsx). Preserve that path.

Its current contract is key search, not arbitrary full-text search across plan names, activities, and notes. The search label and accepted input must reflect the queries the source supports. Do not silently substitute a local scan when an operator is unavailable.

The mock's “Plans” chip can become a source-backed group selector using existing query/seek capabilities. Do not enumerate resident groups as though they were the complete plan registry. Multi-select group filtering needs a corresponding source query capability; if absent, use supported group navigation or defer that part of the mock.

Saved views should restore a supported source query/navigation state and display settings such as group folds. Current Sheet views store slice narrowing plus local context/reveals, and their counts are calculated from resident lines. Those semantics do not implement global paged views. Omit global match counts unless the source supplies them; label resident counts explicitly where useful.

There is already a separate local line-lens path in [index.tsx:304](../../packages/east-ui-components/src/collections/sheet/index.tsx), with local saved-view counting at line 1280. This is an observed implementation behavior, not a recommendation. For the requested paged experience, it should not activate through a slice filter, a saved tab, or a fallback when `seek` is missing. Hiding the search input alone would not remove that path.

The mock's global line numbers also need adjustment. Group offsets do not reveal how many lines exist in unloaded preceding groups. Keep per-group line numbering, or show group position plus local line number; exact global line numbering requires additional source metadata.

## 6. Treat “No plan” as a source-model decision

The mock interleaves unassigned lines between plans. The existing source requires each element to be a group containing its lines. That is a real mismatch, not a missing CSS option.

If unassigned lines are required, the source needs to expose explicit containers/runs for them, with an identity and an ordered position. Sheet could render such a container with no plan summary, a neutral marker, and no plan-deletion gesture. The dataset must define what those containers mean and how queries and assignment writes address them.

I would not introduce a client-only fake plan, a second independently paged global line list, or a flat heterogeneous source just to copy the mock. The summary and structural editing improvements can ship while this source representation remains a separate decision. Exact interleaving of assigned and unassigned records is conditional on that representation.

## 7. Incomplete rows, optional fields, patches, and undo

This section refines the structural-edit proposal following our discussion. **Adding a visible row and applying a domain insertion are different operations.** An incomplete row needs a place in the editor without being converted into a fabricated valid record.

### Separate optional data from unfinished input

Use the row's `OptionType(T)` to express a domain field whose value may be absent. East represents it structurally as `VariantType({ none: NullType, some: T })`; it does not need a new primitive type for Sheet to recognise it. The current Sheet bridge already recognises optional fields and converts empty optional cells to `none`.

| State | Meaning | Can be applied? |
| --- | --- | --- |
| `Option<T>` containing `none` | A legitimate absent value | Yes, unless the declaration requires it in this context |
| Explicit `some(value)` | A supplied optional value | Subject to validation |
| Required field with no value yet | Incomplete editor input | No |
| Entered text that cannot be parsed, or a failed constraint | Invalid input | No |
| Explicit `0`, `false`, or an empty string | A real supplied value | Determined by the declaration, not truthiness |

Allow declarative contextual requirements and cross-field validation as East functions. For example, an optional field may become required for a particular row context. An empty non-option text field can still be valid if the declaration allows that value. Do not add `optional: true` as an independent flag that silently maps absence to a type's default. If an application chooses an empty sentinel, make that a deliberate declared mapping/default.

The editor needs a typed draft representation distinct from the domain row. Conceptually each field distinguishes **missing**, **parsed value**, and **invalid raw input**. A parsed value can itself be `none` for an optional field. Preserve field presence and raw input; wrapping everything in one Option and treating all `none` values as incomplete would conflate two different states.

East's `defaultValue` may remain an internal allocation convenience, but must not establish readiness. An explicit author-provided default may establish a field's value; a manufactured zero/date/string must not count as user input. Undisplayed required fields also need declared defaults or an author construction function before insertion.

**Current correctness gap:** [bridge.ts:374](../../packages/east-ui/src/collections/sheet/bridge.ts) maps a blank non-option cell to `defaultValue(payloadType)`, and new-row decoding starts from `defaultValue(lineType)` at line 593. The renderer inserts a row when any editable cell is nonblank. Thus entering a note can produce a callback row with default-valued fields that the application considers required. This is a source-traced missing readiness guard; the business rules must come from the declaration, not a hard-coded checklist in Sheet.

### Two East callbacks: running patches and application

Keep `onPatch` for running changes, and use `onApply` for submitting a validated batch. Both are East functions. A callback receiving an array of East patches is a good application API. I would name it `onApply`, since applying a change need not save anything. `onSave` could be the application's terminology, but persistence should not define the generic Sheet contract.

Proposed signature, with all Sheet-specific names still design sketches:

```text
onApply: East function(ChangeSet(GroupType)) -> ApplyResult
         or its asynchronous East-function equivalent

ChangeSet(P) = {
    requestId: String,
    sourceId: String,
    changes: Array<{ groupId: String, patch: PatchType(OptionType(P)) }>
}

ApplyResult = applied | rejected(details) | conflict(details)
```

A patch against `Option<P>` can express inserting a group (`none` to `some(group)`), deleting one, and updating one. Updates include patches to its child array. Address groups by stable ID; a cross-group line move carries both group changes in the same batch. Require the host to apply the complete batch atomically. A naked array of patches would omit the target identity and transaction identity needed for paging, retry, and acknowledgement.

This does not require a particular bind handle. The East function can read the current relevant values, apply the patches, and write through whole-value bindings, scoped record operations, or a package function that owns the transaction. A paged host resolves the addressed groups and never needs to load the whole group dataset. Read binding and write callback remain independent.

Validation/preparation is also an East function over the typed draft/context. It returns readiness and per-field/row messages; only its ready outcome permits construction of the domain value and domain patch. Pure column formatting accessors may retain authoring shorthand, but behavioral callbacks are real East functions, lifted into the IR rather than run as host callbacks. The host validates again at the application boundary where current data and domain authority are available.

`onPatch` is the running-change interception point. Proposed contract:

```text
onPatch: East function(PatchEvent(GroupType)) -> Null

PatchEvent(P) = {
    transactionId: String,
    sourceId: String,
    origin: edit | insert | paste | fill | move | remove | undo | redo | discard,
    label: String,
    draftChanges: Array<addressed PatchType(SheetDraftGroup(P))>,
    domainChanges: Option<Array<addressed PatchType(OptionType(P))>>,
    readiness: ready | incomplete(issues) | invalid(issues)
}
```

The `addressed` notation is schematic: the concrete East struct must carry the group's stable identity, including a temporary draft identity for a group not yet in the source. `SheetDraftGroup(P)` is a proposed East type holding per-field missing/value/invalid state and array-only draft children. It is not an untyped JavaScript object and is not `P` with defaults substituted.

Emit one `onPatch` call per committed editor gesture, including a gesture that leaves a row incomplete or invalid. It carries that gesture's incremental forward draft patches. `domainChanges` is `none` if the gesture cannot yet be expressed as valid domain changes; it is not a fabricated patch against default-valued records. When a new draft first becomes ready, its domain change is one complete insertion. An empty domain array means a valid gesture has no net domain effect, which differs from incomplete/invalid.

Authors can use `onPatch` to track running changes, update an external draft binding, drive related UI, or keep a draft journal. It must not be implicitly wired to the domain write callback. The recommended first version is an observation/interception notification returning `Null`; readiness and permission functions determine whether an action is allowed. If authors later need to veto/transform a gesture, design an explicit East-function result contract rather than treating exceptions or return timing as a veto.

Normal `onPatch` emission happens when a cell edit finishes, not on every keystroke, hover, or drag preview. The open text editor owns its native typing history. An invalid value retained when leaving a cell still becomes a draft gesture and emits its validation messages. Live per-keystroke preview would be a separately specified option, without creating a history entry for each character.

Undo and redo each emit `onPatch` once with `origin: undo` or `redo` and the actual inverse/forward patches applied locally. They move the history cursor; they must not enter the ordinary “new user edit” path that pushes another history entry or clears redo. A genuinely new edit after undo clears redo. Discarding a staged batch can report its reversal with `origin: discard`.

Host echoes of `onPatch` state and acknowledgements of `onApply` must not re-emit themselves. Correlate source identity and transaction/request IDs so externally stored draft state can be followed without loops. Source refresh is a reconciliation input, not a new user edit.

`onApply` receives the composed pending domain changes for the whole selected batch, rather than the last `onPatch` event. It must be invoked only once for that request ID, including when undo/redo or a host echo moves UI state. A rejected application retains the draft and its history. A patch sequence alone does not guarantee atomicity: the host East function's write path must implement the transaction across all affected groups.

Retire or adapt the old per-cell `onEdit` mutation channel. `onPatch` and `onApply` have deliberately different responsibilities; one action must not write to the same domain binding through both callbacks.

### Two histories: draft gestures and valid domain changes

Use East's existing `PatchType`, `diff`, `applyPatch`, `invertPatch`, and `composePatch`. The checked example `east:patch.examples.ts:patchE2ERoundTrip` demonstrates composition and inversion. Avoid inventing another field-patch format.

There is one necessary distinction: an incomplete row cannot be represented as an insertion patch against a valid `LineType`. It **can** be represented by a patch against the editor's typed draft state. Keep local undo entries over draft state; derive domain patches only from validated before/after values. This lets Ctrl-Z undo adding an entirely blank draft without manufacturing a domain record.

Store a history entry per gesture with its label, forward patch(es), inverse patch(es), and selection/anchor context. A flat array of patches is not enough to distinguish “paste 20 cells” from 20 unrelated edits. For each apply batch, compose sequential changes to the same group where valid; for inverse sequences reverse patch order as well as patch direction. Repeated edits to a single draft need only one final domain insertion, and adding then discarding a draft emits no domain patch.

Array patches are positional. Stable line IDs help the UI preserve intent and focus, but do not automatically make a patch safe after concurrent array changes. Apply patches against the expected base; report a conflict if the base no longer matches. East's patch layer has conflict detection and strict application. Do not promise automatic rebasing or silently apply an old array index to a different line.

### Recommended interaction

I would offer explicit batch application as the default for this planning surface, with the same transaction callback available for automatic application when the author chooses it.

- **Typing:** keystrokes remain in the cell editor. Enter/Tab commits a local cell edit and creates one Sheet undo step. Native text undo keeps working while the editor is active; Sheet-level Ctrl-Z operates outside it. Ctrl-Y redoes a Sheet action; also support Ctrl-Shift-Z, Command-Z and Command-Shift-Z.
- **Add row:** creates a local incomplete draft at the intended anchor immediately. No apply callback. The draft can be completed, moved locally, discarded, or undone.
- **Paste/fill:** one gesture and one undo step. Validate the resulting affected rows before enabling application; do not apply half a paste silently.
- **Drag/drop:** one undo step on drop; hover and preview create no history entries. Moving an incomplete draft changes only its local placement. Moving an existing line changes one or two group arrays in one change set.
- **Delete:** discarding an unapplied draft is local. Deleting an existing line or group stages a deletion, preserving enough data for inverse patches. Group deletion includes its children even when collapsed.
- **Batch bar:** show `3 changes · 1 incomplete`, plus Undo, Redo, Discard changes, and Apply changes. Disable Apply for an invalid/incomplete batch and link its explanation to the affected row. Do not silently skip invalid rows; a future “apply selected changes” feature would need explicit selection and dependency checks.
- **Application:** show applying while awaiting the callback. On success, acknowledge the submitted batch and reconcile it with the source. On rejection/conflict, keep the user's draft and explain what prevented application. A submitted batch must remain immutable and repeated clicks must not dispatch it twice.
- **Undo after application:** stage a new inverse change set; it goes through the same validation and application callback. It is a compensating change and can conflict. In automatic mode it can be submitted immediately; in batch mode it remains pending until Apply.

Support Ctrl-Z/Ctrl-Y on Windows/Linux and Command-Z/Command-Shift-Z on macOS, with Ctrl-Shift-Z as an additional redo shortcut. Provide persistent Undo and Redo icon buttons in the toolbar, with accessible names, action-specific tooltips containing shortcuts, keyboard focus styles, and disabled states when their stacks are empty. The buttons invoke exactly the same history commands as the shortcuts. When used during an open editor, first finish that edit if possible, then execute the history command; native keyboard undo inside an input remains native text undo. Focus-only, scrolling, folding, and searching should not create data-edit history entries.

Validation and application state are independent: a row may be incomplete or invalid; a valid changed row may be ready but not applied; an application may be pending or rejected. Do not use “unsaved” or a domain status column such as ERP status for these editor states.

### The visual change now in the HTML mock

The add-group affordance uses stacked rows with a small plus (`layer-group` with a plus badge), not a folder icon. The final line under the September plan and newly inserted draft lines use an amber row background, with stronger amber shading on empty editable cells. There is no status icon, inline “Needs context” text, extra status row, or Complete row button. A compact discard × button sits in the gutter immediately to the right of the row autocomplete/fill button; its slot stays stable when no fill is available. It has an accessible name and tooltip. The footer counts unapplied rows separately from plan lines. Empty-cell shading is a visual cue, not a required-field rule: optional absence remains valid according to the declaration. Validation details can remain available as tooltips or accessibility metadata without adding visible prose to every row.

These messages are supplied presentation fixtures. They do not define which columns the component requires, and the mock does not automatically infer validity or apply a row when its cells become nonempty. The mock's release action excludes these drafts. The mock now has working Undo/Redo icon buttons and Ctrl-Z/Ctrl-Y shortcuts (plus Command/Shift-Z variants). It records row snapshots per gesture for this standalone HTML demonstration; bulk suggestion acceptance is grouped into one step. It does not import East or implement the proposed East patch types. The real readiness functions, `onPatch` / `onApply` callbacks, and batch-application controls remain proposals and have not been implemented in the mock or libraries.

## 8. Concrete work for the mock's structural features

| Mock feature | `east-ui` contract change | `east-ui-components` change |
| --- | --- | --- |
| Add above/below, gutter plus, keyboard insertion | Draft creation/defaults and stable destination addresses; no early domain callback | Create a visible draft even with every cell empty; open the first contextually useful editable column; add one undo entry |
| Boundary membership strip | Allowed destinations and group identity in draft context | Present supported adjacent groups; changing membership moves the draft into that group's array view; preserve input and focus |
| Reorder a line | Stable array-line ID; group patch in the apply batch | Drag handle, before/after target, preview rule, auto-scroll; remove source before resolving destination position; drop on self is a no-op |
| Move a line between groups | Both affected group patches in one transaction | Preview destination membership; move the full line, including fields with no visible column; carry selection to its new address |
| Drag a group with its children | Source-supported outer ordering operation, separately from child-array edits | Preview only legal group boundaries; cannot drop a group into itself; retain child order and fold state |
| New plan at a boundary | Complete-group construction/readiness and source-supported placement | Create a group draft, focus its name, and keep its status unapplied until ready; source key order still governs keyed group placement |
| Select and delete | Explicit line/group selection; deletions represented by inverse-capable patches | Separate group selection from cell-range selection; group deletion removes all children; draft discard never calls the host |
| Membership rail and summary | Typed summary/marker declarations | Full-width summary, stable marker colors, accessible labels, and rail breaks at real boundaries |

Treat all drag targets as stable IDs/addresses, not DOM row indices. The mock's single-row drag is the initial scope; moving a multi-row selection is a separate extension. A line dropped on a group summary can target the start of that group's child array. No free-form outer group reorder is implied by making children arrays.

Paging adds interaction work without changing search semantics: pin the small set of groups needed by an active editor/drag, load a visible destination before resolving its child position, and never interpret an unloaded band as an empty group. Cancel or re-resolve a gesture when its source/target disappears. Outstanding drafts/history need stable ownership across window eviction; a different source/query must not silently discard them. No local search is required for any of this.

Suggested ownership: authoring types and callback lifting in `group.ts`, `types.ts`, `root.ts`, and `bridge.ts`; gesture/draft/history state alongside `sheet-types.ts` and `sheet-state.ts`; source-address and child-array transformations beside `model.ts`; integration in `index.tsx`; gutter, summary and amber draft styling in `Rows.tsx`; membership actions and batch controls in `Strip.tsx` / `Toolbar.tsx`; styles in the Sheet slot recipe. Prefer shared operations used by pointer, keyboard, paste, and undo paths.

Verification should cover a completely blank insertion producing no host callback, valid optional absence, explicit zero versus missing input, invalid edits to an existing row retaining its last applied value, paste as one undo step, a cross-group move and its inverse, callback rejection, and source refresh during an unapplied batch. These are integration cases around the actual East function, not just a raw event spy.

## Bugs and correctness findings

### P1 — Multiple `onUpdate` events can overwrite earlier edits (reproduced)

[bridge.ts:1160](../../packages/east-ui/src/collections/sheet/bridge.ts) compiles an update handler against the input collection. Each invocation reconstructs a new collection from that same captured snapshot. The renderer emits one event per changed cell/row through microtasks: [index.tsx:583](../../packages/east-ui-components/src/collections/sheet/index.tsx), and the emission loop at line 737.

I compiled a two-group Sheet from a bound collection snapshot, then called the generated handler for one line edit in each group, as a multi-group operation can do. The observed callback values were:

```text
Initial:        ["A task",   "B task"]
After edit A:   ["a edited", "B task"]
After edit B:   ["A task",   "b edited"]
```

The second update restores A's old value. The same reproduction succeeds with two flat rows. This affects the inline whole-collection write-back path; it is not proof that a custom paged `onEdit` persistence handler has this bug. Writes within one group often hide it because their wire events carry the cumulatively updated whole group.

**Fix direction:** apply a transaction against the latest collection and invoke `onUpdate` once. Add coverage for multi-row paste and multi-group clear/delete with the actual write-back callback. Existing grouped DOM tests replace that callback with a raw event spy, so they do not verify this integration.

### P2 — A group cell under the first column disappears (reproduced)

[indexGroup, model.ts:222](../../packages/east-ui-components/src/collections/sheet/model.ts) forces `titleSpan` to at least one. [SheetGroupRow, Rows.tsx:476](../../packages/east-ui-components/src/collections/sheet/Rows.tsx) skips every cell with column index below that span.

A valid declaration placing the group's owner under the first text column builds successfully and produces the owner cell in the wire value. The model then reports:

```text
first column: task
band contains task: true
titleSpan: 1
rendered data columns: []   // one-column reproduction
```

The title consumes the only position, so the declared owner is never displayed or editable. With more columns, the first-column group cell is still lost.

**Fix direction:** reserve an explicit title position, reject overlapping declarations, or use the independent summary layout proposed above. Do not silently accept a field that cannot render.

### P2 — Optional title fields type-check but fail while building (reproduced)

[SheetGroupConfig, group.ts:190](../../packages/east-ui/src/collections/sheet/group.ts) types `title` as `SheetFieldOf<P, StringType>`. That helper permits both `String` and `Option<String>`. [root.ts:542](../../packages/east-ui/src/collections/sheet/root.ts) accepts only an exact `String` field.

A group with `name: OptionType(StringType)` and `title: "name"` is admitted by the public type but throws:

```text
Sheet: `group.title` must name a String field of the row — "name" is Variant
```

**Fix direction:** either support optional titles with an “Untitled” fallback and correct optional-field writes, or narrow the public type to required strings. The compiler and builder should agree.

### Paged refresh/acknowledgement needs an explicit contract (source-traced concern)

This is not classified as a reproduced end-to-end bug. The implementation makes the failure condition visible, but the intended source revision lifecycle must be settled before assigning it a severity.

The paged window cache is keyed by source ID and reuses landed windows in [paging.ts:119](../../packages/east-ui-components/src/collections/sheet/paging.ts). The edit overlay also resets by source ID, and overrides complete source rows in [index.tsx:117](../../packages/east-ui-components/src/collections/sheet/index.tsx) and line 280. The e3 paged handle uses the dataset path as its ID, rather than a content revision: [paged-runtime.ts:551](../../packages/e3-ui-components/src/platform/paged-runtime.ts).

If the host expects an edit acknowledgement or a later server update at the same source identity to refresh a loaded group, cached rows and local whole-group overrides have no general acknowledgement/reconciliation path here. Merely fetching more pages will not resolve that. Conversely, immutable source snapshots with a changed ID can intentionally invalidate the cache.

Before adding cross-group moves, define how a successful write changes the source revision, refreshes affected groups, and retires pending overrides. Verify that against the real paged host. This is essential for the proposed structural operations, but I have not run a server-backed refresh reproduction.

## Handoff requirements for the implementing agent

The following decisions supersede alternatives discussed earlier in this review:

1. **Children are `ArrayType` only.** Preserve their order and give structural editing stable line IDs. The outer group source may still be keyed/paged.
2. **Search/query stays over groups through the source. No local search.** Do not ship the HTML mock's local activity/notes filter as the production solution.
3. **Adding a row first creates a draft.** Missing or invalid fields must not become a domain insertion through East defaults. Readiness comes from declarative East functions, with field-level messages. `OptionType` means legitimate optional domain data; it does not itself mean an incomplete draft.
4. **Use amber row shading for unapplied/incomplete rows, with stronger shading on empty editable cells.** No status icon, inline context labels, or explanatory row beneath the record. Place discard × to the right of the gutter row-fill button. Keep the conceptual “not applied”, “incomplete”, and “invalid” states distinct from storage/domain status; do not label them “unsaved”.
5. **Keep both `onPatch` and `onApply` as East functions.** `onPatch` reports incremental draft gestures, readiness, and domain patches where valid. `onApply` receives an addressed, validated, composed batch and returns an acknowledgement/rejection/conflict result. Neither assumes a particular input binding.
6. **Use East patch types in the real implementation.** Draft-state patches support incomplete edits and local undo; valid domain patches support application. Address each patch to a group and retain transaction boundaries. The HTML's snapshots are only a prototype implementation.
7. **One gesture is one undo step.** Include insert, cell commit, paste, fill, drag/drop, delete, and draft discard. Provide Ctrl-Z/Ctrl-Y and platform equivalents, plus Undo/Redo icon buttons with proper disabled states. Undo/redo emits `onPatch` without recursively recording a new action.
8. **Batch mode exposes Apply changes and Discard changes.** Block application of the batch when its affected drafts are incomplete/invalid; never quietly apply a subset. Optional automatic mode uses the same callbacks and readiness gates.
9. **Cross-group moves apply atomically.** Preserve undisplayed line fields. Group ordering and “No plan” require source-model support; array children alone do not solve either.
10. **Handle lifecycle explicitly.** Do not lose drafts on page eviction or query changes, replay host echoes, overwrite changed array positions, or clear the batch before an apply acknowledgement. Undo of an applied action is a new inverse application, subject to conflict checks.

No issue creation or component-library implementation was authorised in this review. The authorised edits are this Markdown handoff and the HTML prototype. Implementing the production design would be a subsequent task; do not treat mock fixtures or schematic type names as existing public APIs.

## Scope and sequencing

1. Fix the reproduced update and declaration/rendering bugs.
2. Add the independent typed summary, group label, and membership marker. Preserve existing group paging and seek.
3. Restrict children to arrays, add stable line identity, creation defaults, capabilities, and atomic structural events; integrate them with host write acknowledgement.
4. Add only the mock's query controls that the source can support. Decide unassigned containers separately.

The main DX improvement should be visible in a small example: the author declares a group source, its summary, its line columns, readiness functions, an `onPatch` East function for running changes, and an `onApply` East function for a validated batch of addressed patches. Sheet supplies the gutter and editing interactions. No application should need to flatten all groups, enumerate unloaded groups, or implement local search to achieve it.

Validation for this review: source inspection, Chromium inspection of both mocks, focused in-memory executions of the current authoring/model source, and browser checks of the added incomplete-row fixture, draft discard, explicit insertion, Ctrl-Z/Ctrl-Y, the Undo/Redo icon buttons, cell edit undo/redo, multi-row paste as one history step, cross-group drag/drop undo/redo (including membership and record order), and clearing redo after a new gesture. Only this proposal and the companion HTML mock were changed. No component-library implementation or issues were changed, and the full build/test/lint suites were not run. Proposed APIs above are design sketches, not implemented or type-checked additions.
