/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useCallback, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faMinus } from "@fortawesome/free-solid-svg-icons";
import { Box, Button, chakra, useSlotRecipe } from "@chakra-ui/react";
import { EastChakraComponent, FieldForm, useTrackedEvaluation, type BuilderFrameDock } from "@elaraai/east-ui-components";
import { ScheduleInspectorHead } from "../shared/schedule/inspector-head.js";
import { Seg } from "../shared/schedule/segments.js";
import { AssignmentActions, AssignmentFields, PlaceAction, RequirementFields, TimesFields, dutyForm, type DutyFormValue } from "./controls.js";
import { CoverageView, ProposalCard, assignmentName, costed, dismissible, money, type RosterViewsProps } from "./views.js";
import type { RolesChange } from "./actions.js";
import type { RosterFind } from "./fit.js";
import {
    DAY, costsOf, dayOfSlot, groupSkills, requirementOf, sameSlot, viewTotals, type Assignment, type Issue, type Person, type PlacedDuties, type PlacedTargets,
    type RosterStyles, type Slot,
} from "./model.js";

/** The Find fixes, as the inspector offers them (#1334): only with the app's fit, and reading `Finding…` while their find is asked. */
export interface FindFixes {
    /** Whether the app bound a fit: without one no Find fix is offered, though `Roster.check` still reports its issue (R2). */
    offered: boolean;
    /** Whether this find is asked and its answer has not landed (R4). */
    finding: (asked: RosterFind) => boolean;
}
type Args = RosterViewsProps & {
    storageKey: string; tab: string; onTab: (tab: string) => void; find: FindFixes;
    /** The week's duties as drafted, and as stored: each one's row. */
    duties: PlacedDuties; heldDuties: PlacedDuties;
    /** The week's targets as drafted: each slot's row. */
    targets: PlacedTargets;
};
function fixLabel(issue: Issue, props: Args) {
    if (issue.fix.type === "none") return "";
    const fix = issue.fix.value;
    switch (fix.type) {
        case "accept": return "Accept";
        case "request": return "Request agency";
        case "move": return `Move to ${props.value.shifts.find(s => s.key === fix.value)?.label ?? fix.value}`;
        case "start": return `Start at ${props.format.time(fix.value)}`;
        case "find": return issue.slot.type === "some" && props.find.finding({ need: fix.value, slot: issue.slot.value }) ? "Finding…"
            : fix.value.type === "skill" ? "Find skilled staff" : fix.value.type === "leads" ? "Find a lead" : "Find a trainer";
    }
}
export function RosterIssues({ props, issues }: { props: Args; issues: readonly Issue[] }) {
    return <>{issues.map((issue, index) => <Box key={index} css={props.styles.issue} data-tone={issue.tone.type} data-roster-issue={issue.kind.type}>
        <chakra.button type="button" css={props.styles.issueTitle} onClick={() => {
            if (issue.slot.type === "some") props.setView({ ...props.view, date: props.start.getTime() + Number(issue.slot.value.day) * DAY });
            if (issue.assignment.type === "some") props.select({ type: "assignment", key: issue.assignment.value });
            else if (issue.fix.type === "some" && issue.fix.value.type === "accept") props.select({ type: "proposal", key: issue.fix.value.value });
            else if (issue.slot.type === "some") props.select({ type: "slot", slot: issue.slot.value });
        }}>{issue.title}</chakra.button><Box css={props.styles.issueDetail}>{issue.detail}</Box>
        {/* A find edits nothing, so it is offered on a week that can't be edited — but only with the app's fit, which decides who fits. */}
        {issue.fix.type === "some" && (issue.fix.value.type === "find" ? props.find.offered : props.commands.available) && <Box css={props.styles.issueActions}><Button size="xs" variant="outline" onClick={() => props.onError(props.commands.fix(issue))}>{fixLabel(issue, props)}</Button></Box>}
    </Box>)}</>;
}
function PersonFacts({ props, person, slot }: { props: Args; person: Person; slot?: Slot }) {
    const group = props.value.groups.find(g => g.key === (slot?.group ?? person.group));
    const skills = group === undefined ? undefined : groupSkills(props.value, group.key);
    const coverage = slot === undefined ? undefined : props.coverage.get(slot);
    const theirs = [...props.week.assignments].filter(([, a]) => a.who.type === "person" && a.who.value === person.key);
    const cost = costed(props.value) ? costsOf(props.pay, theirs.map(([id]) => id)).total : undefined;
    return <><Box css={props.styles.section}><Box css={props.styles.sectionHead}>Skills · {group?.label}</Box><Box css={props.styles.detail}>{skills?.filter(skill => person.skills.has(skill.key)).length} / {skills?.length} held</Box>
        {person.agency && person.skills.size === 0 && <Box css={props.styles.detail}>No skills recorded for agency staff.</Box>}
        {skills?.map(skill => <Box key={skill.key} css={props.styles.skillLine}><Box as="span" css={props.styles.flag} aria-label={person.skills.has(skill.key) ? "Skill held" : "Skill not held"}><FontAwesomeIcon icon={person.skills.has(skill.key) ? faCheck : faMinus} /></Box><span>{skill.label}</span><span /><span>{props.format.number(coverage?.lines.find(line => line.skill === skill.key)?.needed ?? 0)} h needed</span></Box>)}
    </Box><Box css={props.styles.section}><Box css={props.styles.sectionHead}>Week</Box><Box css={props.styles.detail}>{props.format.number(props.hours.get(person.key) ?? 0)} h / {props.format.number(person.contract)} h{cost !== undefined && ` · ${money(props.format, props.value, cost, false)}`}</Box>
        {Array.from({ length: 7 }, (_, day) => { const rows = theirs.filter(([, a]) => a.slot.day === BigInt(day)); return <Button key={day} size="xs" variant={props.day === day ? "outline" : "ghost"} onClick={() => { props.setView({ ...props.view, date: props.start.getTime() + day * DAY }); props.select(rows.length === 0 ? { type: "person", key: person.key } : { type: "assignment", key: rows[0]![0] }); }}>
            {props.format.weekday(new Date(props.start.getTime() + day * DAY))} · {rows.map(([, a]) => `${props.value.shifts.find(s => s.key === a.slot.shift)?.code} ${props.format.number(a.hours)} h`).join(" · ") || "Off"}
        </Button>; })}
    </Box></>;
}
/** A duty's pay, by the app's own codes (§5.6): each code's cost, and in all. */
function DutyPay({ props, id }: { props: Args; id: string }) {
    if (!costed(props.value)) return null;
    const costs = costsOf(props.pay, [id]);
    return <Box css={props.styles.section} data-roster-pay=""><Box css={props.styles.sectionHead}>Pay</Box>
        {costs.byCode.size === 0 ? <Box css={props.styles.detail}>No cost worked out.</Box>
            : <>{[...costs.byCode].map(([code, amount]) => <Box key={code} css={props.styles.detail}>{code} · {money(props.format, props.value, amount, false)}</Box>)}
                <Box css={props.styles.detail}>{money(props.format, props.value, costs.total, false)} in all</Box></>}
    </Box>;
}
/**
 * The duty's form: its roles the Roster edits — its times and, where its kind
 * maps them, its position and its activity — then the app's fields none of
 * them writes, in the kind's form (`fields`) or the kind's own inspector.
 */
