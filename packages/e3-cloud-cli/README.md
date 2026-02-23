# @elaraai/e3-cloud-cli

CLI tool for e3 cloud management.

## Installation

```bash
npm install
npm run build -w @elaraai/e3-cloud-cli
```

## Usage

### Prerequisites

Login using the e3 CLI first (credentials are shared):

```bash
e3 login https://dev.e3.elaraai.com
```

### Commands

#### Check current identity

```bash
# Use first stored credential
e3-cloud whoami

# Or specify server explicitly
e3-cloud whoami https://dev.e3.elaraai.com
```

Output:
```
sub: abc123-def456
email: alice@example.com
name: Alice Smith
admin: true
```

#### List repository users

```bash
e3-cloud user list https://dev.e3.elaraai.com/repos/my-repo
```

Output:
```
USER ID             EMAIL                         ROLE      ADDED
abc123-def456       alice@example.com             owner     2025-01-29T10:00:00
xyz789-uvw012       bob@example.com               member    2025-01-30T14:30:00
```

#### Add a user to a repository

```bash
# Add as member (default role)
e3-cloud user add https://dev.e3.elaraai.com/repos/my-repo charlie@example.com

# Add as owner
e3-cloud user add https://dev.e3.elaraai.com/repos/my-repo charlie@example.com --role owner
```

#### Remove a user from a repository

```bash
e3-cloud user remove https://dev.e3.elaraai.com/repos/my-repo charlie@example.com
```

#### Set a workspace schedule

```bash
# Run daily at 2 AM, forcing specific tasks
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --cron "0 2 * * *" \
  --force-tasks "input-orders,load-products" \
  --description "Nightly data refresh"

# Force tasks matching a regex (resolves against deployed task list)
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --cron "0 2 * * *" \
  --force-regex "input.*" \
  --description "Nightly data refresh"

# Set with explicit timezone
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --cron "0 14 * * 1-5" \
  --force-tasks "load-orders" \
  --timezone "America/New_York" \
  --description "Weekday 2 PM ET refresh"

# Disable without removing
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --enabled false
```

#### View a workspace schedule

```bash
e3-cloud schedule get https://dev.e3.elaraai.com/repos/acme/workspaces/main
```

#### Remove a workspace schedule

```bash
e3-cloud schedule remove https://dev.e3.elaraai.com/repos/acme/workspaces/main
```

#### List all schedules for a repository

```bash
e3-cloud schedule list https://dev.e3.elaraai.com/repos/acme
```

#### Set compute size for a task

```bash
# Set a single task to medium Fargate
e3-cloud compute set https://dev.e3.elaraai.com/repos/acme/workspaces/main "my-task" --size medium

# Set all tasks matching a regex pattern
e3-cloud compute set https://dev.e3.elaraai.com/repos/acme/workspaces/main "load_.*" --size large --regex

# Reset a task back to serverless (Lambda)
e3-cloud compute set https://dev.e3.elaraai.com/repos/acme/workspaces/main "my-task" --size serverless
```

Valid sizes: `serverless` (default, Lambda), `small` (2 vCPU / 8 GB), `medium` (4 vCPU / 16 GB), `large` (8 vCPU / 32 GB), `xlarge` (16 vCPU / 64 GB).

#### View compute size for a task

```bash
e3-cloud compute get https://dev.e3.elaraai.com/repos/acme/workspaces/main "my-task"
```

#### List all compute configs for a workspace

```bash
e3-cloud compute list https://dev.e3.elaraai.com/repos/acme/workspaces/main
```

#### Remove compute config for a task

```bash
# Remove a single task config (reverts to serverless)
e3-cloud compute remove https://dev.e3.elaraai.com/repos/acme/workspaces/main "my-task"

# Remove by regex pattern
e3-cloud compute remove https://dev.e3.elaraai.com/repos/acme/workspaces/main "load_.*" --regex
```

#### Set timeout for a task

```bash
# Set timeout in minutes
e3-cloud timeout set https://dev.e3.elaraai.com/repos/acme/workspaces/main "my-task" --timeout 120

# Set timeout in hours
e3-cloud timeout set https://dev.e3.elaraai.com/repos/acme/workspaces/main "my-task" --timeout 2h

# Set timeout in days
e3-cloud timeout set https://dev.e3.elaraai.com/repos/acme/workspaces/main "my-task" --timeout 1d

# Set timeout for multiple tasks by regex
e3-cloud timeout set https://dev.e3.elaraai.com/repos/acme/workspaces/main "load_.*" --timeout 4h --regex
```

Valid range: 5 minutes to 30 days (43200 minutes). Accepts: minutes (e.g., `120`), hours (e.g., `2h`), days (e.g., `1d`).

#### View timeout for a task

```bash
e3-cloud timeout get https://dev.e3.elaraai.com/repos/acme/workspaces/main "my-task"
```

#### List all timeout configs for a workspace

```bash
e3-cloud timeout list https://dev.e3.elaraai.com/repos/acme/workspaces/main
```

#### Remove timeout config for a task

```bash
# Remove a single task timeout (reverts to default)
e3-cloud timeout remove https://dev.e3.elaraai.com/repos/acme/workspaces/main "my-task"

# Remove by regex pattern
e3-cloud timeout remove https://dev.e3.elaraai.com/repos/acme/workspaces/main "load_.*" --regex
```

## Structure

```
src/
├── cli.ts              # Entry point with command definitions
├── credentials.ts      # Token management (shared with e3-cli)
├── utils.ts            # URL parsing, error formatting
└── commands/
    ├── whoami.ts       # whoami command
    ├── user.ts         # user list/add/remove commands
    ├── schedule.ts     # schedule set/get/remove/list commands
    ├── compute.ts      # compute set/get/list/remove commands
    └── timeout.ts      # timeout set/get/list/remove commands
```

## Development

```bash
# Build
npm run build -w @elaraai/e3-cloud-cli

# Lint
npm run lint -w @elaraai/e3-cloud-cli

# Run locally
./packages/e3-cloud-cli/dist/src/cli.js whoami
```
