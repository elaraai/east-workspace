/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { E3_RELEASE } from '@elaraai/e3-types';

/** The lockstep release whose repository formats this session reads. */
export const E3_RACK_VERSION: string = E3_RELEASE;
/**
 * The hub/session protocol this release implements; negotiated exactly. 3 is
 * the first whose replies are the BEAST2 of each route's own type, with no
 * envelope: the envelope held e3's API error type, which changes between
 * releases, so an e3 of one release could not read the hello of a hub
 * another started.
 */
export const HUB_PROTOCOL = 3;
