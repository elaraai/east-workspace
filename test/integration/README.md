# e3-aws Integration Tests

Integration tests and demos for the e3 cloud platform.

## Prerequisites

1. **AWS CLI** configured with SSO:
   ```bash
   aws sso login --profile elaraai-dev-elara-e3
   ```

2. **e3 CLI** logged in to the platform:
   ```bash
   e3 login https://dev.e3.elaraai.com
   ```

3. **Dependencies** installed:
   ```bash
   npm install
   npm run build
   ```

## Running Tests

```bash
# Run all integration tests
AWS_PROFILE=elaraai-dev-elara-e3 npm test

# Run specific test suite
AWS_PROFILE=elaraai-dev-elara-e3 npm test -- --test-name-pattern "dataflow"

# Run API compliance tests only
AWS_PROFILE=elaraai-dev-elara-e3 npm test -- --test-name-pattern "API Compliance"
```

## Demo: Interacting with a Workspace

The platform has a demo repository at `https://dev.e3.elaraai.com/repos/demo` with a workspace `dev` that contains a simple dataflow pipeline.

### View Workspace Status

```bash
# List workspaces in the demo repo
e3 workspace list https://dev.e3.elaraai.com/repos/demo

# Show workspace status (datasets and tasks)
e3 workspace status https://dev.e3.elaraai.com/repos/demo dev
```

### Work with Datasets

```bash
# List root-level fields in workspace
e3 list https://dev.e3.elaraai.com/repos/demo dev

# List inputs
e3 list https://dev.e3.elaraai.com/repos/demo dev.inputs

# List task outputs
e3 list https://dev.e3.elaraai.com/repos/demo dev.tasks

# Get an input value
e3 get https://dev.e3.elaraai.com/repos/demo dev.inputs.x

# Get a task output
e3 get https://dev.e3.elaraai.com/repos/demo dev.tasks.add.output

# Set an input value from a file
echo '42' > /tmp/x.east && e3 set https://dev.e3.elaraai.com/repos/demo dev.inputs.x /tmp/x.east
```

### Execute Dataflow

```bash
# Execute all tasks in the workspace
e3 start https://dev.e3.elaraai.com/repos/demo dev

# Force re-execution (bypass cache)
e3 start https://dev.e3.elaraai.com/repos/demo dev --force

# Execute with higher concurrency
e3 start https://dev.e3.elaraai.com/repos/demo dev --concurrency 8
```

### View Task Logs

```bash
# View logs for a specific task
e3 logs https://dev.e3.elaraai.com/repos/demo dev.add

# View logs for another task
e3 logs https://dev.e3.elaraai.com/repos/demo dev.format

# Follow logs in real-time (for long-running tasks)
e3 logs https://dev.e3.elaraai.com/repos/demo dev.add --follow
```

### View Task Details

```bash
# List all tasks
e3 task list https://dev.e3.elaraai.com/repos/demo dev

# Get details for a specific task
e3 task get https://dev.e3.elaraai.com/repos/demo dev add
```

## Debug Scripts

### Test Logging

Creates a task that produces log output via `Console.log`:

```bash
node dist/debug-logs.js
```

This will:
1. Create a temporary repository
2. Deploy a package with a logging task
3. Execute the task
4. Display the captured logs
5. Clean up

### Test Datasets

Debug script for dataset operations:

```bash
node dist/debug-dataset.js
```

## Example: Complete Workflow

```bash
# 1. Check authentication
e3 auth whoami https://dev.e3.elaraai.com

# 2. View current state
e3 workspace status https://dev.e3.elaraai.com/repos/demo dev

# 3. Modify an input
echo '100' > /tmp/x.east && e3 set https://dev.e3.elaraai.com/repos/demo dev.inputs.x /tmp/x.east

# 4. Execute the dataflow
e3 start https://dev.e3.elaraai.com/repos/demo dev

# 5. Check the results
e3 get https://dev.e3.elaraai.com/repos/demo dev.tasks.format.output

# 6. View execution logs
e3 logs https://dev.e3.elaraai.com/repos/demo dev.format
```

## API Endpoints

The platform exposes these endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /.well-known/openid-configuration` | OIDC discovery |
| `POST /api/device/authorize` | Start device flow |
| `GET /api/repos` | List repositories |
| `POST /api/repos/:repo` | Create repository |
| `GET /api/repos/:repo/status` | Repository status |
| `GET /api/repos/:repo/workspaces` | List workspaces |
| `POST /api/repos/:repo/workspaces/:ws/dataflow` | Start execution |
| `GET /api/repos/:repo/workspaces/:ws/dataflow/execution` | Poll execution |

For authenticated requests, use the token from `e3 auth token`:

```bash
curl -H "Authorization: Bearer $(e3 auth token https://dev.e3.elaraai.com)" \
  https://dev.e3.elaraai.com/api/repos/demo/status
```

## Troubleshooting

### "Not logged in" error

```bash
e3 login https://dev.e3.elaraai.com
```

### "Token expired" error

The CLI automatically refreshes tokens, but if refresh fails:

```bash
e3 logout https://dev.e3.elaraai.com
e3 login https://dev.e3.elaraai.com
```

### Check current credentials

```bash
e3 auth status
e3 auth whoami https://dev.e3.elaraai.com
```
