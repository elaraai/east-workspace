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

## See also

- [east-ui library guide](../../CLAUDE.md)
- [e3-ui React renderer guide](../e3-ui-components/CLAUDE.md)
- [Shared renderer and BuilderFrame guide](../east-ui-components/CLAUDE.md#builder-frame)
- [e3 guide](../../../e3/CLAUDE.md)
- [Base UI authoring guide](../east-ui/CLAUDE.md)
