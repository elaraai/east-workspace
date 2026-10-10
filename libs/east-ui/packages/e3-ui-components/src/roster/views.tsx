/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { Fragment, memo, useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Box, Button, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faClock, faChevronDown, faChevronRight, faGripVertical, faRotateLeft, faXmark } from "@fortawesome/free-solid-svg-icons";
import { none, variant } from "@elaraai/east";
import { VirtualRows } from "@elaraai/east-ui-components/internal";
import { tickFormatOf, useDragEventChip, useDropCell, usePersistedState, type CellCoord, type DragPayload, type Formatters } from "@elaraai/east-ui-components";
import { MoveGhost } from "../shared/schedule/move-ghost.js";
import { Seg } from "../shared/schedule/segments.js";
import { AssignmentActions, PlaceAction, RequirementAction } from "./controls.js";
import { readRosterSource } from "./identity.js";
import { rosterCoord, type RosterDrag } from "./drag.js";
import type { RosterCommands } from "./actions.js";
import { DAY, assignmentTimes, sameAssignment, sameSlot, slotKey, type Assignment, type Coverage, type Issue, type Proposal, type RosterStyles, type RosterValue, type RosterView, type Selection, type Slot, type Week } from "./model.js";

export interface RosterViewsProps {
    value: RosterValue; week: Week; held: Week | undefined; start: Date; day: number; view: RosterView; setView: (view: RosterView) => void;
    styles: RosterStyles; format: Formatters; narrow: boolean; coverage: ReadonlyMap<Slot, Coverage>; hours: ReadonlyMap<string, number>;
    issues: readonly Issue[]; proposals: readonly Proposal[]; selection: Selection | undefined; select: (next: Selection | undefined) => void;
    commands: RosterCommands; drag: RosterDrag; onError: (error: string | undefined) => void;
}
export function assignmentName(value: RosterValue, a: Assignment): string {
    return a.who.type === "person" ? value.people.find(p => p.key === a.who.value)?.name ?? a.who.value
        : `Requested · ${value.agencies.find(p => p.key === a.who.value)?.name ?? a.who.value}`;
}
export function money(format: Formatters, value: RosterValue, amount: number): string {
    return value.costs.type === "some" ? format.value(amount, tickFormatOf(variant("currency", { code: value.costs.value.currency, compact: true }))) : format.number(amount);
}
function visible(value: RosterValue, a: Assignment) { return a.who.type === "request" || value.visiblePeople.type === "none" || value.visiblePeople.value.has(a.who.value); }
function selectedSlot(selection: Selection | undefined, slot: Slot) { return (selection?.type === "slot" || selection?.type === "requirement") && sameSlot(selection.slot, slot); }
function matchingAssignments(props: RosterViewsProps, matches: (a: Assignment) => boolean) {
    const rows = [...props.week.assignments].filter(([, a]) => matches(a)).map(([id, a]) => ({ id, a, removed: false }));
    for (const [id, a] of props.held?.assignments ?? []) if (!props.week.assignments.has(id) && matches(a)) rows.push({ id, a, removed: true });
    return rows;
}
function assignments(props: RosterViewsProps, slot: Slot) {
    const rows = matchingAssignments(props, a => sameSlot(a.slot, slot) && visible(props.value, a));
    const rank = (a: Assignment) => a.who.type === "request" ? 1000 : props.value.people.find(p => p.key === a.who.value)?.agency ? 999 : props.value.positions.find(p => p.key === a.position)?.lead ? props.value.positions.findIndex(p => p.key === a.position) : props.value.positions.length;
    return rows.sort((a, b) => rank(a.a) - rank(b.a));
}
/** The same coverage bar and skill lines appear in a day cell and the inspector. */
export function CoverageView({ coverage: c, value, styles, format, compact = false }: { coverage: Coverage; value: RosterValue; styles: RosterStyles; format: Formatters; compact?: boolean }) {
    const max = Math.max(c.hours.needed, c.hours.rostered, 1);
    let left = 0;
    const parts: { kind: "permanent" | "agency" | "overtime" | "requested" | "open"; width: number; left: number }[] = (["permanent", "agency", "overtime", "requested"] as const).map(kind => { const width = c.hours[kind]; const part = { kind, width, left }; left += width; return part; });
    if (c.hours.needed > left) parts.push({ kind: "open", left, width: c.hours.needed - left });
    if (c.hours.needed === 0 && c.hours.rostered === 0) return <Box css={styles.empty}>No work · no hours targeted</Box>;
    return <>
        <Box css={styles.coverageHead}><Box as="span" css={styles.metric}>{format.number(c.hours.needed)} h</Box><Box as="span" css={styles.detail}>needed</Box>
            <Box as="span" css={styles.metric}>{format.number(c.hours.rostered)} h</Box><Box as="span" css={styles.detail}>rostered</Box>
            <Box as="span" css={styles.delta} data-tone={c.hours.rostered < c.hours.needed ? "warning" : undefined}>{c.hours.rostered >= c.hours.needed ? "+" : ""}{format.number(c.hours.rostered - c.hours.needed)} h</Box></Box>
        <Box css={styles.coverageBar} role="img" aria-label={`${format.number(c.hours.rostered)} hours rostered of ${format.number(c.hours.needed)} needed`}>
            {parts.filter(p => p.width > 0).map(part => <Box key={part.kind} css={styles.coverageSegment} data-kind={part.kind} style={{ left: `${part.left / max * 100}%`, width: `${part.width / max * 100}%` }} />)}
            <Box css={styles.coverageTick} style={{ left: `${c.hours.needed / max * 100}%` }} />
        </Box>
        <Box css={styles.detail}>{parts.filter(p => p.kind !== "open" && p.width > 0).map(p => `${format.number(p.width)} ${p.kind === "permanent" ? "perm" : p.kind === "overtime" ? "OT" : p.kind}`).join(" · ") || "Nothing rostered"} h{value.costs.type === "some" && ` · ${money(format, value, c.cost)}`}</Box>
        {!compact && c.lines.map(line => { const activity = [...value.groups.flatMap(g => g.skills), ...value.duties].find(a => a.key === line.skill); return <Box key={line.skill} css={styles.skillLine} data-tone={line.gap > 0 ? "warning" : line.assigned >= line.needed ? "success" : undefined}
            title={`${activity?.label ?? line.skill} · ${format.number(line.assigned)} h assigned of ${format.number(line.needed)} h needed${line.capacity.type === "some" ? ` · ${format.number(line.capacity.value)} h capacity` : ""}`}>
            <Box as="span" css={styles.skillCode}>{activity?.code}</Box><span>{activity?.label ?? line.skill}</span><Box as="span" css={styles.skillCode}>{line.holders.type === "some" ? `${line.holders.value}/${c.people}` : "—"}</Box><span>{format.number(line.assigned)} / {format.number(line.needed)}</span>
        </Box>; })}
    </>;
}
interface AssignmentChipProps { props: RosterViewsProps; id: string; assignment: Assignment; removed: boolean; short?: boolean }
/** Keep the shared drag hooks outside the chip body: pointer motion does not repaint its contents. */
function AssignmentChip(args: AssignmentChipProps) {
    const { props, id, assignment: a, removed } = args;
    const { styles, value, drag } = props;
    const name = assignmentName(value, a);
    const coord = useMemo(() => ({ ...rosterCoord(drag.surface, a.slot, id), event: id }), [drag.surface, a.slot, id]);
    const ghost = useMemo(() => <MoveGhost styles={styles} label={name} />, [styles, name]);
    const enabled = drag.enabled && !removed;
    const handle = useDragEventChip(enabled ? coord : null, ghost, !enabled, name);
    const drop = useDropCell(enabled ? coord : null, !enabled, event => drag.run(event, true) === undefined, undefined, { caption: drag.caption });
    const dragRef = handle?.ref;
    const attach = useCallback((element: HTMLDivElement | null) => { dragRef?.(element); drop(element); }, [dragRef, drop]);
    return <AssignmentChipBody {...args} handle={handle} attach={attach} />;
}
/** Chip state comes from the held week and the domain issues, never from a second draft store. */
const AssignmentChipBody = memo(function AssignmentChipBody({ props, id, assignment: a, removed, short = false, handle, attach }: AssignmentChipProps & {
    handle: ReturnType<typeof useDragEventChip>; attach: (element: HTMLDivElement | null) => void;
}) {
    const { styles, value, commands, drag } = props;
    const name = assignmentName(value, a);
    const enabled = drag.enabled && !removed;
    const person = a.who.type === "person" ? value.people.find(p => p.key === a.who.value) : undefined;
    const position = value.positions.find(p => p.key === a.position);
    const issues = removed ? [] : props.issues.filter(i => i.assignment.type === "some" && i.assignment.value === id);
    const activity = a.activity.type === "some" ? [...value.groups.flatMap(g => g.skills), ...value.duties].find(activity => activity.key === a.activity.value) : undefined;
    const baseline = props.held?.assignments.get(id);
    const drafted = removed || baseline === undefined || !sameAssignment(baseline, a);
    const time = assignmentTimes(a, value, props.start);
    const skills = value.groups.find(g => g.key === a.slot.group)?.skills ?? [];
    const label = `${name}${time === undefined ? "" : ` · ${props.format.time(time.from)}–${props.format.time(time.to)}`}${removed ? " · removed" : ""}`;
    return <Box {...handle} ref={attach} css={styles.assignment} tabIndex={0} role="button" aria-label={label} title={label} aria-pressed={props.selection?.type === "assignment" && props.selection.key === id}
        data-roster-assignment={id} data-layout={short ? "people" : "shifts"} data-added={baseline === undefined ? "" : undefined} data-moved={baseline !== undefined && !sameSlot(baseline.slot, a.slot) ? "" : undefined} data-density={value.settings.density.type} data-selected={props.selection?.type === "assignment" && props.selection.key === id ? "" : undefined}
        data-drafted={drafted ? "" : undefined} data-removed={removed ? "" : undefined} data-request={a.who.type === "request" ? "" : undefined} data-agency={person?.agency ? "" : undefined}
        data-tone={issues.some(i => i.tone.type === "danger") ? "danger" : issues.some(i => i.kind.type === "breach") ? "warning" : undefined} data-draggable={enabled ? "" : undefined}
        onClick={event => { event.stopPropagation(); props.select({ type: "assignment", key: id }); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); props.select({ type: "assignment", key: id }); } else handle?.onKeyDown?.(event); }}>
        {enabled && <Box as="span" css={styles.grip} data-roster-grip=""><FontAwesomeIcon icon={faGripVertical} /></Box>}
        <Box as="span" css={styles.badge} data-lead={position?.lead ? "" : undefined}>{a.who.type === "request" || person?.agency ? "AG" : position?.code || (person?.trainer ? "T" : "")}</Box>
        <Box css={styles.assignmentName} data-roster-assignment-name="">{short ? `${value.shifts.find(s => s.key === a.slot.shift)?.code ?? a.slot.shift}${person?.group !== a.slot.group ? ` · ${value.groups.find(g => g.key === a.slot.group)?.label ?? a.slot.group}` : ""}` : name}</Box>
        {issues.filter(i => i.flag.type === "some").map((i, n) => <Box as="span" key={n} css={styles.flag} data-tone={i.tone.type}>{i.flag.type === "some" && i.flag.value}</Box>)}
        {a.overtime !== 0 && <Box as="span" css={styles.flag}>+{props.format.number(a.overtime)}h OT</Box>}
        {a.offset !== 0 && <Box as="span" css={styles.flag}>{a.offset > 0 ? "late +" : "early "}{props.format.number(a.offset)}h</Box>}
        {(a.offset !== 0 || a.overtime !== 0) && <Box as="span" css={styles.flag} aria-label={a.agreed.type === "some" && a.agreed.value ? "Agreed" : "To agree"}><FontAwesomeIcon icon={a.agreed.type === "some" && a.agreed.value ? faCheck : faClock} /></Box>}
        {person !== undefined && !short && <><Box as="span" css={styles.activity} data-empty={activity === undefined ? "" : undefined} title={activity?.label ?? "No activity"}>{activity?.code ?? "·"}</Box>{activity !== undefined && commands.editing.available && !removed && <chakra.button type="button" css={styles.chipAction} data-roster-chip-action="" aria-label={`Clear activity for ${name}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); props.onError(commands.activity(id, none)); }}><FontAwesomeIcon icon={faXmark} /></chakra.button>}
            <Box as="span" css={styles.fit}>{value.settings.chipSkills ? `${skills.filter(s => person.skills.has(s.key)).length}/${skills.length}` : `${props.format.number(props.hours.get(person.key) ?? 0)}h`}</Box></>}
        {commands.editing.available && <chakra.button type="button" css={styles.chipAction} data-roster-chip-action="" aria-label={removed ? `Restore ${name}` : `Remove ${name}`}
            onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (removed) commands.restore(id); else commands.remove(id); }}><FontAwesomeIcon icon={removed ? faRotateLeft : faXmark} /></chakra.button>}
    </Box>;
});
/** No hook in the mobile branch registers a drag source or target. */
function DropSlot({ props, slot, children, compact = false }: { props: RosterViewsProps; slot: Slot; children: ReactNode; compact?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const [landing, setLanding] = useState<ReturnType<RosterDrag["preview"]>>();
    const drop = useDropCell(props.drag.enabled ? rosterCoord(props.drag.surface, slot) : null, !props.drag.enabled,
        event => props.drag.run(event, true) === undefined, undefined, { caption: props.drag.caption,
            onHover: (_x, _y, payload) => setLanding(props.drag.preview(rosterCoord(props.drag.surface, slot), payload, true)) });
    const attach = useCallback((element: HTMLDivElement | null) => { ref.current = element; drop(element); }, [drop]);
    // The shared target subscription can change on pointer motion; its body need not.
    return useMemo(() => <Box ref={attach} css={compact ? props.styles.weekCell : props.styles.cell} data-roster-slot={slotKey(slot)} data-selected={selectedSlot(props.selection, slot) ? "" : undefined} data-roster-landing-tone={landing?.tone} title={compact ? landing?.label : undefined}>
        {children}{!compact && landing !== undefined && <Box css={props.styles.landing} data-roster-landing="" data-tone={landing.tone}>{landing.label}</Box>}
    </Box>, [attach, compact, props, slot, landing, children]);
}
/** A desktop proposal is the mock's quiet inline chip; phones retain labelled actions. */
export function ProposalCard({ props, proposal }: { props: RosterViewsProps; proposal: Proposal }) {
    const name = props.value.people.find(p => p.key === proposal.person)?.name ?? proposal.person;
    const { styles } = props;
    const select = () => props.select({ type: "proposal", key: proposal.key });
    const accept = () => props.onError(props.commands.accept(proposal.key));
    const reject = () => props.commands.reject(proposal.key);
    const mark = <Box as="span" css={[styles.badge, styles.proposalMark]}>Model</Box>;
    const title = <chakra.button type="button" css={[styles.assignmentName, styles.proposalName]} onClick={select}>{name}</chakra.button>;
    const selected = props.selection?.type === "proposal" && props.selection.key === proposal.key;
    if (props.narrow) return <Box css={styles.card} data-roster-proposal={proposal.key} data-selected={selected ? "" : undefined}>
        <Box css={styles.actions}>{mark}{title}</Box><Box css={styles.detail}>{proposal.reason}</Box>
        {props.commands.editing.available && <Box css={styles.actions}><Button size="xs" variant="outline" onClick={accept}>Accept</Button><Button size="xs" variant="ghost" onClick={reject}>Reject</Button></Box>}
    </Box>;
    const open = (props.coverage.get(proposal.slot)?.open ?? 0n) > 0n;
    const shift = props.value.shifts.find(s => s.key === proposal.slot.shift);
    return <Box css={[styles.assignment, styles.proposal]} data-roster-proposal={proposal.key} data-selected={selected ? "" : undefined} data-density={props.value.settings.density.type} title={`Model proposal · ${proposal.reason}`}>
        {mark}{title}<Box as="span" css={[styles.detail, styles.proposalReason]}>{open ? "fills open" : `+${props.format.number(shift?.hours ?? 0)} h`}</Box>
        {props.commands.editing.available && <>
            <chakra.button type="button" css={[styles.chipAction, styles.proposalAction]} data-accept="" aria-label={`Accept proposal for ${name}`} title="Accept proposal" onClick={accept}><FontAwesomeIcon icon={faCheck} /></chakra.button>
            <chakra.button type="button" css={[styles.chipAction, styles.proposalAction]} aria-label={`Reject proposal for ${name}`} title="Reject proposal" onClick={reject}><FontAwesomeIcon icon={faXmark} /></chakra.button>
        </>}
    </Box>;
}
function SlotActions({ props, slot }: { props: RosterViewsProps; slot: Slot }) {
    if (!props.commands.editing.available) return null;
    return <Box css={props.styles.actions}><PlaceAction label="Assign person" slot={slot} value={props.value} start={props.start} commands={props.commands} styles={props.styles} />
        {props.value.agencies.map(agency => <Button key={agency.key} size="xs" variant="outline" onClick={() => props.onError(props.commands.place({ type: "agency", key: agency.key }, slot))}>Request {agency.name}</Button>)}
    </Box>;
}
function DayAssignments({ props, slot }: { props: RosterViewsProps; slot: Slot }) {
    const c = props.coverage.get(slot)!;
    const issues = props.issues.filter(i => i.slot.type === "some" && sameSlot(i.slot.value, slot) && (i.kind.type === "gap" || i.kind.type === "breach"));
    return <DropSlot props={props} slot={slot}>
        <chakra.button type="button" css={props.styles.cellHead} data-open={c.open > 0n ? "" : undefined} onClick={() => props.select({ type: "slot", slot })}>{String(c.filled)} / {String(c.positions)} positions{issues.length > 0 && ` · ${issues.length} issues`}</chakra.button>
        <Box css={props.styles.chips}>{assignments(props, slot).map(({ id, a, removed }) => <AssignmentChip key={id} id={id} assignment={a} removed={removed} props={props} />)}</Box>
        {props.proposals.filter(p => sameSlot(p.slot, slot) && (props.value.visiblePeople.type === "none" || props.value.visiblePeople.value.has(p.person))).map(p => <ProposalCard key={p.key} props={props} proposal={p} />)}
        {c.open > 0n && <Box css={props.styles.openPosition}>{String(c.open)} open position{c.open === 1n ? "" : "s"}</Box>}
        <Box css={props.styles.dropStrip}><SlotActions props={props} slot={slot} />{props.value.inspector.type === "none" && <RequirementAction slot={slot} week={props.week} value={props.value} commands={props.commands} styles={props.styles} />}</Box>
    </DropSlot>;
}
function Shifts(props: RosterViewsProps) {
    const { state: collapsed, setState: setCollapsed } = usePersistedState<string[]>(`${props.drag.surface}.collapsed-groups`, []);
    const days = props.view.period === "week" ? Array.from({ length: 7 }, (_, d) => d) : [props.day];
    const columns = days.flatMap(day => props.value.shifts.map(shift => ({ day, shift })));
    const style = { "--roster-columns": columns.length } as CSSProperties;
    return <Box css={props.styles.scroll} data-roster-grid="shifts"><Box css={props.styles.grid} data-period={props.view.period} style={style}>
        <Box css={props.styles.head}>
            {props.view.period === "week" && <Box css={props.styles.row}><Box css={props.styles.gutter} />{days.map(day => <chakra.button type="button" key={day} css={props.styles.shiftHead} data-roster-column-header="" style={{ gridColumn: `span ${props.value.shifts.length}` }} data-week="" data-selected={props.day === day ? "" : undefined}
                onClick={() => props.setView({ ...props.view, period: "day", date: props.start.getTime() + day * DAY })}>{props.format.weekday(new Date(props.start.getTime() + day * DAY))} {new Date(props.start.getTime() + day * DAY).getUTCDate()}</chakra.button>)}</Box>}
            <Box css={props.styles.row}><Box css={[props.styles.gutter, props.styles.rowHead]}><Box css={props.styles.eyebrow}>Groups</Box><Box css={props.styles.detail}>{props.value.shifts.length} shifts</Box></Box>
                {columns.map(({ day, shift }) => { const at = props.start.getTime() + day * DAY + (Number(shift.start.hour) * 60 + Number(shift.start.minute)) * 60_000; const rows = [...props.coverage].filter(([slot]) => Number(slot.day) === day && slot.shift === shift.key).map(([, c]) => c); return <chakra.button type="button" key={`${day}.${shift.key}`} css={props.styles.shiftHead} data-roster-column-header="" data-week={days.length > 1 ? "" : undefined} onClick={() => props.select({ type: "shift", key: shift.key })}>
                    <Box css={props.styles.shiftLabel}>{days.length > 1 ? shift.code : shift.label}</Box>{days.length === 1 && <Box css={props.styles.time}>{props.format.time(new Date(at))}–{props.format.time(new Date(at + shift.hours * 3_600_000))}</Box>}{days.length === 1 && <Box css={props.styles.detail}>{props.format.number(rows.reduce((n, c) => n + c.filled, 0n))} / {props.format.number(rows.reduce((n, c) => n + c.positions, 0n))} positions · {props.format.number(rows.reduce((n, c) => n + c.hours.needed, 0))} h needed{props.value.costs.type === "some" && ` · ${money(props.format, props.value, rows.reduce((n, c) => n + c.cost, 0))}`}</Box>}
                </chakra.button>; })}</Box>
        </Box>
        {props.value.groups.map(group => { const coverage = [...props.coverage].filter(([slot]) => slot.group === group.key && days.includes(Number(slot.day))).map(([, c]) => c);
            const issues = props.issues.filter(i => i.slot.type === "some" && i.slot.value.group === group.key && days.includes(Number(i.slot.value.day)) && (i.kind.type === "breach" || i.kind.type === "gap"));
            const needed = coverage.reduce((n, c) => n + c.hours.needed, 0), rostered = coverage.reduce((n, c) => n + c.hours.rostered, 0);
            return <Fragment key={group.key}><chakra.button type="button" css={props.styles.group} data-roster-group={group.key} aria-expanded={!collapsed.includes(group.key)} onClick={() => setCollapsed(collapsed.includes(group.key) ? collapsed.filter(key => key !== group.key) : [...collapsed, group.key])}>
                <FontAwesomeIcon icon={collapsed.includes(group.key) ? faChevronRight : faChevronDown} /><Box as="span" css={props.styles.groupLabel}>{group.label}</Box><Box as="span" css={props.styles.detail}>{props.format.number(needed)} h needed · {props.format.number(rostered)} h rostered · {rostered >= needed ? "+" : ""}{props.format.number(rostered - needed)} h{props.value.costs.type === "some" && ` · ${money(props.format, props.value, coverage.reduce((n, c) => n + c.cost, 0))}`}</Box>{issues.length > 0 && <Box as="span" css={props.styles.flag} data-tone={issues.some(i => i.tone.type === "danger") ? "danger" : "warning"}>{issues.length} issues</Box>}
            </chakra.button>{!collapsed.includes(group.key) && <>
                {props.value.settings.requirements && <Box css={props.styles.row}><chakra.button type="button" css={[props.styles.gutter, props.styles.rowHead]} onClick={() => props.select({ type: "group", key: group.key })}><Box css={props.styles.eyebrow}>Requirement</Box><Box css={props.styles.title}>Work</Box><Box css={props.styles.detail}>hours by skill</Box><Box css={props.styles.detail}>{props.format.number(needed)} h needed</Box></chakra.button>
                    {columns.map(({ day, shift }) => { const slot = { day: BigInt(day), group: group.key, shift: shift.key }, c = props.coverage.get(slot)!; return <chakra.button type="button" key={slotKey(slot)} css={days.length > 1 ? props.styles.weekCell : props.styles.requirement} data-roster-requirement={slotKey(slot)} onClick={() => { props.select({ type: "requirement", slot }); if (days.length > 1) props.setView({ ...props.view, period: "day", date: props.start.getTime() + day * DAY }); }}>
                        {days.length > 1 ? <><Box css={props.styles.weekValue}>{props.format.number(c.hours.needed)}</Box><Box css={props.styles.weekFill}><Box css={props.styles.weekFillValue} style={{ width: `${Math.min(c.hours.rostered / Math.max(c.hours.needed, 1), 1) * 100}%` }} /></Box><Box css={props.styles.weekValue} data-tone={c.hours.rostered < c.hours.needed ? "warning" : undefined}>{props.format.number(c.hours.rostered - c.hours.needed)}</Box></> : <CoverageView coverage={c} value={props.value} styles={props.styles} format={props.format} compact={props.value.settings.density.type === "compact"} />}
                    </chakra.button>; })}</Box>}
                <Box css={props.styles.row}><chakra.button type="button" css={[props.styles.gutter, props.styles.rowHead]} onClick={() => props.select({ type: "group", key: group.key })}><Box css={props.styles.eyebrow}>Assignment</Box><Box css={props.styles.title}>Roster</Box><Box css={props.styles.detail}>{props.format.number(coverage.reduce((n, c) => n + c.people, 0n))} people</Box><Box css={props.styles.detail}>{props.format.number(rostered)} h</Box></chakra.button>
                    {columns.map(({ day, shift }) => { const slot = { day: BigInt(day), group: group.key, shift: shift.key }, c = props.coverage.get(slot)!; return days.length === 1 ? <DayAssignments key={slotKey(slot)} props={props} slot={slot} />
                        : <DropSlot key={slotKey(slot)} props={props} slot={slot} compact><chakra.button type="button" css={props.styles.weekValue} data-tone={c.open > 0n ? "warning" : undefined} aria-label={`${group.label} ${props.format.weekday(new Date(props.start.getTime() + day * DAY))} ${shift.label}, ${c.filled} of ${c.positions} positions`} onClick={() => { props.select({ type: "slot", slot }); props.setView({ ...props.view, period: "day", date: props.start.getTime() + day * DAY }); }}>{String(c.filled)}/{String(c.positions)}</chakra.button><Box css={props.styles.weekFill}><Box css={props.styles.weekFillValue} style={{ width: `${Math.min(Number(c.filled) / Math.max(Number(c.positions), 1), 1) * 100}%` }} /></Box>{props.issues.some(i => i.slot.type === "some" && sameSlot(i.slot.value, slot)) && <Box css={props.styles.issueDot} aria-label="Shift has issues" />}</DropSlot>; })}
                </Box>
            </>}</Fragment>;
        })}
    </Box></Box>;
}
/** The People grid resolves a day drop to the dragged person's same/usual shift. */
function PersonDay({ props, person, group, day, children }: { props: RosterViewsProps; person: RosterValue["people"][number] | undefined; group: string; day: number; children: ReactNode }) {
    const initial = { day: BigInt(day), group, shift: person?.usual.type === "some" ? person.usual.value : props.value.shifts[0]!.key };
    const resolve = (_x: number, _y: number, payload: DragPayload): CellCoord => {
        const a = payload.kind === "event" ? props.week.assignments.get(payload.from.event) : undefined;
        return rosterCoord(props.drag.surface, a === undefined ? initial : { ...a.slot, day: BigInt(day) });
    };
    const accepts = (payload: DragPayload) => {
        if (payload.kind === "event") { const a = props.week.assignments.get(payload.from.event); return person === undefined ? a?.who.type === "request" : a?.who.type === "person" && a.who.value === person.key; }
        if (payload.kind !== "item") return false;
        const from = readRosterSource(payload.from.key);
        return from.success && (person === undefined ? from.value.type === "agency" : from.value.type === "person" && from.value.value === person.key);
    };
    const ref = useDropCell(props.drag.enabled ? rosterCoord(props.drag.surface, initial) : null, !props.drag.enabled, e => props.drag.run(e, true) === undefined, resolve, { accepts, caption: props.drag.caption });
    return useMemo(() => <Box ref={ref} css={props.styles.peopleCell} data-roster-person-day={`${person?.key ?? `requests:${group}`}.${day}`} data-selected={props.day === day ? "" : undefined}>{children}</Box>, [ref, props, person, group, day, children]);
}
type PeopleRow = { key: string; group: RosterValue["groups"][number] } & (
    { kind: "group" } | { kind: "person"; person: RosterValue["people"][number] | undefined }
);
/** Shared stable rows for desktop People and its explicit-action phone cards. */
function usePeopleRows(value: RosterValue): PeopleRow[] {
    return useMemo(() => {
        const people = value.people.filter(p => value.visiblePeople.type === "none" || value.visiblePeople.value.has(p.key));
        const rank = (p: typeof people[number]) => p.agency ? 2 : value.positions.find(pos => pos.key === p.position)?.lead ? 0 : 1;
        return value.groups.flatMap(group => [
            { kind: "group" as const, key: `group:${group.key}`, group },
            ...people.filter(p => p.group === group.key).sort((a, b) => rank(a) - rank(b)).map(person => ({ kind: "person" as const, key: `person:${person.key}`, group, person })),
            { kind: "person" as const, key: `requests:${group.key}`, group, person: undefined },
        ]);
    }, [value.people, value.visiblePeople, value.positions, value.groups]);
}
/** Bring an explicitly selected person into either virtual People layout. */
function selectedPeopleRow(props: RosterViewsProps, rows: readonly PeopleRow[]): number | undefined {
    const selected = props.selection;
    const assignment = selected?.type === "assignment" ? props.week.assignments.get(selected.key) ?? props.held?.assignments.get(selected.key) : undefined;
    const person = selected?.type === "person" ? selected.key : assignment?.who.type === "person" ? assignment.who.value : undefined;
    const index = rows.findIndex(row => row.kind === "person" && (person !== undefined ? row.person?.key === person : assignment?.who.type === "request" && row.person === undefined && row.group.key === assignment.slot.group));
    return index < 0 ? undefined : index;
}
function People(props: RosterViewsProps) {
    const days = Array.from({ length: 7 }, (_, d) => d);
    const rows = usePeopleRows(props.value);
    const getItemKey = useCallback((index: number) => rows[index]!.key, [rows]);
    const header = <Box css={props.styles.row}><Box css={[props.styles.gutter, props.styles.peopleHead]}>People · week</Box>{days.map(day => <Box key={day} css={props.styles.shiftHead} data-roster-column-header="" data-week="" data-selected={props.day === day ? "" : undefined}><Box css={props.styles.shiftLabel}>{props.format.weekday(new Date(props.start.getTime() + day * DAY))} {new Date(props.start.getTime() + day * DAY).getUTCDate()}</Box></Box>)}<Box css={props.styles.peopleHead}>Week hours</Box></Box>;
    return <Box css={props.styles.main} data-roster-grid="people" style={{ "--roster-columns": 8 } as CSSProperties}>
        <VirtualRows fillParent height={undefined} maxHeight={undefined} minWidth="1100px" rootCss={props.styles.scroll}
            header={header} count={rows.length} getItemKey={getItemKey} estimateSize={index => rows[index]!.kind === "group" ? 38 : 62}
            scrollToIndex={selectedPeopleRow(props, rows)} scrollAlign="auto" renderRow={index => {
                const row = rows[index]!, { group } = row;
                if (row.kind === "group") return <Box css={props.styles.group} data-roster-group={group.key}><Box css={props.styles.groupLabel}>{group.label}</Box></Box>;
                const person = row.person, key = person?.key ?? row.key;
                const assignments = matchingAssignments(props, a => person === undefined ? a.who.type === "request" && a.slot.group === group.key : a.who.type === "person" && a.who.value === key);
                const total = props.hours.get(key) ?? 0;
                return <Box css={props.styles.row} data-roster-person-row={key}><chakra.button type="button" css={[props.styles.gutter, props.styles.peopleHead]} onClick={() => person !== undefined && props.select({ type: "person", key })}><Box css={props.styles.title}>{person?.name ?? "Agency requests"}</Box></chakra.button>
                    {days.map(day => <PersonDay key={day} props={props} person={person} group={group.key} day={day}>
                        {assignments.filter(({ a }) => a.slot.day === BigInt(day)).map(({ id, a, removed }) => <AssignmentChip key={id} props={props} id={id} assignment={a} removed={removed} short />)}
                        {person !== undefined && !assignments.some(({ a, removed }) => !removed && a.slot.day === BigInt(day)) && (props.commands.editing.available
                            ? <PlaceAction label="Off · assign" source={{ type: "person", key }} slot={{ day: BigInt(day), group: group.key, shift: person.usual.type === "some" ? person.usual.value : props.value.shifts[0]!.key }} value={props.value} start={props.start} commands={props.commands} styles={props.styles} /> : <Box css={props.styles.detail}>Off</Box>)}
                    </PersonDay>)}
                    <Box css={props.styles.peopleHead} data-tone={person !== undefined && total > person.contract ? "warning" : undefined}>{person !== undefined && <><Box css={props.styles.weekValue}>{props.format.number(total)} / {props.format.number(person.contract)} h</Box><Box css={props.styles.weekFill}><Box css={props.styles.weekFillValue} style={{ width: `${Math.min(total / Math.max(person.contract, 1), 1) * 100}%` }} /></Box></>}</Box>
                </Box>;
            }} />
    </Box>;
}
function AssignmentCard({ props, id, assignment, removed }: { props: RosterViewsProps; id: string; assignment: Assignment; removed: boolean }) {
    const times = assignmentTimes(assignment, props.value, props.start), baseline = props.held?.assignments.get(id);
    return <Box css={props.styles.card} data-roster-card={id} data-selected={props.selection?.type === "assignment" && props.selection.key === id ? "" : undefined} data-drafted={removed || baseline === undefined || !sameAssignment(baseline, assignment) ? "" : undefined}>
        <chakra.button type="button" css={props.styles.cardHead} onClick={() => props.select({ type: "assignment", key: id })}>{assignmentName(props.value, assignment)}{removed && " · removed"}</chakra.button>
        <Box css={props.styles.detail}>{times !== undefined && `${props.format.time(times.from)}–${props.format.time(times.to)}`}{assignment.activity.type === "some" && ` · ${[...props.value.groups.flatMap(g => g.skills), ...props.value.duties].find(a => a.key === assignment.activity.value)?.label ?? assignment.activity.value}`}</Box>
        {props.issues.filter(i => i.assignment.type === "some" && i.assignment.value === id).map((issue, i) => <Box key={i} css={props.styles.flag} data-tone={issue.tone.type}>{issue.title}</Box>)}
        <AssignmentActions id={id} assignment={assignment} removed={removed} value={props.value} start={props.start} commands={props.commands} styles={props.styles} />
    </Box>;
}
function PeopleAgenda(props: RosterViewsProps) {
    const rows = usePeopleRows(props.value);
    const getItemKey = useCallback((index: number) => rows[index]!.key, [rows]);
    return <Box css={props.styles.main} data-roster-agenda="people">
        <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={props.styles.agenda} count={rows.length}
            getItemKey={getItemKey} estimateSize={index => rows[index]!.kind === "group" ? 38 : 900} overscan={1}
            scrollToIndex={selectedPeopleRow(props, rows)} scrollAlign="auto" renderRow={index => {
                const row = rows[index]!;
                if (row.kind === "group") return <Box css={props.styles.agendaGroup}><Box css={props.styles.groupLabel}>{row.group.label}</Box></Box>;
                const person = row.person;
                return <Box css={props.styles.card} data-roster-person-card={person?.key ?? row.key}>
                    {person === undefined ? <><Box css={props.styles.cardHead}>Agency requests</Box>{matchingAssignments(props, a => a.who.type === "request" && a.slot.group === row.group.key).map(({ id, a, removed }) => <AssignmentCard key={id} props={props} id={id} assignment={a} removed={removed} />)}</> : <>
                        <chakra.button type="button" css={props.styles.cardHead} onClick={() => props.select({ type: "person", key: person.key })}>{person.name} · {props.format.number(props.hours.get(person.key) ?? 0)} / {props.format.number(person.contract)} h</chakra.button>
                        {Array.from({ length: 7 }, (_, day) => {
                            const assignments = matchingAssignments(props, a => a.who.type === "person" && a.who.value === person.key && a.slot.day === BigInt(day));
                            return <Box key={day} css={props.styles.agendaGroup}><Box css={props.styles.detail}>{props.format.weekday(new Date(props.start.getTime() + day * DAY))}</Box>
                                {assignments.map(({ id, a, removed }) => <AssignmentCard key={id} props={props} id={id} assignment={a} removed={removed} />)}
                                {!assignments.some(row => !row.removed) && (props.commands.editing.available ? <PlaceAction label="Off · assign" source={{ type: "person", key: person.key }} slot={{ day: BigInt(day), group: row.group.key, shift: person.usual.type === "some" ? person.usual.value : props.value.shifts[0]!.key }} value={props.value} start={props.start} commands={props.commands} styles={props.styles} /> : <Box css={props.styles.detail}>Off</Box>)}
                            </Box>;
                        })}
                    </>}
                </Box>;
            }} />
    </Box>;
}
/** Narrow cards retain explicit operations even with both BuilderFrame panes collapsed. */
function Agenda(props: RosterViewsProps) {
    const days = props.view.layout === "people" || props.view.period === "week" ? Array.from({ length: 7 }, (_, d) => d) : [props.day];
    return <Box css={props.styles.scroll} data-roster-agenda=""><Box css={props.styles.agenda}>
        {props.view.period === "day" && props.view.layout === "shifts" && <Seg label="Day of week" scope="roster" name="agenda-days" active={String(props.day)} items={Array.from({ length: 7 }, (_, day) => ({ key: String(day), label: props.format.weekday(new Date(props.start.getTime() + day * DAY)) }))} onPick={day => props.setView({ ...props.view, date: props.start.getTime() + Number(day) * DAY })} />}
        {days.map(day => <Box key={day} css={props.styles.agendaGroup}><Box css={props.styles.groupLabel}>{props.format.weekdayDate(new Date(props.start.getTime() + day * DAY))}</Box>
            {props.value.groups.flatMap(group => props.value.shifts.map(shift => { const slot = { day: BigInt(day), group: group.key, shift: shift.key }, c = props.coverage.get(slot)!; return <Box key={slotKey(slot)} css={props.styles.card} data-roster-agenda-slot={slotKey(slot)}>
                <chakra.button type="button" css={props.styles.cardHead} onClick={() => props.select({ type: "slot", slot })}>{group.label} · {shift.label}</chakra.button>
                <Box css={props.styles.detail}>{String(c.filled)} / {String(c.positions)} positions · {String(c.open)} open</Box>
                {props.value.settings.requirements && <CoverageView coverage={c} value={props.value} styles={props.styles} format={props.format} compact />}
                {assignments(props, slot).map(({ id, a, removed }) => <AssignmentCard key={id} props={props} id={id} assignment={a} removed={removed} />)}
                {props.proposals.filter(p => sameSlot(p.slot, slot) && (props.value.visiblePeople.type === "none" || props.value.visiblePeople.value.has(p.person))).map(p => <ProposalCard key={p.key} props={props} proposal={p} />)}
                <SlotActions props={props} slot={slot} />{props.commands.editing.available && <RequirementAction slot={slot} week={props.week} value={props.value} commands={props.commands} styles={props.styles} />}
            </Box>; }))}
        </Box>)}
    </Box></Box>;
}
export function RosterViews(props: RosterViewsProps) {
    return props.narrow ? props.view.layout === "people" ? <PeopleAgenda {...props} /> : <Agenda {...props} /> : props.view.layout === "people" ? <People {...props} /> : <Shifts {...props} />;
}
