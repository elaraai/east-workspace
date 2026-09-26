/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** An independent onPatch consumer used by the renderer interaction tests. */
import { OptionType, applyFor, decodeBeast2For, encodeBeast2For, fromEastTypeValue, none, some, toEastTypeValue, variant, type EastType, type StructType, type ValueTypeOf } from "@elaraai/east";
import { SheetPatchEventTypeFor } from "@elaraai/east-ui/internal";
import { liftDraft } from "./draft-values.js";
import type { SheetRootValue } from "./values.js";

type Opaque = StructType<Record<never, never>>;
export type PatchEvent = ValueTypeOf<ReturnType<typeof SheetPatchEventTypeFor<Opaque>>>;

export interface SheetJournal {
    value: SheetRootValue;
    events: PatchEvent[];
    drafts: Map<string, unknown>;
    draft<T extends EastType>(id: string, type: T): ValueTypeOf<T>;
}

/** Replay actual East draft patches into a mirror independent of the renderer. */
export function sheetJournal(root: SheetRootValue): SheetJournal {
    const entryType = fromEastTypeValue(root.editing.entryType) as Opaque;
    const draftType = fromEastTypeValue(root.editing.draftType);
    const children = root.editing.children.type === "some" ? root.editing.children.value : undefined;
    const decodeEvent = decodeBeast2For(SheetPatchEventTypeFor(entryType, children));
    const decodeEntry = decodeBeast2For(root.editing.entryType);
    const encodeDraft = encodeBeast2For(root.editing.draftType);
    const patch = applyFor(toEastTypeValue(OptionType(draftType)));
    const drafts = new Map<string, unknown>();
    const opening = root.rows.type === "inline" ? some(root.rows.value) : root.rows.value.page(0n, 600n);
    const initial = opening.type === "some" ? opening.value : [];
    for (const [offset, row] of initial.entries()) {
        const raw = root.editing.readEntry(row.id, BigInt(offset));
        if (raw.type === "some") drafts.set(row.id, liftDraft(draftType, decodeEntry(raw.value)));
    }
    const events: PatchEvent[] = [];
    const value: SheetRootValue = { ...root, editing: { ...root.editing,
        // These interaction fixtures stage changes. An application callback
        // must explicitly confirm persistence; this fixture refuses Apply.
        onApply: root.editing.onApply.type === "some" ? root.editing.onApply : some(variant("sync", () => variant("rejected", []))),
        onPatch: some(bytes => {
            const event = decodeEvent(bytes);
            for (const change of event.draftChanges) {
                const before = drafts.has(change.id) ? some(drafts.get(change.id)) : none;
                const after = patch(before, change.patch);
                if (after.type === "some") drafts.set(change.id, after.value); else drafts.delete(change.id);
            }
            events.push(event);
            return null;
        }),
    } };
    const draft = <T extends EastType>(id: string, type: T): ValueTypeOf<T> => decodeBeast2For(type)(encodeDraft(drafts.get(id)));
    return { value, events, draft, drafts };
}
