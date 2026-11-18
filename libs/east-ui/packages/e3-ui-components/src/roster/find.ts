/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records (#1398): the Roster toolbar's key search over its people by
 * their keys — primary-key navigation, never a field search, which is the
 * rail's. It is every builder's Search Records
 * (`shared/schedule/search-records.ts`) over the complete staff the Roster
 * calculates over, read whole: their keys in East's order, as the server finds
 * a key — a key's start, a quoted key, a range — and, on a page whose people's
 * source holds a scope (#1621), the people the scope holds alone, asked of e3.
 * A line names a person by their key, their name and their group; one the
 * rail's narrowing hides says so, as every builder's does (the shared hidden
 * pick, `shared/schedule/hidden.ts`) — `· hidden by Group: picking — picking
 * it clears that filter` once e3 has said, `· hidden by the filters` until
 * then — asked of e3 for the people the box lists that the rail does not show,
 * and listed again as the answers land, and as who the rail shows moves. A pick
 * selects the person — in the People layout their row is brought into view,
 * once the narrowing draws it — and the box shows their key; the Roster clears
 * what hides them first.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { StringType, equalFor, some, type option } from "@elaraai/east";
import type { KeySearchSource } from "@elaraai/east-ui-components";
import { hiddenLine, type RowHidden, type SourceHidden } from "../shared/schedule/hidden.js";
import { STRING_KEYS } from "../shared/schedule/kind-keys.js";
import { useSearchRecords, type SoughtSource } from "../shared/schedule/search-records.js";
import type { RosterWords } from "./messages.js";
import type { Person, RosterValue } from "./model.js";

const keyEqual = equalFor(StringType);

/** A person found, and what hides them. */
export interface FoundPerson {
    readonly person: Person;
    /** What hides them, as far as e3 has said — the people's source; `undefined` for one the rail's narrowing shows. */
    readonly hidden: readonly RowHidden[] | undefined;
}

/**
 * How a found person reads in the list: their key, their name where it is not their key, their group, and — one the
 * rail hides — what hides them, in the Roster's words (the shared hidden pick).
 *
 * @param found - The person
 * @param groups - The Roster's groups: what names a person's
 * @param words - The Roster's words: the app's formatters, and its message table
 * @returns Their line
 */
export function foundPersonLine(found: FoundPerson, groups: RosterValue["groups"], words: RosterWords): string {
    const { person } = found;
    const group = groups.find(g => keyEqual(g.key, person.group))?.label ?? person.group;
    const hidden = found.hidden === undefined ? [] : [hiddenLine(found.hidden, words, words.m)];
    return [person.key, ...(keyEqual(person.name, person.key) ? [] : [person.name]), group, ...hidden].join(" · ");
}

/** Props of {@link useRosterFind}. */
export interface RosterFindProps {
    /** Every person of the staff. */
    readonly people: readonly Person[];
    /** The people the rail shows; `none` while it narrows none. */
    readonly visible: option<ReadonlySet<string>>;
    /** Whether `visible` is the narrowing's own, read: not the last one standing in while a new one is read. */
    readonly settled: boolean;
    /** The Roster's groups. */
    readonly groups: RosterValue["groups"];
    /** The hidden pick over the people's source: what e3 has said hides a person. */
    readonly hidden: SourceHidden;
    /** The Roster's words: the app's formatters, which word a choice as the rail does, and its message table. */
    readonly words: RosterWords;
    /** Told the person a pick lands on. */
    readonly onPick: (found: FoundPerson) => void;
}

/**
 * Search Records' source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The staff, who the rail shows, the groups, the hidden pick, the words and the pick
 * @returns The source; `undefined` with no one to seek
 */
export function useRosterFind({ people, visible, settled, groups, hidden, words, onPick }: RosterFindProps): KeySearchSource | undefined {
    const latest = useRef({ visible, groups, hidden, words, onPick });
    useLayoutEffect(() => { latest.current = { visible, groups, hidden, words, onPick }; });
    // The people's source narrows them on the rail, whose page's scope they are listed under (#1621).
    const scope = hidden.part;
    const sources = useMemo((): SoughtSource<Person>[] => (people.length === 0 ? [] : [{
        rows: () => some(people), idOf: (person) => person.key, keys: STRING_KEYS, scope,
    }]), [people, scope]);
    return useSearchRecords({
        name: "Roster", resetKey: "roster", sources,
        // A pick shows the person's key in the box: what its query is typed against.
        line: ({ item: person, hidden: hides }) => ({
            label: foundPersonLine({ person, hidden: hides }, latest.current.groups, latest.current.words), text: person.key,
        }),
        onPick: ({ item: person, hidden: hides }) => { latest.current.onPick({ person, hidden: hides }); },
        noMatchesText: "No matching people. Search by a person's key.",
        // One the rail's shown people leave out is hidden by the people's source — known so while the people it shows are
        // the narrowing's own, read — but where e3 says the narrowing holds them, the rail's shown people catching up.
        hidings: (found) => {
            const { visible: shows, hidden: pick } = latest.current;
            return found.map((person) => (shows.type === "none" || shows.value.has(person.key) ? [] : [{ pick, id: person.key }]));
        },
        hidingsKnown: settled,
        // The box asks its query again as the staff moves, and lists its lines again as who the rail shows moves.
        requeryBy: [people],
        relistBy: [hidden, visible, settled, groups],
    });
}
