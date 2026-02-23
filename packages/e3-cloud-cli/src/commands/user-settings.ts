/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * User settings management commands — get, set, remove.
 */

import {
  getUserSettings,
  putUserSettings,
  deleteUserSettings,
} from '@elaraai/e3-cloud-client';
import { getValidToken } from '../credentials.js';
import { parseWorkspaceUrl, formatError, exitError } from '../utils.js';

export const settingsCommand = {
  async get(url: string, options: { output?: string }): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      const data = await getUserSettings(baseUrl, repo, workspace, { token });
      if (!data) {
        console.log('No settings stored.');
        return;
      }

      if (options.output) {
        const fs = await import('node:fs');
        fs.writeFileSync(options.output, data);
        console.log(`Settings written to ${options.output} (${data.byteLength} bytes)`);
      } else {
        // Write raw bytes to stdout
        process.stdout.write(data);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async set(url: string, options: { input?: string; data?: string }): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      let payload: Uint8Array;

      if (options.input) {
        const fs = await import('node:fs');
        payload = fs.readFileSync(options.input);
      } else if (options.data) {
        payload = new TextEncoder().encode(options.data);
      } else {
        // Read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        payload = new Uint8Array(Buffer.concat(chunks));
      }

      await putUserSettings(baseUrl, repo, workspace, payload, { token });
      console.log(`Settings saved (${payload.byteLength} bytes)`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async remove(url: string): Promise<void> {
    try {
      const { baseUrl, repo, workspace } = parseWorkspaceUrl(url);
      const token = await getValidToken(baseUrl);

      await deleteUserSettings(baseUrl, repo, workspace, { token });
      console.log('Settings removed.');
    } catch (err) {
      exitError(formatError(err));
    }
  },
};
