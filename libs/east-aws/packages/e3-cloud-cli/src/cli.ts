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
import { scheduleCommand } from './commands/schedule.js';
import { computeCommand } from './commands/compute.js';
import { timeoutCommand } from './commands/timeout.js';
import { settingsCommand } from './commands/user-settings.js';

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

// e3-cloud schedule <subcommand>
const schedule = program
  .command('schedule')
  .description('Schedule management commands');

schedule
  .command('set')
  .description('Create or update a workspace schedule')
  .argument('<url>', 'Workspace URL (e.g., https://server/repos/my-repo/workspaces/main)')
  .option('--cron <expression>', 'Cron expression (Unix 5-field, e.g., "0 2 * * *")')
  .option('--force-tasks <names>', 'Comma-separated task names to force (e.g., "input-orders,load-products")')
  .option('--force-regex <pattern>', 'Regex to match task names as force-tasks')
  .option('--timezone <tz>', 'IANA timezone (e.g., "Australia/Sydney")')
  .option('--description <text>', 'Human-readable description')
  .option('--enabled <bool>', 'Enable or disable the schedule (true/false)', 'true')
  .action(scheduleCommand.set);

schedule
  .command('get')
  .description('View the schedule for a workspace')
  .argument('<url>', 'Workspace URL')
  .action(scheduleCommand.get);

schedule
  .command('remove')
  .description('Remove the schedule for a workspace')
  .argument('<url>', 'Workspace URL')
  .action(scheduleCommand.remove);

schedule
  .command('list')
  .description('List all schedules for a repository')
  .argument('<url>', 'Repository URL (e.g., https://server/repos/my-repo)')
  .action(scheduleCommand.list);

// e3-cloud compute <subcommand>
const compute = program
  .command('compute')
  .description('Task compute size configuration');

compute
  .command('set')
  .description('Set compute size for a task')
  .argument('<url>', 'Workspace URL (e.g., https://server/repos/my-repo/workspaces/main)')
  .argument('<task>', 'Task name (or regex pattern with --regex)')
  .requiredOption('--size <size>', 'Compute size (serverless, small, medium, large, xlarge)')
  .option('--regex', 'Treat task argument as a regex pattern')
  .action(computeCommand.set);

compute
  .command('get')
  .description('Get compute size for a task')
  .argument('<url>', 'Workspace URL')
  .argument('<task>', 'Task name')
  .action(computeCommand.get);

compute
  .command('list')
  .description('List all compute configs for a workspace')
  .argument('<url>', 'Workspace URL')
  .action(computeCommand.list);

compute
  .command('remove')
  .description('Remove compute config for a task')
  .argument('<url>', 'Workspace URL')
  .argument('<task>', 'Task name (or regex pattern with --regex)')
  .option('--regex', 'Treat task argument as a regex pattern')
  .action(computeCommand.remove);

// e3-cloud timeout <subcommand>
const timeout = program
  .command('timeout')
  .description('Task timeout configuration');

timeout
  .command('set')
  .description('Set timeout for a task')
  .argument('<url>', 'Workspace URL (e.g., https://server/repos/my-repo/workspaces/main)')
  .argument('<task>', 'Task name (or regex pattern with --regex)')
  .requiredOption('--timeout <duration>', 'Timeout (e.g., 120, 2h, 1d)')
  .option('--regex', 'Treat task argument as a regex pattern')
  .action(timeoutCommand.set);

timeout
  .command('get')
  .description('Get timeout for a task')
  .argument('<url>', 'Workspace URL')
  .argument('<task>', 'Task name')
  .action(timeoutCommand.get);

timeout
  .command('list')
  .description('List all timeout configs for a workspace')
  .argument('<url>', 'Workspace URL')
  .action(timeoutCommand.list);

timeout
  .command('remove')
  .description('Remove timeout config for a task')
  .argument('<url>', 'Workspace URL')
  .argument('<task>', 'Task name (or regex pattern with --regex)')
  .option('--regex', 'Treat task argument as a regex pattern')
  .action(timeoutCommand.remove);

// e3-cloud settings <subcommand>
const settings = program
  .command('settings')
  .description('Per-user workspace settings');

settings
  .command('get')
  .description('Get user settings for a workspace')
  .argument('<url>', 'Workspace URL (e.g., https://server/repos/my-repo/workspaces/main)')
  .option('--output <file>', 'Write settings to a file instead of stdout')
  .action(settingsCommand.get);

settings
  .command('set')
  .description('Set user settings for a workspace')
  .argument('<url>', 'Workspace URL')
  .option('--input <file>', 'Read settings from a file')
  .option('--data <text>', 'Use text as settings data')
  .action(settingsCommand.set);

settings
  .command('remove')
  .description('Remove user settings for a workspace')
  .argument('<url>', 'Workspace URL')
  .action(settingsCommand.remove);

program.parse();
