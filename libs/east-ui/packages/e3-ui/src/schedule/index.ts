/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule` (#1218): the event and resource kinds the Calendar and Plan's
 * builder share, so the very same records drive either (`Calendar Spec.md`
 * §4, `Plan Builder Spec.md` §4).
 *
 * - `Schedule.resources(rows, config)`: one resource kind, read from any keyed
 *   rows, usually a record's `read()`; a schedule never writes them. Plan's
 *   options: groups, nesting, the gutter, rollups, measures and paging.
 * - `Schedule.events(record, config)`: one event kind, a record of its own
 *   bound with its patch mutation, closed behind East functions over beast2
 *   bytes so a builder's payload is one type whatever the records hold.
 *   Plan's options sit beside the Calendar's (#1190): how a kind draws, an
 *   instant kind's `at`, and its roles' fields.
 * - `Schedule.field`: the inspector's typed form, east-ui's `Fields`.
 * - `Schedule.patch`: what a library card dropped on an event sets, a patch
 *   over an event kind's row type (#1195).
 * - `Schedule.days` and `Schedule.unscheduled`: the keys a large record's day
 *   index and backlog index file an event under.
 * - `Schedule.Types`: what an author meets.
 *
 * A builder takes its kinds by slot — `resources={{ people: … }}`,
 * `events={{ shift: … }}` — and checks them across slots
 * (`ScheduleInternal.check`) before it builds them under their slot names:
 * the Calendar with `build(slot)`, Plan's builder with `buildPlan(slot)`.
 *
 * @packageDocumentation
 */

import { StringType, isTypeEqual, printType, type EastType } from "@elaraai/east";
import { Fields, type FieldsNamespace } from "@elaraai/east-ui";
import { scheduleDays, scheduleUnscheduled } from "./days.js";
import { scheduleEvents, type ScheduleEventKind } from "./events.js";
import { SchedulePatchTypeFor, schedulePatch } from "./patch.js";
import { SCHEDULE_DEF, scheduleResources, type ScheduleResourceKind } from "./resources.js";
import {
    PlanEventItemType, PlanEventKindType, PlanEventRolesType, PlanResourceRowType, PlanResourcesType,
    ScheduleCandidateType, ScheduleClockType, ScheduleDraftsType, ScheduleDurationType, ScheduleEventRefType, ScheduleGestureType,
    ScheduleItemType, ScheduleKindType, ScheduleOverlapsType, ScheduleReadyEntryType, ScheduleResourceRefType, ScheduleResourceRowType,
    ScheduleResourcesType, ScheduleStatusCasesFor, ScheduleStatusType, ScheduleTemplateType, ScheduleWriteType,
} from "./types.js";

export * from "./types.js";
export {
    scheduleEvents,
    type ScheduleAtField, type ScheduleBacklog, type ScheduleEventKind, type ScheduleEventsBase, type ScheduleEventsConfig,
    type ScheduleFloatField, type ScheduleInstantEventsConfig, type ScheduleInstantField, type ScheduleInstantTemplate,
    type ScheduleOverlapsLiteral, type ScheduleQuantity, type ScheduleRecordHandle, type ScheduleResourceField, type ScheduleResourceOf,
    type ScheduleStateField, type ScheduleStatusCasesOf, type ScheduleStatusConfig, type ScheduleStatusField, type ScheduleStringField,
    type ScheduleTemplate, type ScheduleValuesOf, type ScheduleVerdictField,
} from "./events.js";
export { SCHEDULE_DEF, scheduleResources, type ScheduleResourceKind, type ScheduleResourcesConfig } from "./resources.js";
export { scheduleDays, scheduleUnscheduled } from "./days.js";
export { SchedulePatchTypeFor, schedulePatch, type SchedulePatchInput, type SchedulePatchOf } from "./patch.js";

/**
 * The checks a builder makes across its slots: at least one event kind;
 * each a `Schedule.events` kind, each resource a `Schedule.resources` one;
 * and each slot an event kind's resource names, there and keyed by String,
 * the keys its resource field holds.
 *
 * @param resources - The builder's resource kinds, by slot
 * @param events - Its event kinds, by slot
 * @param builder - The builder, for the refusals (`Calendar.Builder`, `Plan`)
 * @throws {Error} Naming the slot and the remedy
 */
export function scheduleCheck(
    resources: Readonly<Record<string, ScheduleResourceKind<EastType, EastType>>>,
    events: Readonly<Record<string, ScheduleEventKind<EastType, EastType>>>,
    builder: string,
): void {
    for (const [slot, kind] of Object.entries(resources)) {
        if ((kind as { [SCHEDULE_DEF]?: string } | undefined)?.[SCHEDULE_DEF] !== "resources") {
            throw new Error(`${builder}: resources.${slot} is a resource kind — Schedule.resources(rows, { name, icon, label })`);
        }
    }
    const kinds = Object.entries(events);
    if (kinds.length === 0) {
        throw new Error(`${builder}: \`events\` declares at least one event kind — Schedule.events(record, { … }) under its slot name`);
    }
    for (const [slot, kind] of kinds) {
        if ((kind as { [SCHEDULE_DEF]?: string } | undefined)?.[SCHEDULE_DEF] !== "events") {
            throw new Error(`${builder}: events.${slot} is an event kind — Schedule.events(record, { … })`);
        }
        for (const taken of kind.takes) {
            const target = resources[taken];
            if (target === undefined) {
                throw new Error(`${builder}: events.${slot}'s resource names the slot "${taken}", and \`resources\` has no slot of that name (${Object.keys(resources).join(", ") || "none"})`);
            }
            if (!isTypeEqual(target.keyType, StringType)) {
                throw new Error(`${builder}: events.${slot}'s resource field holds String keys of resources.${taken}, which is keyed by ${printType(target.keyType)} — key the resources by String`);
            }
        }
    }
}

