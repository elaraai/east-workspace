/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { RepositoryUpgrade } from '../interfaces.js';
import { rackPolicyKeep } from './rack-policy-keep.js';
import { rackPolicyLimits } from './rack-policy-limits.js';
import { rackPolicyMerges } from './rack-policy-merges.js';
import { rackPolicyWeighFetch } from './rack-policy-weigh-fetch.js';

/**
 * The upgrades of a local repository's own layout — its files and
 * directories — in the order they apply.
 *
 * @remarks
 * - `rack-policy-limits`: a rule of the repository's rack policy may hold a
 *   memory limit and ask for a GPU ({@link rackPolicyLimits}).
 * - `rack-policy-weigh-fetch`: the policy says whether work that would take
 *   longer to fetch its inputs than to run runs here ({@link rackPolicyWeighFetch}).
 * - `rack-policy-merges`: the policy says where a split task's merge units
 *   run, and a rule may say it for its own ({@link rackPolicyMerges}).
 * - `rack-policy-keep`: the policy says how long a rack keeps what work wrote
 *   there for later work to read: a split task's units, or a whole rack
 *   session's work ({@link rackPolicyKeep}).
 *
 * A release that changes the local layout appends its step, and never edits,
 * reorders or removes a step a release has shipped. A test registers a step of
 * its own here, and removes it after.
 *
 * @internal
 */
export const LOCAL_REPOSITORY_UPGRADES: RepositoryUpgrade[] = [rackPolicyLimits, rackPolicyWeighFetch, rackPolicyMerges, rackPolicyKeep];
