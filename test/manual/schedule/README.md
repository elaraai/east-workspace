# Schedule Manual Test

End-to-end test for scheduled execution: creates a repo, deploys a package with a time-dependent task, sets a 1-minute schedule, and verifies repeated execution.

## Prerequisites

```bash
e3 login https://dev.e3.elaraai.com
```

## Usage

```bash
# Create repo, deploy package, set 1-minute schedule
npm run setup -w e3-manual-schedule-test

# Check schedule and recent execution state
npm run status -w e3-manual-schedule-test

# Remove schedule, workspace, and repo
npm run teardown -w e3-manual-schedule-test
```

## What It Does

1. **Setup**: Creates a `schedule-test` repo, imports a package with a `timestamp` task (returns `Time.now()` — milliseconds since epoch), deploys to workspace `test-schedule`, and sets a cron schedule to run every minute with `forceTaskPatterns: ['*']`.
2. **Status**: Prints the current schedule configuration and latest dataflow execution state.
3. **Teardown**: Removes the schedule, workspace, and repo.
