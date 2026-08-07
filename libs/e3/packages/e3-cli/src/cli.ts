#!/usr/bin/env -S node --stack-size=8192

/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 CLI - East Execution Engine command-line interface
 *
 * Top-level command tree:
 *
 *   repo      create | remove | status | gc | list
 *   package   import | export | list | remove
 *   workspace create | remove | list | status | deploy | export
 *   dataset   get | set | list | status | find
 *   task      logs | list
 *   dataflow  run
 *   auth      login | logout | status | token | whoami
 *   run       <pkg.task> <inputs...> -o <out>     (ad-hoc)
 *   call      <pkg.fn> [args...] [-o <out>]       (named functions)
 *   watch     <source> [<ws>]
 *   convert   <input> [...]
 *
 * Every command that takes <repo> accepts a local path or http(s) URL — the
 * transport is detected from the argument.
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as { version: string };

import { repoCommand } from './commands/repo.js';
import { packageCommand } from './commands/package.js';
import { workspaceCommand } from './commands/workspace.js';
import { listCommand } from './commands/list.js';
import { getCommand } from './commands/get.js';
import { setCommand } from './commands/set.js';
import { startCommand } from './commands/start.js';
import { runCommand } from './commands/run.js';
import { callCommand } from './commands/call.js';
import { mutateCommand } from './commands/mutate.js';
import { historyCommand } from './commands/history.js';
import { compactCommand } from './commands/compact.js';
import { logsCommand, DEFAULT_TAIL_LINES } from './commands/logs.js';
import { datasetStatusCommand } from './commands/dataset-status.js';
import { findCommand } from './commands/find.js';
import { convertCommand } from './commands/convert.js';
import { watchCommand } from './commands/watch.js';
import { createAuthCommand } from './commands/auth.js';
import { completionCommand } from './commands/completion.js';
import { installCommand as completionInstall, uninstallCommand as completionUninstall } from './commands/completion-install.js';
import { completeCommand } from './commands/complete.js';
import { withDefaultRepo, defaultRepoArg } from './utils.js';

const program = new Command();

program
  .name('e3')
  .description('East Execution Engine - Execute tasks across multiple runtimes')
  .version(packageJson.version);

// ---------------------------------------------------------------------------
// repo
// ---------------------------------------------------------------------------
program
  .command('repo')
  .description('Repository operations')
  .addCommand(
    new Command('create')
      .description('Create a new repository')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .option('--exist-ok', 'Succeed without error if the repository already exists')
      .action(withDefaultRepo(repoCommand.create))
  )
  .addCommand(
    new Command('remove')
      .description('Remove a repository')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .option('-r, --recursive', 'Remove all workspaces first')
      .action(withDefaultRepo(repoCommand.remove))
  )
  .addCommand(
    new Command('status')
      .description('Show repository status')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .action(withDefaultRepo(repoCommand.status))
  )
  .addCommand(
    new Command('gc')
      .description('Remove unreferenced objects')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .option('--dry-run', 'Report what would be deleted without deleting')
      .option('--min-age <ms>', 'Minimum file age in ms before deletion', '60000')
      .action(withDefaultRepo(repoCommand.gc))
  )
  .addCommand(
    new Command('list')
      .description('List repositories on a server')
      .argument('<server>', 'Server URL (e.g., http://localhost:3000)')
      .action(repoCommand.list)
  );

// ---------------------------------------------------------------------------
// package
// ---------------------------------------------------------------------------
program
  .command('package')
  .description('Package operations')
  .addCommand(
    new Command('import')
      .description('Import package from .zip file')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<zipPath>', 'Path to .zip file')
      .option('--quiet', 'Suppress progress and success output (errors only)')
      .action(withDefaultRepo(packageCommand.import))
  )
  .addCommand(
    new Command('export')
      .description('Export package to .zip file')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<pkg>', 'Package name[@version]')
      .argument('<zipPath>', 'Output .zip path')
      .option('--quiet', 'Suppress progress and success output (errors only)')
      .action(withDefaultRepo(packageCommand.export))
  )
  .addCommand(
    new Command('list')
      .description('List installed packages')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .action(withDefaultRepo(packageCommand.list))
  )
  .addCommand(
    new Command('remove')
      .description('Remove a package')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<pkg>', 'Package name[@version]')
      .action(withDefaultRepo(packageCommand.remove))
  );

