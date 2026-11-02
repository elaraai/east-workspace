/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A phone's action bar (#1479, `Sheet Action Column - Behaviour Spec.md`
 * §12): in a frame of 560 or less the action cells show their state alone,
 * and the docked strip becomes the selected row's actions — its eyebrow with
 * the state at its end, the first offered case full width, the rest on one
 * line below (two and More… past four), the first case's consequence (X3,
 * X5, X6). A choice or a form opens inside the bar, never floating: a head
 * with ← back and the eyebrow, a choice's reasons as 44px rows, a form's
 * fields through `FieldForm`, its consequence, then Cancel and the verb as two
 * halves (X7). Taking a case returns the bar to the row's new offer (X8),
 * through the same command as the grid's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faArrowLeft, faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { variant } from "@elaraai/east";
import { FieldForm, type FieldOption } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { useSheetWords } from "../words.js";
import type { SheetRegisterIndex } from "../model.js";
import { canTake, verbOf, type ActionCase } from "./model.js";
import type { SheetActionHost } from "./host.js";
import type { ActionPanelApi } from "./ActionPanel.js";

/** Props of {@link ActionBar}. */
export interface ActionBarProps {
    host: SheetActionHost;
    api: ActionPanelApi;
    /** The selected row. */
    r: number;
    /** The action column's key. */
    columnKey: string;
    /** How the row is named, and its words beside it (X5). */
    name: string | undefined;
    title: string | undefined;
    registers: SheetRegisterIndex;
    /** Whether the row takes actions here: not on a read-only sheet, an owned row or a column that takes no edit (T9). */
    writable: boolean;
}

/** The most cases the bar's buttons show before More… (X6). */
const BAR_MAX = 4;

/** A value with one field along a path set. */
function setAt(value: unknown, path: readonly string[], to: unknown): unknown {
    if (path.length === 0) return to;
    const [head, ...rest] = path;
    const at = (value ?? {}) as Record<string, unknown>;
    return { ...at, [head!]: setAt(at[head!], rest, to) };
}

/** A field's value along a path. */
function getAt(value: unknown, path: readonly string[]): unknown {
    let at = value;
    for (const name of path) at = at === undefined || at === null ? undefined : (at as Record<string, unknown>)[name];
    return at;
}

/** What the bar shows: the row's buttons, the rest of them, or a case opened inside it. */
type BarView = { kind: "buttons" } | { kind: "more" } | { kind: "choice"; c: ActionCase } | { kind: "form"; c: ActionCase };

