/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An action field in the inspector's Details (#1478): the row's state and
 * summary as its cell draws them, then a button for each case its row is
 * offered — off, with why, while it may not act — and under them, inline, a
 * choice's reasons or a form's fields through `FieldForm`, its consequence,
 * Cancel and the verb. Every case is taken through the same command as the
 * grid's, one transaction (T1). In a phone's drawer (`Mobile Sheet Spec.md`
 * SH12) the state stands 44 tall and the cases are the action bar's Default
 * 44 buttons, two to a line.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { variant } from "@elaraai/east";
import { FieldForm, type FieldOption } from "@elaraai/east-ui-components";
import { FrameDrawer, useSlotStyles } from "@elaraai/east-ui-components/internal";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { useSheetWords } from "../words.js";
import type { SheetRegisterIndex } from "../model.js";
import type { SheetCellValue } from "../values.js";
import { ActionCell } from "./ActionCell.js";
import { canTake, verbOf, type ActionCase, type ActionColumn } from "./model.js";
import { emptyRequired, getAt, setAt } from "./form-check.js";
import type { SheetActionHost } from "./host.js";
import { useSheetInspect } from "../index.js";

/** What the inspector's action field takes beyond the cell's host. */
export interface ActionPanelApi {
    /** Take a case with its value, one transaction. */
    take: (r: number, key: string, c: ActionCase, value: unknown) => boolean;
    /** What taking it would write, worded (F8). */
    consequence: (r: number, key: string, c: ActionCase, value: unknown) => string;
    /** What a form opens with (F10), decoded. */
    initial: (r: number, key: string, c: ActionCase) => unknown;
}

/** Props of {@link ActionPanel}. */
export interface ActionPanelProps {
    host: SheetActionHost;
    api: ActionPanelApi;
    r: number;
    columnKey: string;
    column: ActionColumn;
    cell: SheetCellValue | undefined;
    summary: string;
    registers: SheetRegisterIndex;
}

