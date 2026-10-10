# e3-ui

The author-facing bridge between e3 and east-ui. `ui()` declares a UI task;
`Data`, `Record` and `Func` bind workspace data and operations into its
reactive UI. Component tags and their typed payloads live here. React
renderers live in `e3-ui-components`.

Follow [STANDARDS.md](STANDARDS.md), the canonical
[UI prop patterns](../../../../docs/conventions/EAST_UI_PROP_PATTERNS.md)
and [East interop conventions](../../../../docs/conventions/EAST_TS_INTEROP.md).
This guide adds builder-specific decisions; it does not replace those standards.

## Developing a component that uses BuilderFrame

### Establish the API and reuse before implementation

Read Plan, Studio and Query on the actual dependency branch. Search the tested
example index for the intended capabilities, then inspect the matching example
and implementation. A mock is evidence for domain layout and workflow; it is
not the authority for shared component behavior or typography. Do not treat
another unfinished component, including Calendar, as the standard merely
because it is the most recent implementation.

Before building a new API, present a concrete minimal example and a full bound
example, including Slice, editing and the narrow layout. List the existing
components, hooks and recipes to reuse. Record mock conflicts as mock behavior,
existing behavior, proposed behavior and consequence. Resolve domain choices
with the user, and update the issue/spec with accepted decisions.

| Concern | Owner |
| --- | --- |
| Public JSX tag, domain types, validation and accessor adaptation | This package |
| Internal frame composition, interaction and rendering | `e3-ui-components` |
| BuilderFrame, Toolbar, Slice controls, editing, Library, FieldForm and theme recipes | `east-ui-components` and its shared contracts |
| Pure domain calculations used in tasks and UI | Reusable, tested East functions |

**BuilderFrame is hidden from application developers.** The public component
owns its frame; authors supply domain data and configuration. Do not expose
frame assembly or invent parallel framed/frameless APIs without a requirement.
Keep tag factories to validation, typed accessor adapters and payload assembly.
Do not emit an East program implementing layout, sessions or gestures there.

### Bind data and Slice as Plan does

- Bind editable records with their mutation doors inside `Reactive`. Resources,
  templates, backlog, configuration and other domain inputs must accept their
  declared reactive value types, including values from records, inputs and
  tasks. Backlog is a view of the authoritative event record. Browser viewer
  state is not a second domain-data store.
- **Expose the author-bound Slice contract used by Plan:** the app declares
  `Slice.config`, `Slice.bind` and the upstream narrowing, and passes
  `slice={{ slice, affordances: [...] }}` for shared controls. Study
  `slicePlanChrome` and `planWindows` in the tested example index. The renderer
  must not manufacture a hidden Slice over whatever rows it happened to load.
- The controls alone are not Slice integration. For inline data, feed the
  component the result of the shared Slice engine (`Slice.rows` or
  `Slice.apply` at the typed source boundary), preserving the original keys.
  Do not implement another search/predicate engine or infer filters from labels.
- For paged event records, follow `planWindows`: the bound Slice range drives
  the time window and therefore the day-index keys sought/read. Declare
  `Data.bindPaged` handles for the day index, backlog index and original
  entries, as appropriate. Keep inspector reads and edit baselines by key.
  Do not download a whole record to build filter choices or a filter preview.
- Distinguish range/index selection, filtering a loaded window, and seeking a
  key in the complete source. Plan's paged toolbar makes that distinction.
  Scope badges and counts must say what they cover. Do not describe arbitrary
  Slice predicates as server-side filtering unless an actual source/index
  implements that operation.
- Navigation and shared range controls must write the same bound Slice state.
  Test both directions, including a Slice changed by another component.
  Preserve draft and selection identity through range, filter and page changes.

### Examples show the complete component definition inline

Each example's `fn: East.function(...)` must show its own `Reactive` bindings,
component JSX, Slice wiring, configuration and custom UI callbacks. Do not hide
the UI in another exported function and show only `surface(true)` inside a Box.
An example is the public DX, the displayed showcase source and a tested program.
Its reader should be able to see how to build that component without chasing
an implementation helper.

