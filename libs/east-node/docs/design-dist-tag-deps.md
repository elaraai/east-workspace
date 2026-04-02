# Design: Use npm dist-tags for dependency versions

## Problem

The `update-deps.yml` workflow manually resolves the latest beta version of `@elaraai/east` from npm, compares it against the current pinned version, rewrites all `package.json` files with the new version via `make set-east-version`, then opens a PR. This involves ~40 lines of shell scripting for version lookup/comparison logic that npm already knows how to do.

## Solution

Replace explicit semver ranges (e.g. `"^0.0.1-beta.31"`) with the npm dist-tag `"beta"` in `package.json`. Then `npm update` resolves the tag to the latest published beta version and updates the lockfile. The lockfile still pins the exact resolved version.

## How npm dist-tags work

Every npm package has named tags pointing to specific versions. Common tags:

- `latest` — default, used by `npm install foo`
- `beta` — used by `npm install foo@beta`

When `"beta"` appears as a version range in `package.json`, `npm install` / `npm update` resolves it to whatever version the `beta` tag currently points to on the registry. The resolved version is recorded in `package-lock.json`.

## Changes per repo

### 1. Update `package.json` files

Replace every `@elaraai/east` version specifier with `"beta"`:

**Before:**
```json
"@elaraai/east": "^0.0.1-beta.31"
```

**After:**
```json
"@elaraai/east": "beta"
```

Where this appears depends on the repo:

| Location | Field | Example |
|---|---|---|
| Root `package.json` | `dependencies` or `devDependencies` | Monorepos that hoist the dep |
| Package `package.json` | `peerDependencies` | Libraries declaring compatibility |
| Package `package.json` | `devDependencies` | Packages that need it for tests |

### 2. Run `npm install` to update the lockfile

After changing the specifiers, run `npm install` so the lockfile reflects the resolved version.

### 3. Replace the `update-deps.yml` workflow

The entire version-checking logic is replaced by `npm update` + a lockfile diff.

**New workflow:**

```yaml
name: Update Dependencies

on:
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * 1' # optional: weekly Monday

jobs:
  update-deps:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Generate app token
        uses: actions/create-github-app-token@v1
        id: app-token
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}

      - uses: actions/checkout@v4
        with:
          token: ${{ steps.app-token.outputs.token }}

      - name: Configure git
        run: |
          git config user.name "elara-ci[bot]"
          git config user.email "elara-ci[bot]@users.noreply.github.com"

      - name: Use Node.js 22.x
        uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: 'npm'
          registry-url: 'https://registry.npmjs.org'

      - name: Update dependencies
        id: update
        run: |
          BEFORE=$(node -p "require('./package-lock.json').packages['node_modules/@elaraai/east'].version")
          npm update @elaraai/east
          AFTER=$(node -p "require('./package-lock.json').packages['node_modules/@elaraai/east'].version")

          echo "before=${BEFORE}" >> $GITHUB_OUTPUT
          echo "after=${AFTER}" >> $GITHUB_OUTPUT

          if git diff --quiet package-lock.json; then
            echo "has_updates=false" >> $GITHUB_OUTPUT
            echo "Already on latest: ${BEFORE}"
          else
            echo "has_updates=true" >> $GITHUB_OUTPUT
            echo "Update available: ${BEFORE} -> ${AFTER}"
          fi

      - name: Create update branch
        if: steps.update.outputs.has_updates == 'true'
        run: |
          BRANCH_NAME="deps/east-${{ steps.update.outputs.after }}"
          git checkout -b "$BRANCH_NAME"
          echo "branch_name=${BRANCH_NAME}" >> $GITHUB_ENV

      # --- repo-specific steps (build, lint, test) go here ---
      # Copy the existing build/lint/test steps from the current workflow.
      # The only change is removing the `make set-east-version` and
      # `npm install` steps since `npm update` already handled both.

      - name: Build
        if: steps.update.outputs.has_updates == 'true'
        run: npm run build

      - name: Run linter
        if: steps.update.outputs.has_updates == 'true'
        id: lint
        run: npm run lint
        continue-on-error: true

      # Include docker/test steps if the repo needs them

      - name: Determine test status
        if: steps.update.outputs.has_updates == 'true'
        id: test_status
        run: |
          if [[ "${{ steps.lint.outcome }}" == "success" ]]; then
            echo "passed=true" >> $GITHUB_OUTPUT
            echo "emoji=✅" >> $GITHUB_OUTPUT
            echo "message=All checks passed" >> $GITHUB_OUTPUT
          else
            echo "passed=false" >> $GITHUB_OUTPUT
            echo "emoji=❌" >> $GITHUB_OUTPUT
            echo "message=Checks failed - manual fixes required" >> $GITHUB_OUTPUT
          fi

      - name: Commit and push
        if: steps.update.outputs.has_updates == 'true'
        run: |
          git add package-lock.json
          git commit -m "deps: update @elaraai/east to ${{ steps.update.outputs.after }}"
          git push -u --force origin "${{ env.branch_name }}"

      - name: Create Pull Request
        if: steps.update.outputs.has_updates == 'true'
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
        run: |
          gh label create dependencies --color 0366d6 --description "Dependency updates" 2>/dev/null || true

          EXISTING_PR=$(gh pr list --head "${{ env.branch_name }}" --json number --jq '.[0].number' 2>/dev/null || echo "")

          PR_TITLE="${{ steps.test_status.outputs.emoji }} deps: update @elaraai/east to ${{ steps.update.outputs.after }}"
          PR_BODY="## Dependency Update

          Updates \`@elaraai/east\` from \`${{ steps.update.outputs.before }}\` to \`${{ steps.update.outputs.after }}\`.

          ### Status: ${{ steps.test_status.outputs.emoji }} ${{ steps.test_status.outputs.message }}

          ---
          *This PR was automatically generated by the update-deps workflow.*"

          if [[ -n "$EXISTING_PR" ]]; then
            gh pr edit "$EXISTING_PR" --title "$PR_TITLE" --body "$PR_BODY"
          else
            gh pr create --title "$PR_TITLE" --body "$PR_BODY" --label "dependencies" --head "${{ env.branch_name }}"
          fi
```

### 4. Clean up Makefile (optional)

The `set-east-version` target is no longer needed for the beta workflow. It can be kept for manually switching to a specific version (e.g. going stable), or removed.

## Applying to a repo — checklist

1. **Find all `@elaraai/east` version specifiers:**
   ```bash
   grep -r '"@elaraai/east"' --include='package.json' -l
   ```

2. **Replace versions with `"beta"`** in every match (skip `package-lock.json` and `node_modules`).

3. **Run `npm install`** to re-resolve the lockfile.

4. **Replace `update-deps.yml`** with the simplified workflow above, adding any repo-specific build/test steps in the marked section.

5. **Remove `set-east-version`** from Makefile if present.

6. **Commit all changes** (`package.json` files, `package-lock.json`, workflow, Makefile).

## Trade-off: published packages

When these packages are published to npm, consumers will see `"@elaraai/east": "beta"` in peerDependencies. This means their `npm install` resolves `beta` to whatever it points to at their install time, not a fixed semver range. This is fine during beta when everything moves in lockstep. When going stable, switch back to explicit semver ranges (e.g. `"^1.0.0"`).
