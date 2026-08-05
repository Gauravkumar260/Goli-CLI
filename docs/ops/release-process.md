# Release Process — Goli-CLI

> **Audience:** Maintainers who cut releases.
> **Last updated:** 2026-07-25

This document describes the process for cutting a Goli-CLI release.
It covers the pre-release checks, the release itself, and the
post-release verification.

## 1. Release types

| Type      | Frequency             | Example         | Breaking?                       |
| --------- | --------------------- | --------------- | ------------------------------- |
| **Patch** | As needed (bug fixes) | `0.3.0 → 0.3.1` | No                              |
| **Minor** | Monthly               | `0.3.1 → 0.4.0` | Should not (but may during 0.x) |
| **Major** | Yearly                | `0.x → 1.0.0`   | Yes                             |
| **Beta**  | Before minor/major    | `0.4.0-beta.1`  | N/A                             |

## 2. Pre-release checklist

Before cutting any release, verify:

- [ ] All CI gates pass on `main`.
- [ ] The eval suite is within tolerance (no >2pp regression from
      baseline).
- [ ] `CHANGELOG.md` has an entry for every `feat:` and `fix:`
      commit since the last release.
- [ ] `SECURITY.md` is up to date.
- [ ] `legal/ai-bom.spdx.json` reflects the current models used.
- [ ] Migration guide is written (for minor/major).
- [ ] A maintainer has run a manual smoke test (see §3).
- [ ] The SBOM is regenerated: `npm run sbom:gen`.

For major releases, also:

- [ ] Beta period of 1-2 weeks has elapsed with no open P0/P1
      issues for 3 days.
- [ ] All deprecation warnings from the previous version have
      become errors (or are documented as deferred).
- [ ] `docs/` is updated for all new features.
- [ ] The release notes blog post is drafted.

## 3. Manual smoke test

A maintainer must verify the following flows on their local machine
before cutting the release:

### CLI

```bash
# Install the release candidate
npm install -g goli-cli@<version-tag>

# Smoke test
goli --version              # prints <version>
goli --help                 # works
goli doctor                 # all checks pass
goli -p "hello" --headless-output json   # returns valid JSON
goli wakeup                 # TUI starts
# In TUI:
#   /help                    # works
#   /mode plan               # works
#   /theme                   # works
#   /exit                    # works
goli status                 # shows recent sessions
goli wakeup --resume <id>   # resumes a session
```

### Studio (for releases that touch `packages/studio/`)

```bash
npm run studio:db:push
npm run studio:runtime &
npm run studio:dev
# Open http://localhost:3000
# - Send a prompt
# - Watch tokens stream
# - See a tool call execute
# - Approve a permission prompt
# - Switch to Demo mode in Settings
# - Resume a past session
```

### Self-hosted stack (for releases that touch `infra/`)

```bash
cd infra
docker compose pull
docker compose up -d
# Verify each service is healthy:
curl http://localhost:8000/health    # vLLM
curl http://localhost:4000/health   # LiteLLM
curl http://localhost:3000/api/health  # Langfuse
```

## 4. Cutting the release

### 4.1 Bump version

```bash
# For a patch release (0.3.0 → 0.3.1)
npm version patch -m "release: 0.3.1"

# For a minor release (0.3.1 → 0.4.0)
npm version minor -m "release: 0.4.0"

# For a major release (0.x → 1.0.0)
npm version major -m "release: 1.0.0"
```

This bumps `package.json`, creates a `v0.3.1` tag, and pushes both.

### 4.2 Verify the tag

```bash
git log -1 v0.3.1
# Should show: release: 0.3.1
```

### 4.3 Publish to npm

The release is published automatically by GitHub Actions when the
tag is pushed. Verify:

```bash
# Wait ~5 minutes for the publish action to complete.
npm view goli-cli@0.3.1
# Should show the new version.
```

If the publish failed, do **not** re-tag. Fix the issue, bump the
patch version, and re-release. (We never re-publish the same
version.)

### 4.4 Publish to GitHub Releases

```bash
gh release create v0.3.1 \
  --title "0.3.1" \
  --notes "$(cat CHANGELOG.md | sed -n '/## \[0.3.1\]/,/## \[0.3.0\]/p' | sed '1d;\$d')"
```

Attach:

- The SBOM: `sbom/spdx.json` → `sbom-spdx-0.3.1.json`.
- The AI BOM: `legal/ai-bom.spdx.json` → `ai-bom-0.3.1.json`.

### 4.5 Update the documentation

- Update the `version` badge in `README.md`.
- Update `docs/requirements/prd.md` revision history.
- Update `docs/requirements/srs.md` revision history.
- For minor/major: add a migration guide in
  `docs/ops/migration-guides/`.
- For minor/major: write release notes (see
  `docs/ops/release-notes/<version>.md`).

## 5. Post-release verification

Within 1 hour of release:

- [ ] `npm install -g goli-cli@<version>` works.
- [ ] `npx goli-cli@<version> --version` prints the new version.
- [ ] `goli --version` on a fresh install prints the new version.
- [ ] The GitHub Release page shows the new release.
- [ ] The npm page shows the new version.
- [ ] The Docker image (if applicable) is published.
- [ ] No regression in the nightly eval (check the next morning).

Within 24 hours:

- [ ] Watch GitHub Issues for regression reports.
- [ ] Watch the community channel (Discord / GitHub Discussions)
      for feedback.
- [ ] If a P0 regression is found, yank the release:
  ```bash
  npm deprecate goli-cli@<version> "Use <previous-version> instead; see issue #NNNN"
  ```
  And cut a patch release within 72 hours.

## 6. Yanking a release

If a release has a serious regression:

1. **Yank on npm**:
   ```bash
   npm deprecate goli-cli@<version> "Use <previous-version> instead; see issue #NNNN"
   ```
   (We can't un-publish — npm doesn't allow it after 24 hours, and
   even within 24 hours it's discouraged because users may have
   already installed.)
2. **Mark as broken on GitHub Releases**: edit the release and
   prepend "⚠️ BROKEN — see issue #NNNN" to the title.
3. **Announce** in the community channel.
4. **Cut a patch release** within 72 hours with the fix.
5. **Write a postmortem** (use the
   [postmortem template](postmortems/_template.md)) if the regression
   affected >10 users.

## 7. Beta releases

For minor and major releases, cut a beta first:

1. Bump to `0.4.0-beta.1`:
   ```bash
   npm version prerelease --preid=beta -m "release: 0.4.0-beta.1"
   ```
2. Publish: GitHub Actions picks up the tag.
3. Announce in the community channel: "0.4.0-beta.1 is out; please
   test and report issues with the `beta` label."
4. Run the beta for 1-2 weeks. Fix P0/P1 issues found in beta.
5. When no P0/P1 issues remain for 3 days, cut the stable:
   ```bash
   npm version 0.4.0 -m "release: 0.4.0"
   ```

## 8. See also

- [CHANGELOG.md](../../CHANGELOG.md)
- [Migration Guides](migration-guides/)
- [Deployment Guide](deployment-guide.md)
- [QA Strategy](../qa/qa-strategy.md)
- [SECURITY.md](../../SECURITY.md)
