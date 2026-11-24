/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Access database the Access tests read: one table, `actor`, of ten actors
 * made up for them ({@link ACTORS}), written by `access-writer.ts` and kept at
 * {@link ACTORS_PATH}. `scripts/access-fixture.ts` writes it again
 * (`pnpm run test:fixtures` in this package), and the Access spec fails while
 * the kept file is not what the writer writes.
 *
 * @packageDocumentation
 */
import { accessDatabase } from "./access-writer.js";

/**
 * Where the database is kept, from this package's directory: where its tests
 * run, on Node and on Python, which runs them exported (east-py's
 * `make test-east-py-io`).
 */
export const ACTORS_PATH = "test/sql/fixtures/actors.mdb";

/** An actor the database holds: a row of its `actor` table. */
export interface Actor {
    /** Its `actor_id`. */
    readonly id: number;
    /** Its `first_name`. */
    readonly first: string;
    /** Its `last_name`: the last actor has none. */
    readonly last: string | null;
}

/** The actors, in the order of the table's rows: one has a name beyond ASCII, one has no last name. */
export const ACTORS: readonly Actor[] = [
    { id: 1, first: "Avery", last: "Stone" },
    { id: 2, first: "Blake", last: "Rivers" },
    { id: 3, first: "Casey", last: "Morgan" },
    { id: 4, first: "Drew", last: "Ellis" },
    { id: 5, first: "Emery", last: "Hart" },
    { id: 6, first: "Finley", last: "Brooks" },
    { id: 7, first: "Gray", last: "Holloway" },
    { id: 8, first: "Harper", last: "Quiñones" },
    { id: 9, first: "Indigo", last: "Vale" },
    { id: 10, first: "Jordan", last: null },
];

/** When the database says it was made: a fixed instant, so it is written the same each time. */
const CREATED = new Date(Date.UTC(2026, 10, 24));

/**
 * Writes the database: its `actor` table, of `actor_id` (Long Integer),
 * `first_name` and `last_name` (Text of up to 45 characters), holding
 * {@link ACTORS}.
 *
 * @returns The database's bytes
 */
export function actorsDatabase(): Buffer {
    return accessDatabase([{
        name: "actor",
        columns: [
            { name: "actor_id", type: "long" },
            { name: "first_name", type: "text", length: 45 },
            { name: "last_name", type: "text", length: 45 },
        ],
        rows: ACTORS.map((actor) => [actor.id, actor.first, actor.last]),
    }], CREATED);
}