/** Renders a phone's action bar for the selected row. */
export const ActionBar = memo(function ActionBar({ host, api, r, columnKey, name, title, registers, writable }: ActionBarProps) {
    const styles = useSlotStyles("sheetAction");
    const button = useRecipe({ key: "button" });
    const { m } = useSheetWords();
    const seq = useSyncExternalStore(host.subscribe, host.version, host.version);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `seq` is the host's say that what the offer reads moved
    const offer = useMemo(() => host.offer(r, columnKey), [host, r, columnKey, seq]);
    const [view, setView] = useState<BarView>({ kind: "buttons" });
    const [value, setValue] = useState<unknown>(undefined);
    const valueRef = useRef<unknown>(undefined);
    const [missing, setMissing] = useState(false);
    const onChange = useCallback((path: readonly string[], to: unknown) => {
        valueRef.current = setAt(valueRef.current, path, to);
        setValue(valueRef.current);
        setMissing(false);
    }, []);
    const options = useMemo(() => {
        const out: Record<string, FieldOption[]> = {};
        for (const [reg, members] of registers.byName) out[reg] = members.map((mm) => ({ key: mm.key, label: mm.label === "" ? mm.key : mm.label }));
        return out;
    }, [registers]);
    if (offer === undefined) return null;
    const controls = writable;
    const may = canTake(offer);
    const why = offer.incomplete !== undefined ? m.actionIncomplete({ fields: offer.incomplete }) : offer.blocked;
    const eyebrow = [name, title].filter((t) => t !== undefined && t !== "").join(" · ");
    const take = (c: ActionCase, v: unknown) => { if (api.take(r, columnKey, c, v)) setView({ kind: "buttons" }); };
    const open = (c: ActionCase) => {
        if (c.kind === "button") { take(c, null); return; }
        if (c.kind === "choice") { setView({ kind: "choice", c }); return; }
        const form = c.take.type === "form" ? c.take.value : undefined;
        const initial = api.initial(r, columnKey, c);
        valueRef.current = form?.scalar === true ? { [c.name]: initial } : initial;
        setValue(valueRef.current);
        setMissing(false);
        setView({ kind: "form", c });
    };
    const caseButton = (c: ActionCase, first: boolean) => (
        <chakra.button key={c.name} type="button" css={[button({ variant: "outline", size: "md" }), styles.barButton]} disabled={!may}
            data-bar-take={c.name} data-first={first ? "" : undefined} title={may ? undefined : why} onClick={() => open(c)}>
            {c.icon !== undefined && <chakra.span data-check={c.icon === "check" ? "" : undefined}><FontAwesomeIcon icon={["fas", c.icon as IconName]} aria-hidden /></chakra.span>}
            {verbOf(c)}
        </chakra.button>
    );
    // A case opened inside the bar (X7): ← back, its eyebrow, then its reasons or its fields.
    if (view.kind === "choice" || view.kind === "form") {
        const c = view.c;
        const back = (
            <chakra.div css={styles.barHead}>
                <chakra.button type="button" css={[button({ variant: "ghost", size: "md" }), styles.barBack]} aria-label={m.actionBarBack()} data-bar-back=""
                    onClick={() => setView({ kind: "buttons" })}>
                    <FontAwesomeIcon icon={faArrowLeft} aria-hidden />
                </chakra.button>
                <chakra.span css={styles.barEyebrow}>{m.actionFormEyebrow({ verb: c.label, name })}</chakra.span>
            </chakra.div>
        );
        if (c.kind === "choice") {
            const choices = c.take.type === "menu" ? c.take.value.map((o) => ({ id: o.case, label: o.label, value: variant(o.case, null) as unknown }))
                : c.take.type === "register" ? (registers.byName.get(c.take.value) ?? []).map((mm) => ({ id: mm.key, label: mm.label === "" ? mm.key : mm.label, value: mm.key as unknown }))
                    : [];
            return (
                <chakra.div css={styles.bar} data-sheet-action-bar="choice" data-case={c.name} role="group" aria-label={m.actionMenuChoice({ verb: c.label })}>
                    {back}
                    {choices.map((choice) => (
                        <chakra.button key={choice.id} type="button" css={[button({ variant: "ghost", size: "md" }), styles.barChoice]} data-bar-choice={choice.id}
                            onClick={() => take(c, choice.value)}>
                            {choice.label}
                        </chakra.button>
                    ))}
                </chakra.div>
            );
        }
        const form = c.take.type === "form" ? c.take.value : undefined;
        const specs: readonly FieldSpecValue[] = form?.specs ?? [];
        const caseOf = (v: unknown): unknown => (form?.scalar === true ? getAt(v, [c.name]) : v);
        const takeForm = () => {
            const now = valueRef.current;
            if (specs.some((spec) => !spec.optional && getAt(now, spec.path) === undefined)) { setMissing(true); return; }
            take(c, caseOf(now));
        };
        return (
            <chakra.div css={styles.bar} data-sheet-action-bar="form" data-case={c.name}>
                {back}
                <FieldForm specs={specs} value={value} options={options} onChange={onChange} />
                {missing && <chakra.span css={styles.formError} role="alert">{m.issueRequired()}</chakra.span>}
                <chakra.span css={styles.barConsequence}>{api.consequence(r, columnKey, c, caseOf(value))}</chakra.span>
                <chakra.div css={styles.barRest} data-bar-foot="">
                    <chakra.button type="button" css={[button({ variant: "outline", size: "md" }), styles.barButton]} onClick={() => setView({ kind: "buttons" })}>{m.actionFormCancel()}</chakra.button>
                    <chakra.button type="button" css={[button({ variant: "outline", size: "md" }), styles.barButton]} data-bar-take-form="" onClick={takeForm}>{c.label}</chakra.button>
                </chakra.div>
            </chakra.div>
        );
    }
    const [first, ...rest] = offer.offered;
    // More than four offered: two of the rest and More…, which lists the others inside the bar (X6).
    const folded = offer.offered.length > BAR_MAX;
    const shown = view.kind === "more" ? rest : folded ? rest.slice(0, 2) : rest;
    const consequence = first !== undefined && first.kind === "button" ? api.consequence(r, columnKey, first, null) : undefined;
    return (
        <chakra.div css={styles.bar} data-sheet-action-bar="buttons">
            <chakra.div css={styles.barHead}>
                <chakra.span css={styles.barEyebrow} data-bar-eyebrow="">{eyebrow}</chakra.span>
                <chakra.span css={[styles.state, styles.barState]} data-tone={offer.state?.tone} data-bar-state="">
                    <chakra.span css={styles.dot} aria-hidden="true" />
                    {offer.state?.state ?? m.actionNotStarted()}
                </chakra.span>
            </chakra.div>
            {controls && first !== undefined && (
                <>
                    {view.kind !== "more" && <chakra.div css={styles.barFirst}>{caseButton(first, true)}</chakra.div>}
                    {(shown.length > 0 || folded) && (
                        <chakra.div css={styles.barRest} style={{ ["--action-rest" as string]: String(Math.min(3, shown.length + (folded && view.kind !== "more" ? 1 : 0))) }}>
                            {shown.map((c) => caseButton(c, false))}
                            {folded && view.kind !== "more" && (
                                <chakra.button type="button" css={[button({ variant: "outline", size: "md" }), styles.barButton]} data-bar-more="" onClick={() => setView({ kind: "more" })}>
                                    <FontAwesomeIcon icon={faEllipsis} aria-hidden />
                                    {m.actionBarMore()}
                                </chakra.button>
                            )}
                        </chakra.div>
                    )}
                    {!may && why !== undefined && <chakra.span css={styles.barConsequence} data-bar-why="">{why}</chakra.span>}
                    {may && consequence !== undefined && <chakra.span css={styles.barConsequence} data-bar-consequence="">{consequence}</chakra.span>}
                </>
            )}
        </chakra.div>
    );
});