Shared module-level types, records, mutations, indexes and seeded data are
appropriate: they identify the e3 units an example binds. Define UI composition
and custom inspector callbacks within the example. Reuse implementation in
the library; do not obscure example authoring to remove a few repeated lines.

Include runnable examples for the minimal API, a full bound surface, read-only
behavior, windowed data and a phone-width container. Use real e3-web sources
and mutation paths, not renderer-only fixtures. A mobile example must demonstrate
its useful content and actions, not merely a collapsed desktop pane.

### Verify the first complete workflow early

Before multiplying views, demonstrate one bound edit through Save and remount,
with shared toolbar/library/inspector, desktop and narrow content, and correct
computed text/icon styles. Use the [renderer guide](../e3-ui-components/CLAUDE.md)
for the interaction, styling and browser checks. Cover Slice-driven page reads,
filter changes and original-key writes, not just filter-chip appearance.

Run the applicable build, test and lint gates from the standards. Keep examples
and their behavioral tests paired. Update API documentation and this package's
canonical [SKILL.md](SKILL.md) when the authoring surface changes, then regenerate
and commit plugin indexes/materialized assets. Rebuild the actual showcase and
verify its examples and displayed code before saying the preview is updated.

### Footer rails and drag previews are shared parts too

Use the same footer rail recipe as Plan, not just its text style. The shared
`builder-footer.ts` owns the panel background, top rule, 28px desktop rail,
spacing, status typography and narrow wrapping. Pass it through BuilderFrame's
footer region; keep the footer visually distinct from the body. Calendar and
Plan both consume this part. Browser tests must compare the actual rail and
item styles in both themes and check narrow overflow.

Use the shared move-preview component and `time/move-ghost.ts` recipe for event
dragging/resizing. The preview sizes to its content independently of the source
bar or edge handle. Test a short timeline event: its title must not wrap into
a few characters per line. Preserve the shared destination/refusal caption.

### Weekly records: Roster's reference case

Keep the domain's aggregate boundary. Roster stores one complete week per UTC
DateTime key. Each week owns a shared EditSession/history view; the record's
write gate is shared across weeks. Save patches only the active week, and
Publish patches its assignments, targets, dismissals and published status in
one request. Unconfirmed writes retain the draft and the same retry identity.
Switching weeks, filtering or resizing must not discard another week's draft.

Keep **visibility separate from calculation scope** when the domain requires
it. Roster's author binds staff with `Data.bind`/`Record.bind`, applies
`Slice.rows` over typed staff scope rows, and passes their original keys as
`visiblePeople`. The complete `people` value still drives coverage, cost,
rest, skills and lead/trainer checks. Never calculate a misleading surplus by
filtering people out of the roster's arithmetic. Hidden edits still Save.

The windowed example binds a separate week-key Slice range and
`Data.bindPaged` on the weeks record. The same range is read by the shared
range control and written by roster navigation. Seek the active week, the
previous Copy source and the open picker's month only; do not read the whole
record to build the picker. Test an external Slice write and reverse navigation.

Use the Library's facet engine for role/skill focus. A host may control those
facets, but must not create a second search/filter implementation. Keep typed
inspector callbacks on the same guarded commands as dragging and mobile
forms; they cannot replace assignment identity or bypass published/read-only
state. Pure coverage and rule functions live in e3-ui and are compiled for
the renderer, so a task and the screen use the same arithmetic.

At main width below 480px, both Shifts and People become explicit-action cards;
no drag source or target remains registered. Test both layouts, target editing,
proposal acceptance, restore and Save/remount. Test the final toolbar forms at
360px with every action present: date picking, view, history and Publish must
all remain reachable. Bound each footer item separately so the shared rail can
wrap on narrow screens. Use Font Awesome for agreement icons as for other
icons; avoid text glyph substitutes.

