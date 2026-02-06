#!/usr/bin/env node

/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * e3-cloud CLI - cloud management for e3.
 */

import { Command } from 'commander';
import { whoamiCommand } from './commands/whoami.js';
import { userCommand } from './commands/user.js';

const program = new Command();

program
  .name('e3-cloud')
  .description('e3 cloud management CLI')
  .version('0.0.1-alpha.0');

// e3-cloud whoami [server]
program
  .command('whoami [server]')
  .description('Show current user identity and admin status')
  .action(whoamiCommand);

// e3-cloud user <subcommand>
const user = program
  .command('user')
  .description('User management commands');

user
  .command('list')
  .description('List users with access to a repository')
  .argument('<url>', 'Repository URL (e.g., https://server/repos/my-repo)')
  .action(userCommand.list);

user
  .command('add')
  .description('Add a user to a repository')
  .argument('<url>', 'Repository URL')
  .argument('<email>', 'User email address')
  .option('--role <role>', 'Role to assign (owner or member)', 'member')
  .action(userCommand.add);

user
  .command('remove')
  .description('Remove a user from a repository')
  .argument('<url>', 'Repository URL')
  .argument('<email>', 'User email address')
  .action(userCommand.remove);

program.parse();