function DutyForm({ props, assignment, id }: { props: Args; assignment: Assignment; id: string }) {
    const { onError, commands } = props;
    const kind = props.value.duty.kind;
    const row = props.duties.rows.get(id);
    const held = props.heldDuties.rows.get(id);
    const heldAssignment = props.held.assignments.get(id);
    const [error, setError] = useState<string>();
    const change = useCallback((next: RolesChange) => { const refused = commands.update(id, next); setError(refused); onError(refused); }, [commands, id, onError]);
    const form: DutyFormValue = dutyForm(assignment);
    const baseline = heldAssignment === undefined ? undefined : dutyForm(heldAssignment);
    const readOnly = !commands.available;
    // The app's own form for the duty: over its row, its writes guarded as every gesture is.
    const update = useCallback((bytes: Uint8Array): null => { onError(commands.row(id, bytes)); return null; }, [commands, onError, id]);
    const read = useCallback(() => kind.inspector.type === "some" && row !== undefined ? kind.inspector.value(row.bytes, update) : undefined, [kind.inspector, row, update]);
    const { result } = useTrackedEvaluation(read);
    const decoded = useMemo(() => row === undefined ? undefined : props.domain.decodeRow(row.bytes), [row, props.domain]);
    const baselineRow = useMemo(() => held === undefined ? undefined : props.domain.decodeRow(held.bytes), [held, props.domain]);
    return <>
        <TimesFields form={form} baseline={baseline} readOnly={readOnly} onChange={change} />
        <AssignmentFields assignment={assignment} form={form} baseline={baseline} value={props.value} readOnly={readOnly} onChange={change} />
        {error !== undefined && <Box css={props.styles.error} role="alert">{error}</Box>}
        {result.ok && result.value !== undefined ? <chakra.fieldset disabled={readOnly}><EastChakraComponent value={result.value} storageKey={`${props.storageKey}.duty.${id}`} /></chakra.fieldset>
            : decoded !== undefined && kind.fields.length > 0 && <FieldForm specs={kind.fields} value={decoded} baseline={baselineRow ?? {}} readOnly={readOnly}
                onChange={(path, next) => onError(commands.field(id, path, next))} />}
        {!result.ok && <Box css={props.styles.error} role="alert">The duty's form could not be rendered.</Box>}
    </>;
}
function OneAssignment({ props, id, assignment: a }: { props: Args; id: string; assignment: Assignment }) {
    const removed = !props.week.assignments.has(id), baseline = props.held.assignments.get(id);
    const changed = baseline === undefined || !props.domain.sameAssignment(baseline, a);
    const person = a.who.type === "person" ? props.value.people.find(p => p.key === a.who.value) : undefined;
    const state = removed ? "Removed · unsaved" : baseline === undefined ? "Added · unsaved" : !sameSlot(baseline.slot, a.slot) ? "Moved · unsaved" : changed ? "Edited · unsaved" : a.who.type === "request" ? "Requested · awaiting agency" : "Rostered";
    const position = props.value.positions.find(p => p.key === a.position);
    return <><ScheduleInspectorHead styles={props.styles} kind={{ name: `Duty · ${props.value.groups.find(g => g.key === a.slot.group)?.label} · ${props.value.shifts.find(s => s.key === a.slot.shift)?.label}`, icon: a.who.type === "request" ? "building" : "user" }} title={assignmentName(props.value, a)}
        when={`${position === undefined ? "" : `${position.label} · `}${props.format.weekdayDate(dayOfSlot(props.start, a.slot))}${person?.trainer ? " · trainer" : person?.trainee ? " · trainee" : ""}`} status={{ label: state, tone: { type: removed ? "warning" : "neutral" }, ring: changed }} pending={changed ? baseline === undefined ? "new" : "pending" : undefined} />
        {!removed && <RosterIssues props={props} issues={props.issues.filter(issue => issue.assignment.type === "some" && issue.assignment.value === id)} />}
        {!removed && <Box css={props.styles.fields}><Box css={props.styles.sectionHead}>Shift</Box>
            <Seg fullWidth label="Duty shift" scope="roster" name="assignment-shift" active={a.slot.shift} items={props.value.shifts.map(s => ({ key: s.key, label: s.label, disabled: !props.commands.available }))} onPick={shift => props.onError(props.commands.place({ type: "assignment", key: id }, { ...a.slot, shift }))} />
            <Box css={props.styles.detail}>{props.format.time(a.start)}–{props.format.time(a.end)} · {props.format.number(a.hours)} h{props.format.weekday(a.end) !== props.format.weekday(a.start) && " · ends next day"}</Box>
            <DutyForm props={props} assignment={a} id={id} />
        </Box>}
        {!removed && <DutyPay props={props} id={id} />}
        {person !== undefined && <PersonFacts props={props} person={person} slot={a.slot} />}
        <Box css={props.styles.section}><AssignmentActions id={id} assignment={a} removed={removed} value={props.value} start={props.start} commands={props.commands} styles={props.styles} /></Box>
    </>;
}
/** A slot's targets: the targets' own form where the app gives one, over the slot's row — or a new one — else the Roster's. */
function Targets({ props, slot }: { props: Args; slot: Slot }) {
    const kind = props.value.targets.type === "some" ? props.value.targets.value : undefined;
    const form = kind?.inspector.type === "some" ? kind.inspector.value : undefined;
    const target = requirementOf(props.week, slot);
    const row = props.targets.rows.get(slot);
    // A slot with no target row yet: a new one for the form to start from, written only once the form writes it.
    const bytes = useMemo(() => row?.bytes ?? (kind === undefined || form === undefined ? undefined
        : kind.create({ day: dayOfSlot(props.start, slot), group: slot.group, shift: slot.shift, positions: target.positions, hours: target.hours })), [row, kind, form, props.start, slot, target]);
    const update = useCallback((next: Uint8Array): null => { props.onError(props.commands.targetRow(slot, next)); return null; }, [props, slot]);
    const read = useCallback(() => form !== undefined && bytes !== undefined ? form(bytes, update) : undefined, [form, bytes, update]);
    const { result } = useTrackedEvaluation(read);
    if (kind === undefined) return <Box css={props.styles.detail}>This roster has no targets.</Box>;
    return <>{result.ok && result.value !== undefined ? <chakra.fieldset disabled={!props.commands.available}><EastChakraComponent value={result.value} storageKey={`${props.storageKey}.requirement`} /></chakra.fieldset>
        : <RequirementFields value={props.value} week={props.week} held={props.held} slot={slot} commands={props.commands} styles={props.styles} />}
        {!result.ok && <Box role="alert" css={props.styles.error}>The targets form could not be rendered.</Box>}</>;
}
function OneSlot({ props, slot }: { props: Args; slot: Slot }) {
    const c = props.coverage.get(slot); if (c === undefined) return <Box css={props.styles.empty}>This shift is no longer configured.</Box>;
    const shift = props.value.shifts.find(s => s.key === slot.shift)!;
    return <><ScheduleInspectorHead styles={props.styles} kind={{ name: `Shift · ${props.value.groups.find(g => g.key === slot.group)?.label} · ${props.format.weekday(dayOfSlot(props.start, slot))}`, icon: "clock" }} title={shift.label}
        when={`${c.filled} / ${c.positions} positions · ${props.format.number(c.hours.rostered)} of ${props.format.number(c.hours.needed)} h`} status={{ label: c.hours.rostered < c.hours.needed ? `${props.format.number(c.hours.needed - c.hours.rostered)} h short` : "Covered", tone: { type: c.hours.rostered < c.hours.needed ? "warning" : "success" }, ring: false }} />
        <RosterIssues props={props} issues={props.issues.filter(i => i.slot.type === "some" && sameSlot(i.slot.value, slot))} />
        <Box css={props.styles.section}><Box css={props.styles.sectionHead}>Coverage</Box><CoverageView coverage={c} value={props.value} styles={props.styles} format={props.format} />
            <Box css={props.styles.detail}>Permanent · Agency staff · Requested · Open · Needed</Box></Box>
        <Box css={props.styles.fields}><Box css={props.styles.sectionHead}>Targets</Box><Targets props={props} slot={slot} /></Box>
        <Box css={props.styles.section}><Box css={props.styles.sectionHead}>Roster</Box><Box css={props.styles.detail}>{String(c.filled)} filled · {String(c.open)} open · {c.lead ? "Lead assigned" : "No lead"} · {c.trainer ? "Trainer assigned" : "No trainer"}</Box>
            {costed(props.value) && <Box css={props.styles.detail}>{money(props.format, props.value, c.cost, false)}</Box>}<PlaceAction label="Assign person" slot={slot} value={props.value} start={props.start} commands={props.commands} styles={props.styles} /></Box>
    </>;
}
function Summary({ props }: { props: Args }) {
    const totals = viewTotals(props.coverage, props.view, props.day);
    const { days } = totals;
    const visible = props.value.visiblePeople;
    const filtered = visible.type === "some" && props.value.people.some(person => !visible.value.has(person.key));
    // The view's duties' costs, by the app's codes: the Summary's cost line under its total.
    const shown = [...props.week.assignments].flatMap(([id, a]) => days === 7 || Number(a.slot.day) === props.day ? [id] : []);
    const costs = costsOf(props.pay, shown);
    const breaches = props.issues.filter(i => i.kind.type === "breach").length, gaps = props.issues.filter(i => i.kind.type === "gap").length;
    const stats = [
        { label: "Cost", value: money(props.format, props.value, costs.total, false), sub: [...costs.byCode].map(([code, amount]) => `${code} ${money(props.format, props.value, amount)}`).join(" · ") },
        { label: "Positions", value: `${totals.filled} / ${totals.positions}`, sub: `${totals.open} open` },
        { label: "Hours", value: `${props.format.number(totals.hours)} h`, sub: `of ${props.format.number(totals.needed)} h needed` },
        { label: "Issues", value: String(breaches + gaps), sub: `${breaches} breaches · ${gaps} gaps` },
    ];
    return <><ScheduleInspectorHead styles={props.styles} kind={{ name: days === 1 ? `Day · ${props.format.weekdayDate(new Date(props.view.date))}` : `Week · ${props.format.range(props.start, new Date(props.start.getTime() + 6 * DAY))}`, icon: "calendar-week" }} title="Roster" when={`${props.value.groups.length} groups · ${props.value.shifts.length} shifts`} />
        <Box css={props.styles.summary}>{stats.filter(s => s.label !== "Cost" || costed(props.value)).map(stat => <Box key={stat.label} css={props.styles.stat}><Box css={props.styles.statLabel}>{stat.label}</Box><Box css={props.styles.statValue}>{stat.value}</Box><Box css={props.styles.detail}>{stat.sub}</Box></Box>)}</Box>
        {filtered && visible.type === "some" && <Box css={props.styles.section}><Box css={props.styles.detail}>{props.format.number(visible.value.size)} of {props.format.number(props.value.people.length)} people visible · Coverage includes all staff</Box></Box>}
        {props.proposals.length > 0 && <Box css={props.styles.section}><Box css={props.styles.sectionHead}>Proposals</Box>{props.proposals.map(proposal => <ProposalCard key={proposal.key} props={props} proposal={proposal} />)}</Box>}
        <Box css={props.styles.section}><Box css={props.styles.detail}>Select a person or shift to inspect its details.</Box><Box css={props.styles.detail}>Use the Library to assign people and activities.</Box><Box css={props.styles.detail}>Warnings help plan the week and do not prevent saving.</Box><Box css={props.styles.detail}>Save drafts as you work; publish the week when it is ready.</Box></Box>
    </>;
}
function Details({ props }: { props: Args }) {
    const selection = props.selection;
    if (selection?.type === "assignment") { const a = props.week.assignments.get(selection.key) ?? props.held.assignments.get(selection.key); if (a !== undefined) return <OneAssignment key={selection.key} props={props} id={selection.key} assignment={a} />; }
    if (selection?.type === "slot" || selection?.type === "requirement") return <OneSlot props={props} slot={selection.slot} />;
    if (selection?.type === "proposal") {
        const p = props.proposals.find(p => p.key === selection.key);
        if (p !== undefined) return <><ScheduleInspectorHead styles={props.styles} kind={{ name: "Model proposal", icon: "wand-magic-sparkles" }} title={props.value.people.find(person => person.key === p.person)?.name ?? p.person}
            when={`${props.value.groups.find(g => g.key === p.slot.group)?.label} · ${props.value.shifts.find(s => s.key === p.slot.shift)?.label} · ${props.format.weekdayDate(dayOfSlot(props.start, p.slot))}`} />
            <Box css={props.styles.section}><Box css={props.styles.title}>Why this duty</Box><Box css={props.styles.detail}>{p.reason}</Box>
                {props.commands.available && <Box css={props.styles.actions}><Button size="xs" variant="outline" onClick={() => props.onError(props.commands.accept(p.key))}>Accept proposal</Button>{dismissible(props.value) && <Button size="xs" variant="ghost" onClick={() => props.commands.reject(p.key)}>Reject proposal</Button>}</Box>}
            </Box></>;
    }
    if (selection?.type === "person") {
        const person = props.value.people.find(p => p.key === selection.key);
        if (person !== undefined) return <><ScheduleInspectorHead styles={props.styles} kind={{ name: `Person · ${props.value.groups.find(g => g.key === person.group)?.label}`, icon: "user" }} title={person.name} when={props.value.positions.find(p => p.key === person.position)?.label} />
            <PersonFacts props={props} person={person} /><Box css={props.styles.section}><PlaceAction label="Assign person" source={{ type: "person", key: person.key }} slot={{ day: BigInt(props.day), group: person.group, shift: person.usual.type === "some" ? person.usual.value : props.value.shifts[0]!.key }} value={props.value} start={props.start} commands={props.commands} styles={props.styles} /></Box></>;
    }
    if (selection?.type === "group" || selection?.type === "shift") {
        const group = props.value.groups.find(g => selection.type === "group" && g.key === selection.key), shift = props.value.shifts.find(s => selection.type === "shift" && s.key === selection.key);
        return <><ScheduleInspectorHead styles={props.styles} kind={{ name: group === undefined ? "Shift" : "Group", icon: "table-columns" }} title={group?.label ?? shift?.label ?? "Selection"} when={shift === undefined ? "Totals by shift" : `${props.format.number(shift.hours)} h · totals by group`} />
            {[...props.coverage].filter(([slot]) => (props.view.layout === "people" || props.view.period === "week" || Number(slot.day) === props.day) && (group === undefined ? slot.shift === selection.key : slot.group === selection.key)).map(([slot, c], i) => <Box key={i} css={props.styles.section}><Box css={props.styles.title}>{props.format.weekday(dayOfSlot(props.start, slot))} · {props.value.groups.find(g => g.key === slot.group)?.label} · {props.value.shifts.find(s => s.key === slot.shift)?.label}</Box><Box css={props.styles.detail}>{String(c.filled)} / {String(c.positions)} positions · {props.format.number(c.hours.rostered)} of {props.format.number(c.hours.needed)} h</Box></Box>)}
        </>;
    }
    return <Summary props={props} />;
}
/** Inspector structure and headings reuse Plan's slots; no implementation paths appear in the UI. */
export function useRosterInspector(args: Args): BuilderFrameDock | undefined {
    const recipe = useSlotRecipe({ key: "planInspector" });
    const styles = { ...args.styles, ...recipe({}), summary: args.styles.summary, section: args.styles.section, detail: args.styles.detail } as unknown as RosterStyles;
    if (!args.value.inspector) return undefined;
    const props = { ...args, styles };
    return { label: "Inspector", icon: "sliders", size: "320px", persist: "local", active: args.selection !== undefined,
        badge: String(args.issues.length), tab: args.tab, onTabChange: args.onTab,
        tabs: [{ key: "details", label: "Details", body: <Box css={styles.root} data-roster-inspector="details"><Details props={props} /></Box> },
            { key: "issues", label: "Issues", count: String(args.issues.length), body: <Box css={styles.root} data-roster-inspector="issues">
                {args.issues.length === 0 && <Box css={styles.empty}>No issues in view.</Box>}
                {(["breach", "gap", "proposal"] as const).map(kind => { const issues = args.issues.filter(i => i.kind.type === kind); return issues.length === 0 ? null : <FragmentGroup key={kind} props={props} kind={kind} issues={issues} />; })}
            </Box> }],
    };
}
function FragmentGroup({ props, kind, issues }: { props: Args; kind: string; issues: readonly Issue[] }) {
    return <><Box css={props.styles.section}><Box css={props.styles.sectionHead}>{kind === "breach" ? "Breaches" : kind === "gap" ? "Gaps" : "Model proposals"} · {issues.length}</Box></Box><RosterIssues props={props} issues={issues} /></>;
}