// ---------------------------------------------------------------------------
// workspace
// ---------------------------------------------------------------------------
program
  .command('workspace')
  .description('Workspace operations')
  .addCommand(
    new Command('create')
      .description('Create an empty workspace')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<name>', 'Workspace name')
      .action(withDefaultRepo(workspaceCommand.create))
  )
  .addCommand(
    new Command('deploy')
      .description('Deploy a package to a workspace')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<ws>', 'Workspace name')
      .argument('[pkg]', 'Package name[@version] (omit when using --from-zip / --from-source)')
      .option('--from-zip <path>', 'Import the zip and deploy (creates the workspace if needed)')
      .option('--from-source <path>', 'Bundle a TypeScript source file into a package, then import and deploy (creates the workspace if needed)')
      .option('--quiet', 'Suppress progress and success output (errors only)')
      .action(withDefaultRepo(workspaceCommand.deploy))
  )
  .addCommand(
    new Command('export')
      .description('Export workspace as a package')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<ws>', 'Workspace name')
      .argument('<zipPath>', 'Output .zip path')
      .option('--name <name>', 'Package name (default: deployed package name)')
      .option('--version <version>', 'Package version (default: auto-generated)')
      .option('--quiet', 'Suppress progress and success output (errors only)')
      .action(withDefaultRepo(workspaceCommand.export))
  )
  .addCommand(
    new Command('list')
      .description('List workspaces')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .action(withDefaultRepo(workspaceCommand.list))
  )
  .addCommand(
    new Command('remove')
      .description('Remove a workspace')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<ws>', 'Workspace name')
      .action(withDefaultRepo(workspaceCommand.remove))
  )
  .addCommand(
    new Command('status')
      .description('Show detailed workspace status (tasks, datasets, locks)')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<ws>', 'Workspace name')
      .action(withDefaultRepo(workspaceCommand.status))
  );

// ---------------------------------------------------------------------------
// dataset
// ---------------------------------------------------------------------------
program
  .command('dataset')
  .description('Dataset operations within a workspace')
  .addCommand(
    new Command('get')
      .description('Print a dataset value (path: <ws>.<name>)')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<path>', 'Dataset path (<ws>.<name>)')
      .option('-f, --format <format>', 'Output format: east, json, beast2', 'east')
      .action(withDefaultRepo(getCommand))
  )
  .addCommand(
    new Command('set')
      .description('Set a dataset value from a file (path: <ws>.<name>)')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<path>', 'Dataset path (<ws>.<name>)')
      .argument('<file>', 'Path to .east, .beast2, .json, or .csv file')
      .option('--type <typespec>', 'Inline .east type specification (required for .json/.csv)')
      .option('--type-file <path>', 'Read .east type specification from a file (alternative to --type)')
      .action(withDefaultRepo(setCommand))
  )
  .addCommand(
    new Command('list')
      .description('List dataset paths in a workspace')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<ws>', 'Workspace name')
      .option('-l, --long', 'Show kind/type/status/size columns')
      .action(withDefaultRepo(listCommand))
  )
  .addCommand(
    new Command('status')
      .description('Show status of a single dataset')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<path>', 'Dataset path (<ws>.<name>)')
      .action(withDefaultRepo(datasetStatusCommand))
  )
  .addCommand(
    new Command('find')
      .description('Search dataset names by substring or glob pattern')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<ws>', 'Workspace name')
      .argument('<pattern>', 'Substring or glob (`*`, `?`)')
      .action(withDefaultRepo(findCommand))
  );

// ---------------------------------------------------------------------------
// task
// ---------------------------------------------------------------------------
program
  .command('task')
  .description('Task operations within a workspace')
  .addCommand(
    new Command('list')
      .description('List tasks in a workspace with execution status')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<ws>', 'Workspace name')
      .action((repo: string | undefined, ws: string) => logsCommand(defaultRepoArg(repo), ws, {}))
  )
  .addCommand(
    new Command('logs')
      .description('View logs for a task')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<path>', 'Task path (<ws>.<task>)')
      .option('-n, --lines <n>', `Show the last <n> lines (default: ${DEFAULT_TAIL_LINES})`)
      .option('--all', 'Show the whole log instead of the last lines')
      .option('--follow', 'Follow log output')
      .action(withDefaultRepo(logsCommand))
  );

// ---------------------------------------------------------------------------
// dataflow
// ---------------------------------------------------------------------------
program
  .command('dataflow')
  .description('Workspace dataflow execution')
  .addCommand(
    new Command('run')
      .description('Execute the workspace dataflow')
      .argument('[repo]', 'Repository path or URL (default: $E3_REPO or .)')
      .argument('<ws>', 'Workspace name')
      .option('--filter <pattern>', 'Only run tasks matching pattern')
      .option('--concurrency <n>', 'Max concurrent tasks', '4')
      .option('--partition-concurrency <n>', 'Max concurrent partition slices/combine steps within a partitioned task (local runs)', '4')
      .option('--force', 'Force re-execution even if cached')
      .option('-v, --verbose', "Pass -v to each task's runner (timing/perf to stderr)")
      .action(withDefaultRepo(startCommand))
  );

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------
program.addCommand(createAuthCommand());

// ---------------------------------------------------------------------------
// run (ad-hoc) — uses pkg.task dot syntax
// ---------------------------------------------------------------------------
program
  .command('run')
  .description('Run a task ad-hoc from a package (task: pkg.task or pkg@version.task)')
  .argument('<repo>', 'Repository path or URL')
  .argument('<task>', 'Task specifier: pkg.task or pkg@version.task')
  .argument('[inputs...]', 'Input file paths (.beast2)')
  .option('-o, --output <path>', 'Output file path')
  .option('--force', 'Force re-execution even if cached')
  .option('-v, --verbose', "Pass -v to the runner (timing/perf to stderr)")
  .action(runCommand);

