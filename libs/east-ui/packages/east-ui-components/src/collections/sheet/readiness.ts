/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Evaluate business requirements against the current draft collection. @packageDocumentation */
import { compareFor, fromEastTypeValue, decodeBeast2For, encodeBeast2For, StringType, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Sheet, SheetEditingType } from "@elaraai/east-ui/internal";
import { liftDraft, type BatchReadiness } from "./draft-values.js";
import type { EntryVersion } from "./transactions.js";
import type { SheetContextValue, SheetRowValue } from "./values.js";

type Editing = ValueTypeOf<typeof SheetEditingType>;
type Readiness = ValueTypeOf<typeof Sheet.Types.Readiness>;
type Issue = ValueTypeOf<typeof Sheet.Types.Issue>;
const encodeContext = encodeBeast2For(Sheet.Types.WireContext);
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
    const driverColumn = editing.driverColumn.type === "some" ? editing.driverColumn.value : undefined;
    return (entries: ReadonlyMap<string, EntryVersion>): BatchReadiness => {
        if (entries.size === 0) return variant("ready", null);
        const issues: Issue[] = [];
        let invalid = false;
        const report = (result: Readiness, entry: string, row?: number) => {
            if (result.type === "ready") return;
            invalid ||= result.type === "invalid";
            const addressed = result.value.map(issue => ({ entry, row: row === undefined ? none : some(BigInt(row)), field: some(issue.field), message: issue.message }));
            issues.push(...(addressed.length ? addressed : [{ entry, row: row === undefined ? none : some(BigInt(row)), field: none, message: `Author check reports ${result.type}` }]));
        };
        const drafts = new Map<string, Uint8Array>();
        // Capture source drafts at their source offsets before local placement
        // changes. No callback can accidentally decode a neighbour's payload.
        for (const [index, wire] of resident.entries()) {
            if (entries.has(wire.id)) continue;
            // A base read that throws leaves the row to the bridge: a check
            // that needs it reports why, and the sheet stays up (#853).
            let payload: ReturnType<Editing["readEntry"]>;
            try { payload = editing.readEntry(wire.id, BigInt(positions[index]!)); }
            catch { continue; }
            if (payload.type === "some") drafts.set(wire.id, encodeDraft(liftDraft(draftType, decodeEntry(payload.value))));
        }
        const byId = new Map(resident.map(row => [row.id, row]));
        for (const [id, entry] of entries) {
            if (entry.draft === undefined || entry.wire === undefined) { byId.delete(id); continue; }
            drafts.set(id, encodeDraft(entry.draft));
            byId.set(id, entry.wire);
        }
        const rows = [...byId.values()];
        if (editing.keyed) rows.sort((a, b) => compareId(a.id, b.id));
        else for (const [id, entry] of entries) {
            if (entry.place.type !== "some" || entry.place.value.type !== "ordered") continue;
            const at = rows.findIndex(row => row.id === id);
            if (at < 0) continue;
            const place = entry.place.value.value;
            if ((place.type === "before" || place.type === "after") && !byId.has(place.value)) continue;
            const [row] = rows.splice(at, 1);
            const target = place.type === "start" ? 0 : place.type === "end" ? rows.length : rows.findIndex(row => row.id === place.value) + (place.type === "after" ? 1 : 0);
            rows.splice(target, 0, row!);
        }
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        // Each row's position: a source row's own (a failed window before it
        // does not move it, #853); a new row, the row before it's plus one.
        const sourceAt = new Map(resident.map((wire, i) => [wire.id, positions[i]!] as const));
        const placedAt: number[] = [];
        rows.forEach((row, i) => placedAt.push(sourceAt.get(row.id) ?? (i > 0 ? placedAt[i - 1]! + 1 : positions[0] ?? 0)));
        for (const [id, entry] of entries) {
            if (entry.draft === undefined || entry.wire === undefined) continue;
            const position = rows.findIndex(row => row.id === id);
            const checkRow = (cells: SheetRowValue["cells"], index: number, key?: string) => {
                if (rowCheck === undefined) return;
                const driver = driverColumn === undefined ? undefined : cells.get(driverColumn);
                const context: SheetContextValue = {
                    drafts, rows, rowsOffset: BigInt(placedAt[0] ?? 0), rowId: id, offset: BigInt(placedAt[position] ?? 0),
                    rowIndex: BigInt(index), line: key === undefined ? none : some(key), row: cells,
                    partial, today, driver: driver?.type === "String" ? some(driver.value) : none,
                };
                try { report(rowCheck(encodeContext(context)), id, key === undefined ? undefined : index); }
                catch (error) { report(variant("invalid", [{ field: "", message: `Row readiness failed: ${error instanceof Error ? error.message : String(error)}` }]), id, key === undefined ? undefined : index); }
            };
            if (childField === undefined) checkRow(entry.wire.cells, position);
            else {
                if (groupCheck !== undefined) {
                    try { report(groupCheck(drafts.get(id)!), id); }
                    catch (error) { report(variant("invalid", [{ field: "", message: `Group readiness failed: ${error instanceof Error ? error.message : String(error)}` }]), id); }
                }
                entry.wire.lines.forEach((line, index) => checkRow(line.cells, index, line.key));
            }
        }
        return issues.length ? variant(invalid ? "invalid" : "incomplete", issues) : variant("ready", null);
    };
}
