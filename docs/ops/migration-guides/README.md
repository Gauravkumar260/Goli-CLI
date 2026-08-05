# Migration Guides

This directory holds version-specific migration guides for upgrading
Goli-CLI. Each guide covers the breaking changes, the new features,
and the step-by-step upgrade process.

## Index

| From → To     | File                           | Breaking?                        |
| ------------- | ------------------------------ | -------------------------------- |
| 0.1.x → 0.2.0 | [0.1-to-0.2.md](0.1-to-0.2.md) | Yes (config schema)              |
| 0.2.x → 0.3.0 | [0.2-to-0.3.md](0.2-to-0.3.md) | No (additive — Studio is opt-in) |
| 0.3.x → 1.0.0 | (planned)                      | TBD                              |

## General upgrade process

1. **Read the migration guide** for the version you're upgrading to.
2. **Back up** `~/.goli/`:
   ```bash
   tar czf goli-backup-$(date +%F).tar.gz ~/.goli/
   ```
3. **Check the changelog**:
   ```bash
   goli --version
   cat $(npm root -g)/goli-cli/CHANGELOG.md | head -100
   ```
4. **Upgrade**:
   ```bash
   npm update -g goli-cli
   # OR from source:
   git pull && npm install && npm run build
   ```
5. **Verify**:
   ```bash
   goli doctor
   goli --version
   goli -p "hello" --headless-output json
   ```
6. **Update config** if the migration guide says to.
7. **Resume normal use**.

## Self-hosted stacks

If you're running a self-hosted stack (vLLM + LiteLLM + Langfuse),
also:

1. Back up Postgres and ClickHouse.
2. `git pull` in the `infra/` directory.
3. `docker compose pull` to get the new images.
4. `docker compose up -d` to apply.
5. Check the migration guide for any infra-level breaking changes.

## Rolling back

If the upgrade breaks something:

1. **CLI**:
   ```bash
   npm install -g goli-cli@<previous-version>
   ```
2. **Self-hosted**:
   ```bash
   cd infra
   git checkout <previous-tag>
   docker compose up -d
   ```
3. **Restore backup** if needed:
   ```bash
   tar xzf goli-backup-YYYY-MM-DD.tar.gz -C /
   ```
4. **File an issue** at
   [github.com/goli-cli/goli-cli/issues](https://github.com/goli-cli/goli-cli/issues)
   so we can fix the regression.

## SemVer policy

Goli-CLI follows [Semantic Versioning](https://semver.org/):

- **Major** (0.x → 1.0, 1.x → 2.0): breaking changes. Read the
  migration guide carefully.
- **Minor** (0.2 → 0.3): new features, no breaking changes. Upgrade
  is safe.
- **Patch** (0.3.0 → 0.3.1): bug fixes only. Always safe.

During 0.x (pre-1.0), minor versions may include breaking changes
(but we try not to). Read the migration guide for every minor
release.

## See also

- [CHANGELOG.md](../../../CHANGELOG.md) — full change history.
- [Deployment Guide](../deployment-guide.md) — for new deployments.
- [Release Process](../release-process.md) — how we cut releases.
