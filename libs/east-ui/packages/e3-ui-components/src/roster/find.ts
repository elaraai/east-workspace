/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records (#1398): the Roster toolbar's key search over its people by
 * their keys — primary-key navigation, never a field search, which is the
 * rail's. It is the shared key search's item over the complete staff the
 * Roster calculates over, read whole: their keys in East's order, as the
 * server finds a key (`findKeyInline`) — a key's start, a quoted key, a range.
 * A line names a person by their key, their name and their group, and says so
 * where the rail's narrowing hides them; a pick selects the person — in the
 * People layout their row is brought into view — and the box shows their key.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { StringType, compareFor, equalFor, toEastTypeValue, type EastTypeValue, type option } from "@elaraai/east";
import { findKeyInline, type DatasetKeyMatchRange, type DatasetKeyQuery } from "@elaraai/east-ui/internal";
import type { KeySearchSource } from "@elaraai/east-ui-components";
import type { Person, RosterValue } from "./model.js";

/** A person's key is a String: the search's text parses against that. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);
const compareKey = compareFor(StringType);
const keyEqual = equalFor(StringType);
/** An empty box lists the first of the staff. */
const BROWSE_QUERY: DatasetKeyQuery = { prefix: "" };

/** A person found, and whether the rail's narrowing hides them. */
export interface FoundPerson {
    readonly person: Person;
    readonly hidden: boolean;
}

/**
 * The people a query finds, in East's order of their keys.
 *
 * @param people - The staff, in any order
 * @param query - The query the box parsed
 * @returns The people it finds, in key order
 */
export function findPeople(people: readonly Person[], query: DatasetKeyQuery): Person[] {
    const sorted = [...people].sort((a, b) => compareKey(a.key, b.key));
    const range = findKeyInline(KEY_TYPE, sorted.map(person => person.key), query);
    return range.found ? sorted.slice(range.row, range.row + range.count) : [];
}

/**
 * How a found person reads in the list: their key, their name where it is not their key, their group, and whether the
 * rail hides them.
 *
 * @param found - The person
 * @param groups - The Roster's groups: what names a person's
 * @returns Their line
 */
export function foundPersonLine(found: FoundPerson, groups: RosterValue["groups"]): string {
    const { person } = found;
    const group = groups.find(g => keyEqual(g.key, person.group))?.label ?? person.group;
    return [person.key, ...(keyEqual(person.name, person.key) ? [] : [person.name]), group, ...(found.hidden ? ["hidden by the filters"] : [])].join(" · ");
}

/** Props of {@link useRosterFind}. */
export interface RosterFindProps {
    /** Every person of the staff. */
    readonly people: readonly Person[];
    /** The people the rail shows; `none` while it narrows none. */
    readonly visible: option<ReadonlySet<string>>;
    /** The Roster's groups. */
    readonly groups: RosterValue["groups"];
    /** Told the person a pick lands on. */
    readonly onPick: (found: FoundPerson) => void;
}

/**
 * Search Records' source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The staff, who the rail shows, the groups and the pick
 * @returns The source; `undefined` with no one to seek
 */
export function useRosterFind({ people, visible, groups, onPick }: RosterFindProps): KeySearchSource | undefined {
    const latest = useRef({ people, visible, groups, onPick });
    useLayoutEffect(() => { latest.current = { people, visible, groups, onPick }; });
    // What the last find found; the box asks for its lines, and jumps to one, with what it captured before the find answered.
    const found = useRef<readonly Person[]>([]);
    const find = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        const matches = findPeople(latest.current.people, query);
        found.current = matches;
        return { found: matches.length > 0, row: 0, count: matches.length };
    }, []);
    const of = useCallback((person: Person): FoundPerson => {
        const shows = latest.current.visible;
        return { person, hidden: shows.type === "some" && !shows.value.has(person.key) };
    }, []);
    // A pick shows the person's key in the box: what its query is typed against.
    const listRange = useCallback(async (row: number, limit: number) => found.current.slice(row, row + limit)
        .map((person, i) => ({ row: row + i, label: foundPersonLine(of(person), latest.current.groups), text: person.key })), [of]);
    const jump = useCallback((row: number) => {
        const person = found.current[row];
        if (person !== undefined) latest.current.onPick(of(person));
    }, [of]);
    const clear = useCallback(() => { found.current = []; }, []);
    const any = people.length > 0;
    // The box asks its query again as the staff or what the rail shows of them move: a line says who it hides.
    const requery = useRequery(people, visible);
    return useMemo(() => (any ? { resetKey: "roster", requery, keyType: KEY_TYPE, find, listRange, jump, clear, browseQuery: BROWSE_QUERY,
        noMatchesText: "No matching people. Search by a person's key." } : undefined), [any, requery, find, listRange, jump, clear]);
}

/** A count that moves each time the staff or the rail's narrowing of them is another object. */
function useRequery(people: readonly Person[], visible: option<ReadonlySet<string>>): number {
    const seen = useRef({ people, visible, n: 0 });
    if (!Object.is(seen.current.people, people) || !Object.is(seen.current.visible, visible)) {
        seen.current = { people, visible, n: seen.current.n + 1 };
    }
    return seen.current.n;
}
