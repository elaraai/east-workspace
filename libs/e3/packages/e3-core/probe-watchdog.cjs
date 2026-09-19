// PROBE (scratch branch only): preloaded into every node process of a probe
// run. 20 s into an east-node runner (100 s into anything else) it records a
// marker with the active resources — before the report, which asks every
// worker for its part and could itself wait on a stuck one — then a
// diagnostic report. A runner that finishes normally exits long before.
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { threadId } = require('node:worker_threads');

const dir = process.env.E3_PROBE_REPORTS;
if (dir) {
  const runner = process.argv.some((a) => a.includes('east-node'));
  setTimeout(() => {
    try {
      writeFileSync(join(dir, `marker-${process.pid}-${threadId}.txt`),
        `timer fired at ${new Date().toISOString()}; active resources ${JSON.stringify(process.getActiveResourcesInfo())}`);
      writeFileSync(join(dir, `report-${process.pid}-${threadId}.json`), JSON.stringify(process.report.getReport()));
    } catch (e) {
      writeFileSync(join(dir, `error-${process.pid}-${threadId}.txt`), String(e && e.stack));
    }
  }, runner ? 20_000 : 100_000).unref();
}