/** Renders an action field in the inspector. */
export const ActionPanel = memo(function ActionPanel({ host, api, r, columnKey, column, cell, summary, registers }: ActionPanelProps) {
    const styles = useSlotStyles("sheetAction");
    const button = useRecipe({ key: "button" });
    const phone = useContext(FrameDrawer);
    const { m } = useSheetWords();
    const seq = useSyncExternalStore(host.subscribe, host.version, host.version);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `seq` is the host's say that what the offer reads moved
    const offer = useMemo(() => host.offer(r, columnKey), [host, r, columnKey, cell, seq]);
    const [open, setOpen] = useState<ActionCase | undefined>(undefined);
    const [value, setValue] = useState<unknown>(undefined);
    const valueRef = useRef<unknown>(undefined);
    // The required field a take found empty, named in the error as the popover names it.
    const [missing, setMissing] = useState<FieldSpecValue | undefined>(undefined);
    // The inline form's element, whose inputs say a required field was emptied (F3 of the hand test), and that field.
    const formRef = useRef<HTMLDivElement | null>(null);
    const [emptied, setEmptied] = useState<FieldSpecValue | undefined>(undefined);
    // A phone's cells draw no controls (X4), but its drawer's field takes the cases as the grid's would: while the sheet
    // takes an edit, the column is editable and the row is not owned upstream (SH12).
    const inspect = useSheetInspect();
    const meta = inspect.columnAt(r, columnKey);
    const owned = inspect.selected.kind === "one" && inspect.selected.place.owned;
    const controls = host.controls(r, columnKey) || (phone && inspect.writable && meta?.editable === true && !owned);
    const choose = (c: ActionCase) => {
        if (c.kind === "button") { api.take(r, columnKey, c, null); return; }
        const form = c.take.type === "form" ? c.take.value : undefined;
        const initial = c.kind === "form" ? api.initial(r, columnKey, c) : undefined;
        valueRef.current = form?.scalar === true ? { [c.name]: initial } : initial;
        setValue(valueRef.current);
        setMissing(undefined);
        setEmptied(undefined);
        setOpen(open?.name === c.name ? undefined : c);
    };
    const onChange = useCallback((path: readonly string[], to: unknown) => {
        valueRef.current = setAt(valueRef.current, path, to);
        setValue(valueRef.current);
        setMissing(undefined);
    }, []);
    const options = useMemo(() => {
        const out: Record<string, FieldOption[]> = {};
        for (const [name, members] of registers.byName) out[name] = members.map((mm) => ({ key: mm.key, label: mm.label === "" ? mm.key : mm.label }));
        return out;
    }, [registers]);
    if (offer === undefined) return null;
    const may = canTake(offer) && controls;
    const why = offer.incomplete !== undefined ? m.actionIncomplete({ fields: offer.incomplete }) : offer.blocked;
    const form = open?.take.type === "form" ? open.take.value : undefined;
    const specs: readonly FieldSpecValue[] = form?.specs ?? [];
    const caseValue = (v: unknown): unknown => (form?.scalar === true && open !== undefined ? getAt(v, [open.name]) : v);
    const takeForm = () => {
        if (open === undefined) return;
        const now = valueRef.current;
        const empty = emptyRequired(specs, now, formRef.current);
        if (empty !== undefined) { setMissing(empty); return; }
        if (api.take(r, columnKey, open, caseValue(now))) setOpen(undefined);
    };
    return (
        <chakra.div css={styles.panel} data-inspector-action-field={columnKey}>
            <chakra.div css={styles.panelState} data-phone={phone ? "" : undefined}>
                <ActionCell column={column} summary={summary} offer={offer} controls={false} dirty={host.dirty(r, columnKey)}
                    selected={false} held={undefined} live={host.live(r, columnKey)} onNext={() => undefined} onMore={() => undefined} />
            </chakra.div>
            {controls && offer.offered.length > 0 && (
                <chakra.div css={phone ? styles.barRest : styles.panelActions} data-inspector-actions-offered=""
                    style={phone ? { ["--action-rest" as string]: "2" } : undefined}>
                    {offer.offered.map((c) => (
                        <chakra.button key={c.name} type="button" css={phone ? [button({ variant: "outline", size: "md" }), styles.barButton] : button({ variant: "outline", size: "xs" })} disabled={!may}
                            data-inspector-take={c.name} aria-expanded={c.kind === "button" ? undefined : open?.name === c.name} title={may ? undefined : why}
                            onClick={() => choose(c)}>
                            {c.icon !== undefined && <FontAwesomeIcon icon={["fas", c.icon as IconName]} aria-hidden />}
                            {verbOf(c)}
                        </chakra.button>
                    ))}
                    {!may && why !== undefined && <chakra.span css={styles.menuReason} data-inspector-action-why="">{why}</chakra.span>}
                </chakra.div>
            )}
            {open !== undefined && open.kind === "choice" && (
                <chakra.div css={styles.panelChoices} data-inspector-action-choices={open.name} role="group" aria-label={m.actionMenuChoice({ verb: open.label })}>
                    {(open.take.type === "menu" ? open.take.value.map((o) => ({ id: o.case, label: o.label, value: variant(o.case, null) as unknown }))
                        : open.take.type === "register" ? (registers.byName.get(open.take.value) ?? []).map((mm) => ({ id: mm.key, label: mm.label === "" ? mm.key : mm.label, value: mm.key as unknown }))
                            : []).map((choice) => (
                        <chakra.button key={choice.id} type="button" css={button({ variant: "ghost", size: "xs" })} data-inspector-choice={choice.id}
                            onClick={() => { if (api.take(r, columnKey, open, choice.value)) setOpen(undefined); }}>
                            {choice.label}
                        </chakra.button>
                    ))}
                </chakra.div>
            )}
            {open !== undefined && open.kind === "form" && (
                <chakra.div ref={formRef} css={styles.panelForm} data-inspector-action-form={open.name}
                    onInput={() => setEmptied(emptyRequired(specs, valueRef.current, formRef.current))}>
                    <FieldForm specs={specs} value={value} options={options} onChange={onChange} live />
                    {missing !== undefined && <chakra.span css={styles.formError} role="alert">{m.issueRequired()} — {missing.label}</chakra.span>}
                    <chakra.div css={styles.formFoot}>
                        <chakra.span css={styles.formConsequence} data-consequence="">
                            {emptied !== undefined ? m.actionNeeds({ fields: [emptied.label] }) : api.consequence(r, columnKey, open, caseValue(value))}
                        </chakra.span>
                        <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} onClick={() => setOpen(undefined)}>{m.actionFormCancel()}</chakra.button>
                        <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} data-inspector-take-form="" onClick={takeForm}>{open.label}</chakra.button>
                    </chakra.div>
                </chakra.div>
            )}
        </chakra.div>
    );
});
