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
# Run daily at 2 AM, forcing datasource tasks
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --cron "0 2 * * *" \
  --force-tasks "input*,load_*" \
  --description "Nightly data refresh"

# Set with explicit timezone
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --cron "0 14 * * 1-5" \
  --force-tasks "load_orders" \
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

## Structure

```
src/
├── cli.ts              # Entry point with command definitions
├── credentials.ts      # Token management (shared with e3-cli)
├── utils.ts            # URL parsing, error formatting
└── commands/
    ├── whoami.ts       # whoami command
    ├── user.ts         # user list/add/remove commands
    └── schedule.ts     # schedule set/get/remove/list commands
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
