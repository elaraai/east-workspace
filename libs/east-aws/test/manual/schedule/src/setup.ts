/**
 * Setup script for schedule manual test.
 *
 * Creates repo, imports package, creates workspace, deploys, and sets a 1-minute schedule.
 */

import { readFileSync } from 'node:fs';
import { none, some } from '@elaraai/east';
import {
  repoCreate,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  ApiError,
} from '@elaraai/e3-api-client';
import { setSchedule } from '@elaraai/e3-cloud-client';
import { getToken } from './credentials.js';
import { createPackage, PACKAGE_NAME, PACKAGE_VERSION } from './package-def.js';

const SERVER = 'https://dev.e3.elaraai.com';
const REPO_NAME = 'schedule-test';
const WORKSPACE = 'test-schedule';

async function main() {
  const token = await getToken(SERVER);
  const opts = { token };

  // 1. Create repo (idempotent)
  console.log(`Creating repo "${REPO_NAME}"...`);
  try {
    await repoCreate(SERVER, REPO_NAME, opts);
    console.log('  Repo created');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'already_exists') {
      console.log('  Repo already exists');
    } else {
      throw err;
    }
  }

  // 2. Build and import package
  console.log(`Building package ${PACKAGE_NAME}@${PACKAGE_VERSION}...`);
  const zipPath = await createPackage();
  const archive = readFileSync(zipPath);
  console.log(`Importing package...`);
  await packageImport(SERVER, REPO_NAME, archive, opts);
  console.log('  Package imported');

  // 3. Create workspace (idempotent)
  console.log(`Creating workspace "${WORKSPACE}"...`);
  try {
    await workspaceCreate(SERVER, REPO_NAME, WORKSPACE, opts);
    console.log('  Workspace created');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'already_exists') {
      console.log('  Workspace already exists');
    } else {
      throw err;
    }
  }

  // 4. Deploy package
  const packageRef = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;
  console.log(`Deploying ${packageRef}...`);
  await workspaceDeploy(SERVER, REPO_NAME, WORKSPACE, packageRef, opts);
  console.log('  Deployed');

  // 5. Set schedule (every minute)
  console.log('Setting schedule (every minute)...');
  const schedule = await setSchedule(SERVER, REPO_NAME, WORKSPACE, {
    cronExpression: '* * * * *',
    timezone: none,
    forceTasks: ['timestamp'],
    enabled: true,
    description: some('Manual schedule test — runs every minute'),
  }, opts);
  console.log('  Schedule set');

  // Summary
  console.log('\n=== Setup Complete ===');
  console.log(`  Server:     ${SERVER}`);
  console.log(`  Repo:       ${REPO_NAME}`);
  console.log(`  Workspace:  ${WORKSPACE}`);
  console.log(`  Package:    ${packageRef}`);
  console.log(`  Cron:       ${schedule.cronExpression}`);
  console.log(`  Scheduler:  ${schedule.schedulerName}`);
  console.log('\nCheck status with: npm run status -w e3-manual-schedule-test');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
