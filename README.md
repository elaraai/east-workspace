# East Workspace

This is the **meta repository** for coordinating all East programming language repositories. It uses git submodules to pin compatible versions of all components.

## 🎯 Purpose

The East project consists of multiple repositories with different licenses and purposes:
- **Core language** (TypeScript, AGPL-3.0)
- **Backend compilers** (Julia, Python - Proprietary)
- **Platform bindings** (Node.js, Python - AGPL-3.0)
- **Tooling** (MCP, plugins - AGPL-3.0)

This workspace ensures that all repositories work together by tracking specific commit SHAs that are known to be compatible.

## 📦 Repository Structure

```
east-workspace/
├── east/              # Core TypeScript language & IR definitions (AGPL-3.0)
├── East.jl/           # Julia backend compiler (Proprietary)
├── east-py/           # Python backend runtime (Proprietary)
├── east-node/         # Node.js platform bindings (AGPL-3.0)
├── east-node-io/      # Node.js I/O platform functions (AGPL-3.0)
├── east-py-io/        # Python I/O platform functions (AGPL-3.0)
├── east-py-std/       # Python standard platform functions (AGPL-3.0)
├── east-mcp/          # Model Context Protocol integration (AGPL-3.0)
└── east-plugin/       # Claude Code plugin (AGPL-3.0)
```

## 🚀 Getting Started

### First Time Setup

```bash
# Clone this repository with all submodules
git clone --recursive git@github.com:elaraai/east-workspace
cd east-workspace

# Or if already cloned without --recursive
git submodule update --init --recursive
```

Alternatively, use the setup script:

```bash
./setup.sh
```

### Checking Status

To see the status of all repositories:

```bash
./status.sh
```

This shows:
- Git status of each submodule
- Current branch and commit
- Unpushed commits
- Commits behind remote

### Updating Submodules

To update all submodules to their latest commits:

```bash
./update.sh
```

**⚠️ Important:** After updating, you should:
1. Run tests across all projects
2. Commit the submodule changes to lock the new versions
3. Push to lock these versions for the team

## 🔧 Working with Submodules

### Making Changes in a Submodule

```bash
# Navigate to the submodule
cd east

# Create a branch and make changes
git checkout -b my-feature
# ... make changes ...
git commit -m "Add new feature"
git push origin my-feature

# Return to meta repo
cd ..

# The meta repo now shows the submodule has uncommitted changes
git status
```

### Updating Meta Repo to Track New Submodule Commit

```bash
# After merging a PR in a submodule, update the meta repo
cd east
git checkout main
git pull
cd ..

# The meta repo will show 'east' has new commits
git add east
git commit -m "Update east to include new feature"
git push
```

### Making Breaking Changes Safely

This is the **primary use case** for this workspace.

**Workflow:**

1. **Create a branch in the meta repo**
   ```bash
   git checkout -b breaking-change-ir-format
   ```

2. **Make changes in the affected submodules**
   ```bash
   # Update core IR format
   cd east
   git checkout -b update-ir-format
   # ... make breaking changes to IR ...
   git commit -m "BREAKING: Update IR format"
   git push origin update-ir-format
   cd ..

   # Update Julia backend to support new IR
   cd East.jl
   git checkout -b support-new-ir
   # ... update compiler ...
   git commit -m "Support new IR format from east"
   git push origin support-new-ir
   cd ..

   # Update Python backend
   cd east-py
   git checkout -b support-new-ir
   # ... update runtime ...
   git commit -m "Support new IR format from east"
   git push origin support-new-ir
   cd ..
   ```

3. **Update meta repo to track these branches**
   ```bash
   git add east East.jl east-py
   git commit -m "WIP: Breaking IR format change across all backends"
   git push origin breaking-change-ir-format
   ```

4. **CI runs integration tests** (see CI section below)
   - Tests will fail if backends don't support the new IR
   - Iterate until all tests pass

5. **Merge PRs in coordination**
   ```bash
   # Merge backend PRs first
   # Then merge core PR
   # Finally, update meta repo to main branches
   ```

6. **Update meta repo main branch**
   ```bash
   git checkout main
   git pull
   ./update.sh  # Get latest from all submodules
   git add .
   git commit -m "Release v0.1.0: New IR format with backend support"
   git push
   ```

## 🧪 Testing

### Local Testing

Each submodule has its own test suite:

```bash
# TypeScript projects
cd east && npm test

# Julia project
cd East.jl && julia --project=. -e 'using Pkg; Pkg.test()'

# Python projects
cd east-py && pytest
```

### Integration Testing

CI runs integration tests across all projects to ensure compatibility (see `.github/workflows/integration-test.yml`).

## 📋 Release Process

**We don't have a formal release process yet.** This workspace establishes the foundation for one.

Proposed workflow:
1. Ensure all submodules are on their main branches
2. Run `./status.sh` to verify everything is clean
3. Tag the meta repo: `git tag v0.1.0`
4. Tag each submodule with coordinated versions
5. Push tags: `git push --tags` (in meta repo and each submodule)

## 🔍 Git Submodules Cheat Sheet

```bash
# Clone with all submodules
git clone --recursive <url>

# Initialize submodules after clone
git submodule update --init --recursive

# Update submodules to latest on their tracked branches
git submodule update --remote

# See which commits are tracked in submodules
git submodule status

# See changes in submodules since last commit
git submodule summary

# Execute command in all submodules
git submodule foreach 'git status'

# Pull latest in all repos
git pull --recurse-submodules
```

## ⚠️ Common Pitfalls

1. **Detached HEAD in submodules**
   - Submodules checkout specific commits, not branches
   - Always `git checkout main` before making changes in a submodule

2. **Forgetting to commit submodule updates**
   - After pulling changes in a submodule, commit the reference update in meta repo
   - Otherwise team members won't get the update

3. **Nested submodules**
   - Use `--recursive` flag to handle nested submodules

4. **File dependencies**
   - TypeScript projects use `file:../east` dependencies
   - Python projects use `file:../east-py` dependencies
   - This requires the workspace directory structure

## 📚 Further Reading

- [Git Submodules Documentation](https://git-scm.com/book/en/v2/Git-Tools-Submodules)
- [Atlassian Submodules Tutorial](https://www.atlassian.com/git/tutorials/git-submodule)

## 📄 License

This meta repository is private. Individual submodules have their own licenses:
- **AGPL-3.0**: east, east-node, east-node-io, east-py-io, east-py-std, east-mcp, east-plugin
- **Proprietary**: East.jl, east-py

---

**Questions?** Check the individual repository READMEs or ask the team.