// ---------------------------------------------------------------------------
// call — named package functions (graph-free, persists nothing)
// ---------------------------------------------------------------------------
program
  .command('call')
  .description('Call a named package function (function: pkg.fn or pkg@version.fn)')
  .argument('<repo>', 'Repository path or URL')
  .argument('<fn>', 'Function specifier: pkg.fn or pkg@version.fn (with --workspace: fn)')
  .argument('[args...]', 'Arguments: .east literals or .beast2/.json/.east file paths')
  .option('-w, --workspace <ws>', 'Call against the package deployed in a workspace')
  .option('-o, --output <path>', 'Write the result to a .beast2 file instead of printing')
  .option('-v, --verbose', "Pass -v to the runner (timing/perf to stderr; local or remote)")
  .action(callCommand);

// ---------------------------------------------------------------------------
// mutate — apply a mutation to a record (the only write door; audited commit)
// ---------------------------------------------------------------------------
program
  .command('mutate')
  .description('Apply a mutation to a record (mutation: record.mutation)')
  .argument('<repo>', 'Repository path or URL')
  .argument('<mutation>', 'Mutation specifier: record.mutation')
  .argument('[args...]', 'Arguments: .east literals or .beast2/.json/.east file paths')
  .option('-w, --workspace <ws>', 'Workspace holding the record (required)')
  .option('-v, --verbose', "Pass -v to the reducer's runner (timing/perf to stderr; local or remote)")
  .action(mutateCommand);

// ---------------------------------------------------------------------------
// history — a record's commit history (newest first)
// ---------------------------------------------------------------------------
program
  .command('history')
  .description("Show a record's commit history (newest first)")
  .argument('<repo>', 'Repository path or URL')
  .argument('<record>', 'Record name')
  .option('-w, --workspace <ws>', 'Workspace holding the record (required)')
  .option('--limit <n>', 'Maximum number of commits to show')
  .option('--from <hash>', 'Commit hash to start the walk at (page cursor)')
  .action(historyCommand);

// ---------------------------------------------------------------------------
// compact — drop a record's prior commit chain (state unchanged)
// ---------------------------------------------------------------------------
program
  .command('compact')
  .description("Compact a record's history (drops the prior chain; state unchanged)")
  .argument('<repo>', 'Repository path or URL')
  .argument('<record>', 'Record name')
  .option('-w, --workspace <ws>', 'Workspace holding the record (required)')
  .action(compactCommand);

// ---------------------------------------------------------------------------
// watch — source first, workspace second
// ---------------------------------------------------------------------------
program
  .command('watch')
  .description('Watch a TypeScript file and auto-deploy on changes')
  .argument('<source>', 'TypeScript file to watch')
  .argument('<repo>', 'Repository path or URL')
  .argument('<workspace>', 'Workspace name')
  .option('--start', 'Execute dataflow after each deploy')
  .option('--concurrency <n>', 'Max concurrent tasks when using --start', '4')
  .option('--abort-on-change', 'Abort running execution when file changes')
  .action(watchCommand);

// ---------------------------------------------------------------------------
// convert
// ---------------------------------------------------------------------------
program
  .command('convert')
  .description('Convert between .east, .json, and .beast2 formats')
  .argument('[input]', 'Input file path (default: read from stdin)')
  .option('--from <format>', 'Input format: east, json, beast2 (default: auto-detect)')
  .option('--to <format>', 'Output format: east, json, beast2', 'east')
  .option('-o, --output <path>', 'Output file path (default: stdout)')
  .option('--type <typespec>', 'Type specification in .east format')
  .action(convertCommand);

// ---------------------------------------------------------------------------
// completion (shell scripts) + __complete (hidden handler for the scripts)
// ---------------------------------------------------------------------------
program
  .command('completion')
  .description('Shell tab-completion: install, uninstall, or print scripts')
  .addCommand(
    new Command('install')
      .description('Auto-detect shell and wire up completion in your rc file')
      .option('--shell <shell>', 'Override shell detection: bash | zsh | fish')
      .option('--quiet', 'Suppress output on success')
      .action(completionInstall),
  )
  .addCommand(
    new Command('uninstall')
      .description('Remove completion from your shell rc file')
      .option('--shell <shell>', 'Override shell detection: bash | zsh | fish')
      .action(completionUninstall),
  )
  .addCommand(
    new Command('bash')
      .description('Print bash completion script (use `install` to wire it up automatically)')
      .action(() => completionCommand('bash')),
  )
  .addCommand(
    new Command('zsh')
      .description('Print zsh completion script')
      .action(() => completionCommand('zsh')),
  )
  .addCommand(
    new Command('fish')
      .description('Print fish completion script')
      .action(() => completionCommand('fish')),
  );

program
  .command('__complete', { hidden: true })
  .argument('<cword>', 'Index of the word being completed (0-based)')
  .argument('[words...]', 'Words on the command line, excluding the leading e3')
  .action(completeCommand);

program.parse();
