/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Split…` (`Allocation Spec.md` A71, #1332, #1362): an anchored popover over
 * the shared one, which the Inspector's Assigned to and the narrow cards (A78)
 * each open from a trigger of their own. It holds the quantity — with some of
 * the bin unallocated, what it places, that by default and at most; with all
 * of it on its resources, what it takes off a part, half of it by default —
 * and the resource it goes to, through the shared Chooser, every section of it
 * the fit's answer for that quantity (A73), the bin's own resources left out.
 * A choice is the board's `split`: one step that Undo takes back.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { FloatType, StructType, variant, type option } from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { FieldForm, SliceEditPopover } from "@elaraai/east-ui-components";
import { Chooser } from "@elaraai/east-ui-components/internal";
import { splitOf, type AllocationCommands } from "./actions.js";
import { resourceChoices } from "./choices.js";
import type { AllocationFit } from "./fit.js";
import { binCode, type InspectorWords } from "./inspector-model.js";
import { compareFloat, type Bin, type Context, type Day } from "./model.js";
import { a } from "./nouns.js";

/** What `Split…` takes: a quantity. */
const SPLIT_FIELDS = StructType({ quantity: FloatType });

/** `Split…`'s props: the bin, what the board knows and can do, and its trigger. */
export interface SplitProps {
    id: string;
    bin: Bin;
    /** The part it takes off when nothing is left: a resource card's own; the bin's largest when omitted. */
    from?: string | undefined;
    context: Context;
    /** The day as drafted: a draft asks the fit again. */
    plan: Day;
    commands: AllocationCommands;
    fit: AllocationFit;
    words: InspectorWords;
    /** The resources the narrowing shows; `none`, every one. */
    shown: option<ReadonlySet<string>>;
    /** Its trigger, one button, given the popover's label for its title. */
    trigger: (label: string) => ReactElement;
}

/**
 * `Split…` (see the module docs).
 *
 * @param props - See {@link SplitProps}
 * @returns The popover on its trigger, or nothing for a bin there is nothing to split of
 */
export function SplitPopover({ id, bin, from, context, plan, commands, fit, words, shown, trigger }: SplitProps) {
    const recipe = useSlotRecipe({ key: "allocationInspector" });
    const styles = useMemo(() => recipe({}) as unknown as Record<string, Record<string, unknown>>, [recipe]);
    const nouns = words.nouns;
    const take = splitOf(bin, from);
    const [open, setOpen] = useState(false);
    const initial = take?.initial ?? 0;
    const [quantity, setQuantity] = useState(initial);
    // Opened again, or what it takes moved: it takes its default again.
    useEffect(() => { if (!open) setQuantity(initial); }, [open, initial]);
    const least = take?.least ?? 0, most = take?.most ?? 0;
    const placed = compareFloat(quantity, most) > 0 ? most : compareFloat(quantity, least) < 0 ? least : quantity;
    // The question is the quantity placed (A73), of the day as drafted.
    const ask = useMemo(() => variant("place", { subject: variant("bin", id), quantity: placed }), [id, placed]);
    const { ask: asking } = fit;
    useEffect(() => { if (open) asking(ask); }, [open, ask, asking, plan]);
    const except = useMemo(() => new Set(bin.parts.keys()), [bin.parts]);
    const sections = open ? resourceChoices({ context, words, binRow: true, current: undefined, answer: fit.answer(ask), shown, except }) : [];
    const specs = useMemo(() => Fields.specs(SPLIT_FIELDS, {
        quantity: Fields.number({ label: nouns.quantity, min: least, max: most, step: 1, ...(context.unit === "" ? {} : { unit: context.unit }) }),
    }), [nouns.quantity, least, most, context.unit]);
    const shownValue = useMemo(() => ({ quantity: placed }), [placed]);
    const onChange = useCallback((path: readonly string[], next: unknown) => { if (path[0] === "quantity") setQuantity(next as number); }, []);
    if (take === undefined) return null;
    const code = binCode(context, bin);
    const label = take.from === undefined ? `Split ${code} · ${words.quantity(take.held)} unallocated`
        : `Split ${code} · ${words.quantity(take.held)} on ${context.resources.get(take.from)?.label ?? take.from}`;
    // It opens on the Chooser's search: the default is what a split most often takes.
    return <SliceEditPopover open={open} onOpenChange={setOpen} label={label} trigger={trigger(label)}
        initialFocusEl={() => document.querySelector<HTMLElement>(`[data-allocation-split="${id}"] [data-chooser] input`)}>
        <Box css={styles.split} data-allocation-split={id}>
            <FieldForm specs={specs} value={shownValue} onChange={onChange} />
            {open && <Chooser sections={sections} placeholder={`Find ${a(nouns.resource)}`} surface="inline"
                onChoose={key => { setOpen(false); commands.split(id, key, placed, take.from); }} />}
        </Box>
    </SliceEditPopover>;
}
