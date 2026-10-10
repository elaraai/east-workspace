# OpenCode with Anthropic API credits

OpenCode uses the direct Anthropic API, locally and in GitHub Actions. The
repository configuration selects `anthropic/claude-opus-5-5`; Haiku 5.5 handles
small background tasks. It loads the existing `CLAUDE.md`, East skills and
East example-search MCP server. Session sharing is disabled.

## API credits and login

Claim Max/Team API credits in Claude's Billing settings by linking the Console
organization that will receive them. Create an API key in that same
organization. These credits are separate from interactive subscription limits
and are applied by Anthropic to eligible API requests.

Use a Console API key with OpenCode. An OAuth URL containing
`scope=org:create_api_key` and `user:sessions:claude_code` belongs to a CLI login
flow; it is not the Max API-credit claim page. A 400 there does not establish
whether the API balance is usable.

See [Anthropic's credit instructions](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans).

## Local setup

Install the tested OpenCode version:

```bash
npm install --global opencode-ai@1.18.35
```

Install the key selector, then add each key under a memorable name. For example:

```bash
mkdir -p ~/.local/bin
install -m 755 scripts/opencode-key.py ~/.local/bin/opencode-key
opencode-key add personal --default --github-repo elaraai/east-workspace
opencode-key add team --github-repo elaraai/east-workspace
opencode-key run
```

Use your own profile names in place of `personal` and `team`. Names use lowercase
letters, digits, hyphens or underscores. Adding a key prompts privately in your
terminal and makes one small Opus request to check API access. The helper stores
profiles with mode 0600 under OpenCode's data directory and uploads the selected
key to GitHub through `gh` standard input. Other saved providers are preserved.
Run without `--github-repo` for local access only. Rerunning reuses the saved key;
add `--replace` to rotate it. Never put the key in the repository or a chat message.

`opencode-key run` shows a picker containing names only. Select directly with
`opencode-key run team`, or pass OpenCode arguments after the name, for example
`opencode-key run team -- run "Explain this project"`. Each process gets its own
key selection, so concurrent sessions can use different keys. Plain `opencode`
uses the default profile. `opencode-key list` lists names without showing keys.

The helper verifies an API request succeeds. Check the Console Billing page to
confirm which credit balance funds it; the API response does not report that.

OpenCode's own interactive alternative is `opencode auth login --provider anthropic`.
Choose the API-key method. This configures the local credential only.

## GitHub issues and pull requests

The helper creates a GitHub environment named `anthropic-NAME` for each profile,
with its own `ANTHROPIC_API_KEY` environment secret. Existing environments'
protection rules are preserved. The default is stored in the non-secret repository
variable `OPENCODE_KEY_PROFILE`. All keys must belong to their intended Console
organization; selecting a key determines which organization receives the usage.

After `.github/workflows/opencode.yml` reaches the default branch, choose
**Actions → OpenCode → Run workflow**. The **API key profile** dropdown lists
environments: select an `anthropic-` entry. Enter a task to run Opus 5.5, or leave
the task empty to make a small API check without changing code or posting a comment.
Adding another profile makes it available without editing the workflow.

For issues and pull requests, select a key in the comment:

```text
/opencode --key=team implement this issue and open a pull request
```

Omit `--key=...` to use the configured default. `/oc ...` also works. Put the key
selector immediately after the command. Review comments retain their line context
and attachments. Selection is explicit; the helper does not switch to another
key when credits run out. Every profile uses Opus 5.5.

The workflow checks that the commenter has write, maintain or admin access.
It uses the repository's `GITHUB_TOKEN`, so no separate GitHub App or personal
token is required. Repository Actions settings must allow creating pull
requests. It runs Opus 5.5 and publishes no OpenCode session share link.

The runner provides Node 22, pnpm, uv and installed TypeScript dependencies.
The agent follows the applicable `CLAUDE.md` and `STANDARDS.md` files and builds
the affected libraries through their Makefiles. Additional native, Python or
browser dependencies remain task-specific.

Pull requests created or updated with `GITHUB_TOKEN` may show an **Approve
workflows to run** button before their CI starts. A repository writer can approve
those runs. GitHub runner usage is billed separately from Anthropic model usage.
See [GitHub's workflow trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

OpenCode's GitHub integration makes direct Anthropic API calls. Anthropic's
separate Claude Code GitHub Action is excluded from the monthly API credits;
it is not used here. See [OpenCode's GitHub documentation](https://opencode.ai/docs/github/).
