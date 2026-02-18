/**
 * Teardown script for schedule manual test.
 *
 * Removes the schedule, workspace, and repo.
 */

import { workspaceRemove, repoRemove } from '@elaraai/e3-api-client';
import { removeSchedule } from '@elaraai/e3-cloud-client';
import { getToken } from './credentials.js';

const SERVER = 'https://dev.e3.elaraai.com';
const REPO_NAME = 'schedule-test';
const WORKSPACE = 'test-schedule';

async function main() {
  const token = await getToken(SERVER);
  const opts = { token };

  // 1. Remove schedule
  console.log('Removing schedule...');
  try {
    await removeSchedule(SERVER, REPO_NAME, WORKSPACE, opts);
    console.log('  Schedule removed');
  } catch (err) {
    console.log(`  Schedule removal: ${err}`);
  }

  // 2. Remove workspace
  console.log('Removing workspace...');
  try {
    await workspaceRemove(SERVER, REPO_NAME, WORKSPACE, opts);
    console.log('  Workspace removed');
  } catch (err) {
    console.log(`  Workspace removal: ${err}`);
  }

  // 3. Remove repo
  console.log('Removing repo...');
  try {
    await repoRemove(SERVER, REPO_NAME, opts);
    console.log('  Repo removed');
  } catch (err) {
    console.log(`  Repo removal: ${err}`);
  }

  console.log('\nCleaned up');
}

main().catch((err) => {
  console.error('Teardown failed:', err);
  process.exit(1);
});
