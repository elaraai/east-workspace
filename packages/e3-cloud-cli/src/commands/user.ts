/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * User management commands - list, add, remove users from repositories.
 */

import { repoUsers, addUser, removeUser, type RepoUser } from '@elaraai/e3-admin-client';
import { parseRepoRole } from '@elaraai/e3-admin-types';
import { getValidToken } from '../credentials.js';
import { parseRepoUrl, formatError, exitError } from '../utils.js';

export const userCommand = {
  async list(url: string): Promise<void> {
    try {
      const { baseUrl, repo } = parseRepoUrl(url);
      const token = await getValidToken(baseUrl);

      const users = await repoUsers(baseUrl, repo, { token });

      // Table header
      console.log('USER ID'.padEnd(20) + 'EMAIL'.padEnd(30) + 'ROLE'.padEnd(10) + 'ADDED');

      // User rows
      for (const user of users) {
        const row = [
          user.userId.substring(0, 18).padEnd(20),
          user.email.padEnd(30),
          user.role.type.padEnd(10),
          user.addedAt.substring(0, 19),
        ].join('');
        console.log(row);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async add(url: string, email: string, options: { role: string }): Promise<void> {
    try {
      const { baseUrl, repo } = parseRepoUrl(url);
      const token = await getValidToken(baseUrl);

      // Validate role
      let role;
      try {
        role = parseRepoRole(options.role);
      } catch {
        exitError(`Invalid role: ${options.role}. Use 'owner' or 'member'.`);
      }

      const user = await addUser(baseUrl, repo, { email, role }, { token });

      console.log(`Added ${user.email} as ${user.role.type}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  async remove(url: string, email: string): Promise<void> {
    try {
      const { baseUrl, repo } = parseRepoUrl(url);
      const token = await getValidToken(baseUrl);

      // First, find the user by email
      const users = await repoUsers(baseUrl, repo, { token });

      const user = users.find((u: RepoUser) => u.email.toLowerCase() === email.toLowerCase());
      if (!user) {
        exitError(`User ${email} not found in repository`);
      }

      // Remove by userId
      await removeUser(baseUrl, repo, user.userId, { token });

      console.log(`Removed ${email}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },
};
