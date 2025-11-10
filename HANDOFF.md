# East Workspace - Handoff Notes

## What Was Done

Created the `east-workspace` meta repository structure using git submodules to coordinate all 9 East repositories.

### Current State

**✅ Completed:**
- Meta repository initialized at `/home/ferris/dev/east-workspace`
- All 9 repos added as git submodules
- Coordination scripts created (`setup.sh`, `update.sh`, `status.sh`)
- GitHub Actions CI workflow for integration testing
- Documentation (`README.md`, `BREAKING_CHANGES.md`)
- Initial commit made to meta repo

**⚠️ Known Issues (Not Fixed Yet):**
- Python projects have hardcoded absolute paths: `/home/crambelsoupy/src/east-py`
  - Affects: `east-py-io/pyproject.toml` and `east-py-std/pyproject.toml`
  - Need to change to: `file://../east-py` (relative path)
- Submodules are pointing at arbitrary commits (whatever was fetched)
  - May not be fully compatible with each other
  - Need to identify and lock known-good versions
- No GitHub repository created yet (meta repo is only local)

## Repository Structure

```
east-workspace/
├── .github/workflows/
│   └── integration-test.yml      # CI that tests all components together
├── east/                          # Core TypeScript language (AGPL-3.0)
├── East.jl/                       # Julia backend (Proprietary)
├── east-py/                       # Python backend (Proprietary)
├── east-node/                     # Node.js platform (AGPL-3.0)
├── east-node-io/                  # Node.js I/O bindings (AGPL-3.0)
├── east-py-io/                    # Python I/O bindings (AGPL-3.0)
├── east-py-std/                   # Python std bindings (AGPL-3.0)
├── east-mcp/                      # MCP integration (AGPL-3.0)
├── east-plugin/                   # Claude Code plugin (AGPL-3.0)
├── setup.sh                       # New developer setup script
├── update.sh                      # Update all submodules script
├── status.sh                      # Check status across all repos
├── README.md                      # Full documentation
├── BREAKING_CHANGES.md            # Workflow guide for coordinated changes
└── .gitmodules                    # Submodule configuration
```

## Current Submodule Commits

Run `git submodule status` to see what commits each submodule is pinned to:

```bash
cd /home/ferris/dev/east-workspace
git submodule status
```

These are just whatever commits were checked out when we added the submodules. They're not necessarily compatible.

## How to Use This (For Your Team)

### New Developer Setup

```bash
git clone --recursive git@github.com:elaraai/east-workspace
cd east-workspace
./setup.sh
```

### Making Breaking Changes

See `BREAKING_CHANGES.md` for the full workflow. Summary:

1. Create branch in meta repo: `git checkout -b breaking/my-change`
2. Make changes in affected submodules (create feature branches)
3. Update meta repo to track those feature branches
4. CI tests everything together
5. Merge submodule PRs (backends first, then core)
6. Update meta repo to track merged commits

### Checking Status

```bash
./status.sh
# Shows git status of all 9 repos + meta repo
```

### Updating to Latest

```bash
./update.sh
# Pulls latest from all submodules
# Don't forget to commit the updated references!
```

## Technical Details

### Why Submodules?

- **Version locking:** Each commit in the meta repo pins exact SHAs of all components
- **License flexibility:** Can mix public (AGPL) and private (proprietary) repos
- **Independent evolution:** Each repo has its own release cycle
- **Breaking change coordination:** CI enforces compatibility before merging

### Alternatives Considered

- **Monorepo:** Rejected due to mixed licensing and different languages
- **Version manifest only:** Too loose, doesn't enforce compatibility
- **Package registry:** Good for distribution, but doesn't help with development

### Git Submodules Gotchas

- Submodules checkout specific commits (detached HEAD by default)
- Always create a branch before making changes in a submodule
- After pulling in a submodule, commit the reference update in meta repo
- Use `--recursive` when cloning or pulling

## Questions?

- **Repository setup:** See `README.md`
- **Breaking changes:** See `BREAKING_CHANGES.md`
- **CI configuration:** See `.github/workflows/integration-test.yml`
- **Git submodules help:** https://git-scm.com/book/en/v2/Git-Tools-Submodules

---