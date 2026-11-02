#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Command } from 'commander';
import { resolveBudget, type Budget } from '@elaraai/e3-core';
import { createServer, type DataflowRunnerFactory } from './server.js';
import { resolveCallLimits, type CallLimits } from './call-limits.js';

const program = new Command();

program
  .name('e3-api-server')
  .description('HTTP server for e3 repositories')
  .version('0.0.1-beta.0')
  .option('--repos <dir>', 'Directory containing e3 repositories (multi-repo mode)')
  .option('--repo <path>', 'Path to a single repository (single-repo mode, access via /repos/default)')
  .option('-p, --port <port>', 'HTTP port', '3000')
  .option('-H, --host <host>', 'Bind address', 'localhost')
  .option('--cors', 'Enable CORS')
  .option('--rack', 'Delegate eligible tasks to the rack enrolled with this machine (needs @elaraai/e3-rack)')
  .option('--oidc', 'Enable built-in OIDC authentication provider')
  .option('--token-expiry <duration>', 'Access token expiry (e.g., "5s", "15m", "1h")', '1h')
  .option('--refresh-token-expiry <duration>', 'Refresh token expiry (e.g., "1h", "7d", "90d")', '90d')
  .option('--auth-key <path>', 'JWT public key path (external auth)')
  .option('--auth-issuer <iss>', 'Expected JWT issuer (external auth)')
  .option('--auth-audience <aud>', 'Expected JWT audience (external auth)')
  .option('-j, --jobs <n>', 'Cores: runner processes to keep in flight across every run and call the server serves and every upload it takes in (default: $E3_JOBS, else the CPUs available)')
  .option('--memory <size>', 'Memory those runner processes may reserve between them, as 8G or 512M (default: $E3_MEMORY, else the memory available, less a reserve for e3 and the OS)')
  .option('--call-deadline <duration>', 'How long a one-shot or function call may run before it answers, as 90s or 15m (default: 120s); a call that names no timeout of its own gets 60s within it')
  .option('--job-timeout <duration>', 'How long a split call\'s job may run, as 30m or 2h, which is also the longest timeout a one-shot call may ask for (default: 10m)')
  .option('--max-result <size>', 'The largest result a one-shot or split call answers, as 8M (default: 1M). The server holds a result in memory while it answers it, so a larger limit takes more of it; a split call\'s larger result is read from its stored output, by its hash')
  .option('--max-log <size>', 'The most of each of a call\'s stdout and stderr its answer may carry, as 1M (default: 256K; a call that names no limit gets 64K)')
  .action(async (options: {
    repos?: string;
    repo?: string;
    port: string;
    host: string;
    cors?: boolean;
    rack?: boolean;
    oidc?: boolean;
    tokenExpiry: string;
    refreshTokenExpiry: string;
    authKey?: string;
    authIssuer?: string;
    authAudience?: string;
    jobs?: string;
    memory?: string;
    callDeadline?: string;
    jobTimeout?: string;
    maxResult?: string;
    maxLog?: string;
  }) => {
    // Validate mutually exclusive options
    if (options.repos && options.repo) {
      console.error('Error: Cannot specify both --repos and --repo');
      process.exit(1);
    }
    if (!options.repos && !options.repo) {
      console.error('Error: Must specify either --repos or --repo');
      process.exit(1);
    }

    const port = parseInt(options.port, 10);
    const host = options.host;

    let budget: Budget;
    let calls: CallLimits;
    try {
      budget = resolveBudget({ jobs: options.jobs, memory: options.memory });
      calls = resolveCallLimits({
        callDeadline: options.callDeadline, jobTimeout: options.jobTimeout, maxResult: options.maxResult, maxLog: options.maxLog,
      });
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    // Build auth config if all auth options provided (external provider)
    const auth = options.authKey && options.authIssuer && options.authAudience
      ? {
          publicKeyPath: options.authKey,
          issuer: options.authIssuer,
          audience: options.authAudience,
        }
      : undefined;

    // Build OIDC config if enabled (built-in provider)
    const oidc = options.oidc
      ? {
          baseUrl: `http://${host}:${port}`,
          tokenExpiry: options.tokenExpiry,
          refreshTokenExpiry: options.refreshTokenExpiry,
        }
      : undefined;

    let dataflowRunner: DataflowRunnerFactory | undefined;
    if (options.rack) {
      try {
        // A dynamic optional peer keeps the ordinary server independent of
        // rack. Resolve at runtime so the server also builds before its peer.
        const moduleName = '@elaraai/e3-rack';
        const rack = await import(moduleName) as { createDataflowRunnerFactory(options: { labelPrefix: string }): DataflowRunnerFactory };
        dataflowRunner = rack.createDataflowRunnerFactory({ labelPrefix: 'e3-api-server' });
      } catch (error) {
        console.error('--rack needs @elaraai/e3-rack installed next to e3-api-server');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    }

    const server = await createServer({
      reposDir: options.repos,
      singleRepoPath: options.repo,
      port,
      host,
      cors: options.cors,
      auth,
      oidc,
      budget,
      calls,
      dataflowRunner,
    });

    await server.start();
    console.log(`e3-api-server listening on http://${host}:${server.port}`);
    if (options.repos) {
      console.log(`Serving repositories from: ${options.repos}`);
    } else {
      console.log(`Serving single repository from: ${options.repo}`);
      console.log(`Access via: http://${host}:${server.port}/repos/default`);
    }
    console.log(`Budget: ${budget.cores} ${budget.cores === 1 ? 'core' : 'cores'}, ${(budget.memory / 1024 ** 3).toFixed(1)} GiB`);
    if (oidc) {
      console.log(`OIDC provider enabled (token expiry: ${options.tokenExpiry})`);
      if (process.env.E3_AUTH_AUTO_APPROVE === '1') {
        console.log('  Auto-approve mode enabled (E3_AUTH_AUTO_APPROVE=1)');
      }
    }

    // Handle shutdown signals
    const shutdown = async () => {
      console.log('\nShutting down...');
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });

program.parse();
