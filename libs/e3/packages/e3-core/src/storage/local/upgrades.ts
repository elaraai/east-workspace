/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { RepositoryUpgrade } from '../interfaces.js';

/**
 * The upgrades of a local repository's own layout — its files and
 * directories — in the order they apply.
 *
 * @remarks
 * None yet. A release that changes the local layout appends its step, and
 * never edits, reorders or removes a step a release has shipped. A test
 * registers a step of its own here, and removes it after.
 *
 * @internal
 */
export const LOCAL_REPOSITORY_UPGRADES: RepositoryUpgrade[] = [];
