/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * whoami command - show current user identity and admin status.
 */

import { whoami, unwrap } from '@elaraai/e3-admin-client';
import { getValidToken, listCredentials, normalizeServerUrl } from '../credentials.js';
import { formatError, exitError } from '../utils.js';

export async function whoamiCommand(server?: string): Promise<void> {
  try {
    // If no server specified, use first stored credential
    let serverUrl = server;
    if (!serverUrl) {
      const creds = listCredentials();
      if (creds.length === 0) {
        exitError('No stored credentials. Run: e3 login <server>');
      }
      serverUrl = creds[0].server;
    }
    serverUrl = normalizeServerUrl(serverUrl);

    const token = await getValidToken(serverUrl);
    const response = await whoami(serverUrl, { token });
    const me = unwrap(response);

    console.log(`sub: ${me.sub}`);
    if (me.email.value !== undefined) {
      console.log(`email: ${me.email.value}`);
    }
    if (me.name.value !== undefined) {
      console.log(`name: ${me.name.value}`);
    }
    console.log(`admin: ${me.isAdmin}`);
  } catch (err) {
    exitError(formatError(err));
  }
}
