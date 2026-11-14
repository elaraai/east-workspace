/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { RepositoryUpgrade } from '../interfaces.js';
import { rackPolicyLimits } from './rack-policy-limits.js';

/**
 * The upgrades of a local repository's own layout — its files and
 * directories — in the order they apply.
 *
 * @remarks
 * - `rack-policy-limits`: a rule of the repository's rack policy may hold a
 *   memory limit and ask for a GPU ({@link rackPolicyLimits}).
 *
 * A release that changes the local layout appends its step, and never edits,
 * reorders or removes a step a release has shipped. A test registers a step of
 * its own here, and removes it after.
 *
 * @internal
 */
export const LOCAL_REPOSITORY_UPGRADES: RepositoryUpgrade[] = [rackPolicyLimits];
