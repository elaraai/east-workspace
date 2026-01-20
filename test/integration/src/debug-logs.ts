/**
 * Debug script to test task logging
 *
 * Creates a task that uses Console.log to produce log output,
 * then verifies the logs can be retrieved via the API.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  repoCreate,
  repoRemove,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  dataflowExecute,
  taskLogs,
} from '@elaraai/e3-api-client';
import { StringType, IntegerType, NullType, East } from '@elaraai/east';
import e3 from '@elaraai/e3';

// Define console_log as a platform function (matches east-py-std's console_log)
const console_log = East.platform('console_log', [StringType], NullType);

async function createLoggingPackageZip(tempDir: string, name: string, version: string): Promise<string> {
  mkdirSync(tempDir, { recursive: true });

  const count = e3.input('count', IntegerType, 3n);

  // Task that logs messages
  const logger = e3.task(
    'logger',
    [count],
    East.function([IntegerType], StringType, ($, n) => {
      // Log several messages
      $(console_log(East.str`Starting logger task with count=${n}`));
      $(console_log('Processing item 1...'));
      $(console_log('Processing item 2...'));
      $(console_log('Processing item 3...'));
      $(console_log('All items processed!'));
      return East.str`Completed ${n} items`;
    })
  );

  const pkg = e3.package(name, version, logger);
  const zipPath = join(tempDir, `${name}-${version}.zip`);
  await e3.export(pkg, zipPath);
  return zipPath;
}

const API_URL = 'https://dev.e3.elaraai.com';

// Read credentials
const credsFile = readFileSync(join(process.env.HOME!, '.e3', 'credentials.json'), 'utf8');
const creds = JSON.parse(credsFile);
const token = creds.credentials[API_URL]?.accessToken;

if (!token) {
  console.error('No token found for', API_URL);
  console.error(`Run: e3 login ${API_URL}`);
  process.exit(1);
}

const opts = { token };

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'logs-debug-'));
  const repoName = `debug-logs-${Date.now()}`;

  try {
    console.log('=== Creating repo:', repoName);
    await repoCreate(API_URL, repoName, opts);
    console.log('Repo created');

    console.log('\n=== Creating logging package');
    const zipPath = await createLoggingPackageZip(tempDir, 'logging-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(API_URL, repoName, packageZip, opts);
    console.log('Package imported');

    console.log('\n=== Creating workspace');
    await workspaceCreate(API_URL, repoName, 'test-ws', opts);
    console.log('Workspace created');

    console.log('\n=== Deploying package');
    await workspaceDeploy(API_URL, repoName, 'test-ws', 'logging-pkg@1.0.0', opts);
    console.log('Package deployed');

    console.log('\n=== Executing dataflow (this should produce logs)');
    const result = await dataflowExecute(API_URL, repoName, 'test-ws', { force: true }, opts, {});
    console.log('Execution result:');
    console.log('  - Executed:', result.executed);
    console.log('  - Cached:', result.cached);
    console.log('  - Failed:', result.failed);

    console.log('\n=== Retrieving logs for logger task (stdout)');
    const stdoutLogs = await taskLogs(API_URL, repoName, 'test-ws', 'logger', { stream: 'stdout' }, opts);
    console.log('--- STDOUT ---');
    console.log(stdoutLogs.data || '(empty)');

    console.log('\n=== Retrieving logs for logger task (stderr)');
    const stderrLogs = await taskLogs(API_URL, repoName, 'test-ws', 'logger', { stream: 'stderr' }, opts);
    if (stderrLogs.data) {
      console.log('--- STDERR ---');
      console.log(stderrLogs.data);
    } else {
      console.log('(no stderr output)');
    }

    console.log('\n=== Cleanup: Removing repo');
    await repoRemove(API_URL, repoName, opts);
    console.log('Repo removed');

  } catch (err: any) {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);

    // Try to clean up on error
    try {
      await repoRemove(API_URL, repoName, opts);
    } catch {
      // Ignore cleanup errors
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
