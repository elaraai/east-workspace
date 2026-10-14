/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository upgrade that gives every workspace the revision token its
 * status is computed over: every store keeps one (`RefStore.workspaceRevision`),
 * which its `workspaceWrite` and its dataset refs' writes move, so a poll
 * asks whether anything changed by one read.
 *
 * A workspace a release from before the tokens wrote has none, and reads as
 * an empty one until something moves it. So the step writes each workspace's
 * record again, as it is, through the store, which moves its token as it
 * writes it. A token is a record of its own, which a release from before them
 * never reads, so such a release opens a repository that has had the step as
 * it opens any; the step is recorded all the same, as every step is, so the
 * repository names what it has had. The repository's execution token is
 * filled by the first run's write, and until then reads empty, which names
 * the repository as it is: nothing has run since the tokens were kept.
 *
 * @packageDocumentation
 */

import { OBJECT_CONCURRENCY } from '../concurrency.js';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import { workInParts } from './parts.js';

/** The name a repository's record keeps once the upgrade is applied. */
export const STATUS_REVISION_TOKENS = 'status-revision-tokens';

/**
 * Writes every workspace's record of a repository again, as it is, through
 * the store, which gives the workspace its revision token.
 *
 * @remarks
 * The records are read in one call (`RefStore.workspaceReadAll`), so the
 * upgrade goes through every backend's stores alike. A workspace with a token
 * already is written again as it is, which moves its token and nothing else:
 * a step a crash cut short runs its part again.
 *
 * A unit of the step is a workspace. The units go in the order of their
 * names, {@link OBJECT_CONCURRENCY} at once, and a part stops between batches
 * once its time is up, with the name of the last workspace it wrote as its
 * cursor.
 */
export const statusRevisionTokens: RepositoryUpgrade = {
  name: STATUS_REVISION_TOKENS,
  async apply(storage, repo, at, until) {
    const { refs } = storage;
    const units = [...await refs.workspaceReadAll(repo)].map(([name, record]) => ({ key: name, unit: { name, record } }));
    return workInParts(units, at, until, OBJECT_CONCURRENCY, ({ name, record }) => refs.workspaceWrite(repo, name, record));
  },
};