/**
 * The type of the {@link Schedule} namespace — declared explicitly so the
 * declaration emit stays within TypeScript's serialization limit.
 */
export interface ScheduleNamespace {
    /** One event kind: a record of its own, bound with its patch mutation. */
    events: typeof scheduleEvents;
    /** One resource kind, read from keyed rows. */
    resources: typeof scheduleResources;
    /** The inspector's typed form: east-ui's `Fields`. */
    field: FieldsNamespace;
    /** What a library card dropped on an event sets: a patch over an event kind's row type, every field an `Option`. */
    patch: typeof schedulePatch;
    /** The days an event touches: what a day index files it under. */
    days: typeof scheduleDays;
    /** What a backlog index files a row under: its due date while it has no start. */
    unscheduled: typeof scheduleUnscheduled;
    /** What an author meets. */
    Types: {
        /** A resource: its kind's slot name and its key's text. */
        ResourceRef: typeof ScheduleResourceRefType;
        /** An event: its kind's slot name and its record key's text. */
        EventRef: typeof ScheduleEventRefType;
        /** How one case of a status shows. */
        Status: typeof ScheduleStatusType;
        /** `StatusCases(V)`: one Status per case of a status variant. */
        StatusCases: typeof ScheduleStatusCasesFor;
        /** A time of day. */
        Clock: typeof ScheduleClockType;
        /** How long something takes. */
        Duration: typeof ScheduleDurationType;
        /** Where a drop would put an event: what a builder's `canDrop` is asked. */
        Candidate: typeof ScheduleCandidateType;
        /** `Patch(R)`: a patch over an event kind's row type, every field an `Option` — what `Schedule.patch` builds. */
        Patch: typeof SchedulePatchTypeFor;
    };
}

/**
 * The event and resource kinds the Calendar and Plan's builder share (see the
 * module docs).
 */
export const Schedule: ScheduleNamespace = {
    events: scheduleEvents,
    resources: scheduleResources,
    field: Fields,
    patch: schedulePatch,
    days: scheduleDays,
    unscheduled: scheduleUnscheduled,
    Types: {
        ResourceRef: ScheduleResourceRefType,
        EventRef: ScheduleEventRefType,
        Status: ScheduleStatusType,
        StatusCases: ScheduleStatusCasesFor,
        Clock: ScheduleClockType,
        Duration: ScheduleDurationType,
        Candidate: ScheduleCandidateType,
        Patch: SchedulePatchTypeFor,
    },
};

/**
 * The type of {@link ScheduleInternal}: the public namespace, the checks
 * across a builder's slots, and the kinds' wire.
 */
export interface ScheduleInternalNamespace extends Omit<ScheduleNamespace, "Types"> {
    /** The checks across a builder's slots. */
    check: typeof scheduleCheck;
    /** What an author meets, and the kinds' wire. */
    Types: ScheduleNamespace["Types"] & {
        /** One event kind, closed. */
        Kind: typeof ScheduleKindType;
        /** One resource kind, its rows resolved. */
        Resources: typeof ScheduleResourcesType;
        /** One resource, resolved. */
        ResourceRow: typeof ScheduleResourceRowType;
        /** One event, as every view draws it. */
        Item: typeof ScheduleItemType;
        /** One gesture. */
        Gesture: typeof ScheduleGestureType;
        /** One gesture, written into one entry. */
        Write: typeof ScheduleWriteType;
        /** One template. */
        Template: typeof ScheduleTemplateType;
        /** The drafts a seam reads, by entry id. */
        Drafts: typeof ScheduleDraftsType;
        /** One drafted entry, as `ready` reads it. */
        ReadyEntry: typeof ScheduleReadyEntryType;
        /** Whether two events of a kind on one resource at once are a conflict. */
        Overlaps: typeof ScheduleOverlapsType;
        /** One event kind as Plan's builder takes it. */
        PlanKind: typeof PlanEventKindType;
        /** One event as Plan draws it. */
        PlanItem: typeof PlanEventItemType;
        /** The fields an event kind's roles read on a Plan. */
        PlanRoles: typeof PlanEventRolesType;
        /** One resource kind as Plan's builder takes it. */
        PlanResources: typeof PlanResourcesType;
        /** One resource as Plan's builder takes it. */
        PlanResourceRow: typeof PlanResourceRowType;
    };
}

/**
 * `Schedule` for builders and renderers: the public namespace, the checks
 * across slots, and the kinds' wire (`@elaraai/e3-ui/internal`).
 */
export const ScheduleInternal: ScheduleInternalNamespace = {
    ...Schedule,
    check: scheduleCheck,
    Types: {
        ...Schedule.Types,
        Kind: ScheduleKindType,
        Resources: ScheduleResourcesType,
        ResourceRow: ScheduleResourceRowType,
        Item: ScheduleItemType,
        Gesture: ScheduleGestureType,
        Write: ScheduleWriteType,
        Template: ScheduleTemplateType,
        Drafts: ScheduleDraftsType,
        ReadyEntry: ScheduleReadyEntryType,
        Overlaps: ScheduleOverlapsType,
        PlanKind: PlanEventKindType,
        PlanItem: PlanEventItemType,
        PlanRoles: PlanEventRolesType,
        PlanResources: PlanResourcesType,
        PlanResourceRow: PlanResourceRowType,
    },
};
