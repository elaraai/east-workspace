/**
 * Status script for schedule manual test.
 *
 * Shows current schedule configuration and latest execution state.
 */

import { dataflowExecution } from '@elaraai/e3-api-client';
import { getSchedule, listSchedules } from '@elaraai/e3-cloud-client';
import { getToken } from './credentials.js';

const SERVER = 'https://dev.e3.elaraai.com';
const REPO_NAME = 'schedule-test';
const WORKSPACE = 'test-schedule';

async function main() {
  const token = await getToken(SERVER);
  const opts = { token };

  // 1. Get schedule
  console.log('=== Schedule ===');
  const schedule = await getSchedule(SERVER, REPO_NAME, WORKSPACE, opts);
  if (schedule) {
    console.log(`  Cron:        ${schedule.cronExpression}`);
    console.log(`  Enabled:     ${schedule.enabled}`);
    console.log(`  Timezone:    ${JSON.stringify(schedule.timezone)}`);
    console.log(`  Description: ${JSON.stringify(schedule.description)}`);
    console.log(`  Scheduler:   ${schedule.schedulerName}`);
    console.log(`  Created:     ${schedule.createdAt}`);
    console.log(`  Updated:     ${schedule.updatedAt}`);
  } else {
    console.log('  No schedule found');
  }

  // 2. Get latest execution state
  console.log('\n=== Latest Execution State ===');
  try {
    const state = await dataflowExecution(SERVER, REPO_NAME, WORKSPACE, undefined, opts);
    console.log(JSON.stringify(state, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value, 2));
  } catch (err) {
    console.log(`  No execution state: ${err}`);
  }

  // 3. List all schedules for repo
  console.log('\n=== All Schedules ===');
  const schedules = await listSchedules(SERVER, REPO_NAME, opts);
  if (schedules.length === 0) {
    console.log('  None');
  } else {
    for (const s of schedules) {
      console.log(`  ${s.workspace}: cron="${s.cronExpression}" enabled=${s.enabled}`);
    }
  }
}

main().catch((err) => {
  console.error('Status check failed:', err);
  process.exit(1);
});
