/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Evaluate business requirements against the current draft collection —
 * linear in the rows and the drafts (#859): the source rows' drafts are read
 * once per source generation, placement is one ordered pass, and each draft's
 * position comes from one index. The author's row checks cross the wire as
 * one batch per evaluation (#882), so the rows are sent and built once, not
 * once per draft.
 *
 * @packageDocumentation
 */
import { compareFor, fromEastTypeValue, decodeBeast2For, encodeBeast2For, StringType, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, SheetEditingType, SheetReadyBatchType, SheetReadyCheckType } from "@elaraai/east-ui/internal";
import { liftDraft, type BatchReadiness } from "./draft-values.js";
import { placeInOrder } from "./placement.js";
import { ISSUE_TEXT } from "./words.js";
import type { EntryVersion } from "./transactions.js";
import type { SheetRowValue } from "./values.js";

type Editing = ValueTypeOf<typeof SheetEditingType>;
type Readiness = ValueTypeOf<typeof Sheet.Types.Readiness>;
type Issue = ValueTypeOf<typeof Sheet.Types.Issue>;
type ReadyCheck = ValueTypeOf<typeof SheetReadyCheckType>;
const encodeBatch = encodeBeast2For(SheetReadyBatchType);
const compareId = compareFor(StringType);

/**
 * Build one checker whose inputs are captured at the current source generation.
 *
 * @param editing - The decoded editing declaration
 * @param resident - The source's resident rows
 * @param positions - Each resident row's source position — a failed window before it does not move it (#853)
 * @param partial - Whether the rows are a window of a paged source
 * @returns The checker, or `undefined` when the author declared no checks
 */
export function authorReadiness(editing: Editing, resident: readonly SheetRowValue[], positions: readonly number[], partial: boolean) {
    const rowCheck = editing.readyRow.type === "some" ? editing.readyRow.value : undefined;
    const groupCheck = editing.readyGroup.type === "some" ? editing.readyGroup.value : undefined;
    if (rowCheck === undefined && groupCheck === undefined) return undefined;
    const draftType = fromEastTypeValue(editing.draftType);
    const encodeDraft = encodeBeast2For(editing.draftType);
    const decodeEntry = decodeBeast2For(editing.entryType);
    const childField = editing.children.type === "some" ? editing.children.value : undefined;
    // With loose rows between the groups (#846) an entry is a group or a row of
    // its own: a wire row with no band is checked as a row, never as lines.
    const looseSheet = draftType.type === "Variant";
    const rowOnly = (wire: SheetRowValue): boolean => childField === undefined || (looseSheet && wire.band.type === "none");
    const driverColumn = editing.driverColumn.type === "some" ? editing.driverColumn.value : undefined;
    // The source rows' drafts, read at their source offsets — once for this
    // generation of the source, however many evaluations follow (#859). No
    // callback can accidentally decode a neighbour's payload.
    let residentDrafts: Map<string, Uint8Array> | undefined;
    const sourceDrafts = (): ReadonlyMap<string, Uint8Array> => {
        if (residentDrafts !== undefined) return residentDrafts;
        const read = new Map<string, Uint8Array>();
        for (const [index, wire] of resident.entries()) {
            // A base read that throws leaves the row to the bridge: a check
            // that needs it reports why, and the sheet stays up (#853).
            let payload: ReturnType<Editing["readEntry"]>;
            try { payload = editing.readEntry(wire.id, BigInt(positions[index]!)); }
            catch { continue; }
            if (payload.type === "some") read.set(wire.id, encodeDraft(liftDraft(draftType, decodeEntry(payload.value))));
        }
        residentDrafts = read;
        return read;
    };
    // Each source row's position: a failed window before it does not move it (#853).
    const sourceAt = new Map(resident.map((wire, i) => [wire.id, positions[i]!] as const));
    /** The driver member a row's cells name, if the driver column holds one. */
    const driverOf = (cells: SheetRowValue["cells"]): ReadyCheck["driver"] => {
        const driver = driverColumn === undefined ? undefined : cells.get(driverColumn);
        return driver?.type === "String" ? some(driver.value) : none;
    };
    return (entries: ReadonlyMap<string, EntryVersion>): BatchReadiness => {
        if (entries.size === 0) return variant("ready", null);
        const issues: Issue[] = [];
        let invalid = false;
        const report = (result: Readiness, entry: string, row?: number) => {
            if (result.type === "ready") return;
            invalid ||= result.type === "invalid";
            const at = row === undefined ? none : some(BigInt(row));
            if (result.value.length === 0) issues.push({ entry, row: at, field: none, message: ISSUE_TEXT.author(result.type) });
            for (const issue of result.value) issues.push({ entry, row: at, field: some(issue.field), message: issue.message });
        };
        // The source rows' drafts, with the session's over them.
        const drafts = new Map(sourceDrafts());
        const byId = new Map(resident.map(row => [row.id, row]));
        for (const [id, entry] of entries) {
            if (entry.draft === undefined || entry.wire === undefined) { byId.delete(id); drafts.delete(id); continue; }
            drafts.set(id, encodeDraft(entry.draft));
            byId.set(id, entry.wire);
        }
        let rows = [...byId.values()];
        if (editing.keyed) rows.sort((a, b) => compareId(a.id, b.id));
        else rows = placeInOrder(rows, row => row.id, Array.from(entries, ([id, entry]) => [id, entry.place] as const));
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        // Each row's position: a source row's own; a new row, the row before
        // it's plus one. And each draft's place among the rows, by one index.
        const placedAt: number[] = [];
        const indexOf = new Map<string, number>();
        rows.forEach((row, i) => {
            placedAt.push(sourceAt.get(row.id) ?? (i > 0 ? placedAt[i - 1]! + 1 : positions[0] ?? 0));
            if (!indexOf.has(row.id)) indexOf.set(row.id, i);
        });
        // The row checks, one batch for the evaluation (#882): a draft's row —
        // a flat row, or a loose row (#846) — or each line of a draft's group.
        // The rows cross the wire once and the bridge builds them once; the
        // results return in the checks' order.
        const checks: ReadyCheck[] = [];
        let results: readonly Readiness[] = [];
        if (rowCheck !== undefined) {
            for (const [id, entry] of entries) {
                if (entry.draft === undefined || entry.wire === undefined) continue;
                const index = BigInt(indexOf.get(id)!);
                if (rowOnly(entry.wire)) checks.push({ index, line: none, driver: driverOf(entry.wire.cells) });
                else entry.wire.lines.forEach((line, at) => checks.push({ index, line: some(BigInt(at)), driver: driverOf(line.cells) }));
            }
            if (checks.length > 0) {
                try { results = rowCheck(encodeBatch({ drafts, rows, rowsOffset: BigInt(placedAt[0] ?? 0), partial, today, checks })); }
                catch (error) {
                    // The batch itself failed — its rows could not be built — so
                    // every check reports why. A check that throws fails alone:
                    // the bridge catches it per check.
                    const failed: Readiness = variant("invalid", [{ field: "", message: ISSUE_TEXT.rowCheck(error instanceof Error ? error.message : String(error)) }]);
                    results = checks.map(() => failed);
                }
            }
        }
        // Reported in the order the checks stand: a group's own check, then its lines'.
        let next = 0;
        for (const [id, entry] of entries) {
            if (entry.draft === undefined || entry.wire === undefined) continue;
            if (rowOnly(entry.wire)) {
                if (rowCheck !== undefined) report(results[next++]!, id);
                continue;
            }
            if (groupCheck !== undefined) {
                try { report(groupCheck(drafts.get(id)!), id); }
                catch (error) { report(variant("invalid", [{ field: "", message: ISSUE_TEXT.groupCheck(error instanceof Error ? error.message : String(error)) }]), id); }
            }
            if (rowCheck !== undefined) for (let line = 0; line < entry.wire.lines.length; line++) report(results[next++]!, id, line);
        }
        return issues.length ? variant(invalid ? "invalid" : "incomplete", issues) : variant("ready", null);
    };
}
