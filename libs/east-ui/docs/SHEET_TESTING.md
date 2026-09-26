# Sheet behavior testing

Run from `libs/east-ui`:

```sh
npm run test:sheet
```

This builds the East UI authoring package, executes the compiled Sheet contracts
and the shared editing contract they name (`Editing`, #879), runs the live
apply-adapter tests, and runs every Sheet unit and DOM test with the shared
editing session's (`east-ui-components/src/editing/`). It does not start the
showcase, take screenshots, or require a browser installation.
Dependencies must already be installed and the workspace dependencies built.

The suites assert behavior at three boundaries:

| Boundary | What the tests verify |
| --- | --- |
| Compiled East functions | Exact draft contexts, preserved hidden fields, checked patches, atomic application, and invalid declarations |
| Editing session and live source adapter | One event per gesture, automatic completeness, Undo/Redo, complete batches, conflicts, idempotent retries, and revision acknowledgement |
| Rendered Sheet in jsdom | Typing, paste, keyboard navigation, fills, proposals, group folds, issue focus, disabled controls, and resulting source values |

Tests should assert observable consequences. For example: paste `1.5` into an
integer column; verify that the original source value remains unchanged, the raw
text stays visible with an accessible error, Apply is disabled, and Undo/Redo
removes/restores that gesture. A snapshot of the component's markup would not
prove those behaviors.

Use browser interaction tests for behavior that depends on browser layout, such
as drag hit testing and scrolling. Those can assert pointer destinations, element
bounds, focus, and source order directly. Screenshot comparison is a separate
visual check, not the correctness oracle for edits or persistence.

## Automatic completeness

The row's East `StructType` defines completeness. Column declarations define
parsing, presentation, and issue locations; they do not replace the row schema.
The default authoring path needs no readiness callback:

```tsx
<Sheet
    data={jobs}
    id="id"
    columns={{
        task: Sheet.column.text(JobType),
        qty: Sheet.column.integer(JobType),
        note: Sheet.column.text(JobType),
    }}
    onUpdate={jobs.write}
/>
```

Here `jobs` is a live handle over `ArrayType(JobType)`. The `JobType` fields might
be `id: StringType`, `task: StringType`, `qty: IntegerType`, and
`note: OptionType(StringType)`.

- Missing non-optional fields keep the draft incomplete, including hidden fields.
- Missing optional fields normalize to `none` when producing a domain value.
- Invalid text remains invalid even for optional fields.
- Supplied `0`, `false`, `""`, and `[]` are valid values of their respective types.
- Group completeness includes the fields of every child draft.
- An incomplete or invalid affected entry blocks the whole pending batch.

The editor keeps `missing`, `value(T)`, and `invalid(String)` as actual East
variant fields, rather than constructing domain defaults for unfinished rows.
Existing rows preserve undeclared fields. New rows require explicit application
defaults for required fields the user cannot fill through columns.

Rules such as non-empty task names, positive quantities, or end dates after start
dates are additional domain constraints. They cannot be inferred from the types
above. Optional author rules must add constraints without duplicating or bypassing
the automatic required-field check.


Add business rules with `ready.row`. It receives `Sheet.Types.Draft(JobType)`
and `Sheet.Types.DraftContext(JobType)` and returns `Sheet.Types.Readiness`:

```tsx
ready={{
    row: East.function(
        [Sheet.Types.Draft(JobType), Sheet.Types.DraftContext(JobType)],
        Sheet.Types.Readiness,
        ($, row) => {
            $.if(row.qty.hasTag("value").and(() => row.qty.unwrap("value").lessEqual(0n)), $ => {
                $.return(East.value(variant("incomplete", [
                    { field: "qty", message: "Quantity must be positive" },
                ]), Sheet.Types.Readiness));
            });
            return East.value(variant("ready", null), Sheet.Types.Readiness);
        },
    ),
}}
```

Returning `ready` adds no further constraint; automatic schema checks still run.
For grouped Sheets, `ready.row` uses the child draft and grouped draft context;
`ready.group` receives `Sheet.Types.DraftGroup(GroupType, "rows")`. Both use the
current draft order, and their issues identify the affected group or child.
Reads from captured reactive state are tracked, so changing a limit also updates
Apply availability. Callbacks must be synchronous and free of side effects.
A callback failure blocks Apply and reports an issue.

Review `sheetReadiness` in the showcase. Its paired compiled example verifies the
public declaration; `readiness.dom.test.tsx` exercises real East callbacks and the
editing session, including Apply results, Undo/Redo, reordered children, and
reactive rule changes without screenshots.