Test the actual contained width as well as viewport width: a 360px showcase
viewport leaves a 294px frame after padding. Combine week and view controls
in a final shared-toolbar fold before history, keeping date picking, navigation
and Publish reachable. Desktop proposals use the mock's single-line dashed chip
with quiet Font Awesome actions; mobile cards keep labelled Accept/Reject.

Keep the footer to the legend. Roster explains its six coverage marks and
Calendar its configured event kinds, using the existing marks/icons and the
shared footer rail. Do not repeat status, pending edits, counts, costs or hours
there: shared history/toolbar controls and the inspector already own them.
Keep legend items individually wrappable and measure narrow overflow. The
inspector retains complete coverage/cost totals and explains whole-staff scope
when Slice narrows visible people. A collapsed Library badge reports availability
for the day, while tab counts report the library's item count.

Only show controls that change the active layout. People has a fixed weekly
window, so omit Day/Week; Calendar Resources has a fixed daily window, so omit
Day/Week/Month. Omit them from every Toolbar form, including menus and the
narrow combined picker. Keep the inactive period preference so switching back
restores it. Test expanded, folded and phone forms and switching back.

Group bands fill the complete scrolling grid width in both layouts. Make text
alignment explicit in slot recipes: Day shift details align left; compact Week
and People day labels center over their cells. Test band geometry at wide and
horizontally scrolled widths in both themes.

Sharing the drag engine does not by itself make dragging responsive. Profile a
realistic populated week. Keep shared drag handles/targets, but isolate sensor
updates from heavy chip bodies and cache previews by drag and destination for
the current immutable data. Use the existing pure domain checker over the
complete dependency set for a candidate; never deep-copy and recheck the entire
week on each pointer move. Invalidate previews when records/configuration change
and revalidate the final drop through the normal command. Test warning parity,
repeated hover, source immutability and cache invalidation. A completed edit may
update selection, but must preserve collapsed panes and the active inspector
tab. Only an explicit inspection action opens Details.

Keep a proposal's compact placement and detailed explanation separate in the
existing regions: a dashed single-line chip in the desktop grid, the complete
reason and labelled actions in Details, and explicit-action cards on phones.
Test those states after selection, as well as their initial appearance.

Numeric-input integration tests must allow the shared input's animation-frame
write-back to settle between keystrokes, following its existing tests. Also
exercise real decimal typing in Chromium through Save/remount. Distinguish a
refreshed record's stale-draft banner from a conflict returned by a write that
races with Save; both retain the draft and protect the newer stored value.

### Loading and bounded rendering

Use the shared `useContainerBelow`/`useContainerBreakpoint` hooks, as Plan does.
Their ResizeObserver updates commit before paint; a private asynchronous width
hook can briefly render phone cards into a desktop main while BuilderFrame
settles its panes. Verify the cold load as well as settled resize behavior.
Show a loading state while the active record window is unresolved; do not
render a forecast-only empty roster as though it were loaded data.

Bound the work, not only the CSS scroll box. Use Library's existing virtualizer
for populated bounded panes; do not disable it in an adapter. People rows and
phone People cards use the shared `VirtualRows` from the internal entry with
stable person/group keys, measured heights and selection-driven reveal. Keep
coverage and validation over the complete data while only mounting visible
rows plus overscan. Test scrolling to the end, search for an initially unmounted
person, selection/drafts through resize, and real drops after scrolling.

Profile the actual showcase too. Mount examples demanded by its viewport plus
a small adjacent window so asynchronous height changes do not unmount a deep
link. Memoize stable example entries; excessive offscreen examples add
subscriptions and render work to every drag. Test deep links and scroll anchoring
after changing that window. Record mounted row/card counts
and before/after load/drag measurements. Do not claim responsiveness from a
unit test or a shared-engine import alone.

## See also

- [east-ui library guide](../../CLAUDE.md)
- [e3-ui React renderer guide](../e3-ui-components/CLAUDE.md)
- [Shared renderer and BuilderFrame guide](../east-ui-components/CLAUDE.md#builder-frame)
- [e3 guide](../../../e3/CLAUDE.md)
- [Base UI authoring guide](../east-ui/CLAUDE.md)
