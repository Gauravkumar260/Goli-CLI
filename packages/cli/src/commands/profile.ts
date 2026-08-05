/**
 * Profile manager — multi-instance profile system via GOLI_HOME (T-025).
 *
 * A "profile" is a complete Goli-CLI state directory: config, sessions,
 * trajectories, skills, cron entries, crash snapshots. Profiles allow a
 * user to maintain multiple independent Goli-CLI instances (e.g. work vs
 * personal, or different projects with different agent configurations).
 *
 * ## Profile layout
 *
 *   ~/.goli/
 *     profiles/
 *       default/          ← the default profile (symlink or copy of ~/.goli-cli/)
 *         config.toml
 *         sessions/
 *         trajectories/
 *         skills/
 *         cron.json
 *         crash.json
 *       work/
 *         config.toml
 *         ...
 *       personal/
 *         ...
 *     current             ← file containing the active profile name
 *
 * ## Activation
 *
 * The active profile is determined by:
 *   1. `GOLI_HOME` env var (explicit override — highest priority).
 *   2. `~/.goli/current` file (the saved active profile).
 *   3. `~/.goli-cli/` (legacy default — backwards compatible).
 *
 * Setting `GOLI_HOME` overrides the profile for a single invocation:
 *   GOLI_HOME=~/.goli/profiles/work goli ...
 *
 * Or use the profile commands:
 *   goli profile create work
 *   goli profile use work
 *   goli ...               ← now uses the work profile
 *
 * ## Hermes reference
 *
 * Hermes sets `HERMES_HOME` before any module imports; all paths
 * auto-scope. Goli adopts the same pattern via `getGoliHome()`.
 *
 * @module commands/profile
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Cross-platform home directory: respect HOME env var on all platforms (not just Unix). */
function getHomeDir(): string {
  return process.env['HOME'] ?? homedir();
}

/** The root directory for all profile data: ~/.goli/ */
export function getGoliRoot(): string {
  return join(getHomeDir(), '.goli');
}

/** The profiles directory: ~/.goli/profiles/ */
export function getProfilesDir(): string {
  return join(getGoliRoot(), 'profiles');
}

/** The path to the "current profile" marker file: ~/.goli/current */
export function getCurrentProfileFile(): string {
  return join(getGoliRoot(), 'current');
}

/**
 * The GOLI_HOME directory — the single source of truth for where all
 * Goli-CLI state lives.
 *
 * Resolution order:
 *   1. `GOLI_HOME` env var (explicit override).
 *   2. `~/.goli/current` file (the saved active profile).
 *   3. `~/.goli-cli/` (legacy default — backwards compatible).
 *
 * This function MUST be used by every module that needs the Goli home
 * directory. Direct use of `os.homedir()` is blocked by the ESLint
 * `no-restricted-imports` rule (T-025).
 *
 * @returns The GOLI_HOME directory path.
 */
export function getGoliHome(): string {
  // 1. Explicit env var override.
  const envHome = process.env['GOLI_HOME'];
  if (envHome && envHome.length > 0) {
    return resolve(envHome);
  }

  // 2. Saved active profile.
  const currentFile = getCurrentProfileFile();
  if (existsSync(currentFile)) {
    try {
      const profileName = readFileSync(currentFile, 'utf-8').trim();
      // P1-22 fix: Re-validate the profile name from the `current` file.
      // Previously the raw file contents were used directly in
      // `join(getProfilesDir(), profileName)` — if an attacker (or a
      // malicious script with write access to `~/.goli/current`) wrote
      // `../../../../tmp`, `getGoliHome()` would return `/tmp`, and
      // downstream commands would write state files there. Combined
      // with `rmSync(profile.path, { recursive: true })` in
      // `deleteProfile`, this could delete arbitrary directories.
      //
      // `validateProfileName` enforces `^[a-zA-Z0-9][-a-zA-Z0-9]*$` (no
      // path separators, no `..`), so any traversal-style content is
      // rejected and we fall through to the legacy default.
      const validation = validateProfileName(profileName);
      if (validation.ok) {
        const profileDir = join(getProfilesDir(), profileName);
        if (existsSync(profileDir)) {
          // Defence-in-depth: resolve and confirm the result is still
          // inside `getProfilesDir()`. (join() can produce unexpected
          // paths on Windows if the name contains a drive letter, but
          // validateProfileName already rejects those.)
          const resolved = resolve(profileDir);
          const resolvedRoot = resolve(getProfilesDir());
          if (resolved.startsWith(resolvedRoot + '/') || resolved.startsWith(resolvedRoot + '\\')) {
            return resolved;
          }
        }
      }
    } catch {
      // Fall through to legacy default.
    }
  }

  // 3. Legacy default (backwards compatible with pre-T-025 installs).
  return join(getHomeDir(), '.goli-cli');
}

/** A profile's metadata. */
export interface Profile {
  /** The profile name (e.g. "default", "work", "personal"). */
  name: string;
  /** The profile directory path. */
  path: string;
  /** Whether this is the currently active profile. */
  active: boolean;
  /** ISO creation timestamp (if known). */
  createdAt?: string;
}

/** Validate a profile name. Must be alphanumeric + hyphens, 1-64 chars. */
export function validateProfileName(name: string): { ok: boolean; error?: string } {
  if (!name || name.length === 0) {
    return { ok: false, error: 'Profile name must not be empty' };
  }
  if (name.length > 64) {
    return { ok: false, error: 'Profile name must be 64 characters or fewer' };
  }
  if (!/^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(name)) {
    return { ok: false, error: 'Profile name must be alphanumeric (hyphens allowed, must start with alphanumeric)' };
  }
  // Reserved names.
  const reserved = new Set(['current', 'profiles', 'default']);
  if (reserved.has(name.toLowerCase())) {
    return { ok: false, error: `Profile name '${name}' is reserved` };
  }
  return { ok: true };
}

/** List all profiles. */
export function listProfiles(): Profile[] {
  const profilesDir = getProfilesDir();
  const currentName = getCurrentProfileName();
  const profiles: Profile[] = [];

  if (!existsSync(profilesDir)) {
    // No profiles directory — the legacy default is the only "profile".
      return [
        {
          name: 'default',
          path: join(getHomeDir(), '.goli-cli'),
          active: currentName === null, // active if no profile is set
        },
      ];
  }

  const entries = readdirSync(profilesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profilePath = join(profilesDir, entry.name);
    let createdAt: string | undefined;
    try {
      const stat = lstatSync(profilePath);
      createdAt = stat.birthtime.toISOString();
    } catch {
      // ignore
    }
    profiles.push({
      name: entry.name,
      path: profilePath,
      active: entry.name === currentName,
      createdAt,
    });
  }

  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

/** Get the name of the currently active profile, or null if none. */
export function getCurrentProfileName(): string | null {
  const currentFile = getCurrentProfileFile();
  if (!existsSync(currentFile)) return null;
  try {
    const name = readFileSync(currentFile, 'utf-8').trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** Get a profile by name. Returns null if not found. */
export function getProfile(name: string): Profile | null {
  const profiles = listProfiles();
  return profiles.find((p) => p.name === name) ?? null;
}

/** Create a new profile. Returns the created profile or an error. */
export function createProfile(
  name: string,
  opts: { copyFrom?: string } = {},
): { ok: boolean; profile?: Profile; error?: string } {
  const validation = validateProfileName(name);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const profilesDir = getProfilesDir();
  mkdirSync(profilesDir, { recursive: true });

  const profilePath = join(profilesDir, name);
  if (existsSync(profilePath)) {
    return { ok: false, error: `Profile '${name}' already exists` };
  }

  // Create the profile directory with standard subdirectories.
  mkdirSync(profilePath, { recursive: true });
  mkdirSync(join(profilePath, 'sessions'), { recursive: true });
  mkdirSync(join(profilePath, 'trajectories'), { recursive: true });
  mkdirSync(join(profilePath, 'skills'), { recursive: true });

  // Optionally copy config from an existing profile.
  if (opts.copyFrom) {
    const sourceProfile = getProfile(opts.copyFrom);
    if (!sourceProfile) {
      return { ok: false, error: `Source profile '${opts.copyFrom}' not found` };
    }
    const sourceConfig = join(sourceProfile.path, 'config.toml');
    if (existsSync(sourceConfig)) {
      const destConfig = join(profilePath, 'config.toml');
      writeFileSync(destConfig, readFileSync(sourceConfig, 'utf-8'), 'utf-8');
    }
  } else {
    // Create an empty config.toml.
    writeFileSync(
      join(profilePath, 'config.toml'),
      '# Goli-CLI profile configuration\n# See https://goli-cli.dev/docs/config\n',
      'utf-8',
    );
  }

  return {
    ok: true,
    profile: {
      name,
      path: profilePath,
      active: false,
      createdAt: new Date().toISOString(),
    },
  };
}

/** Set the active profile by writing its name to ~/.goli/current. */
export function useProfile(name: string): { ok: boolean; error?: string } {
  const profile = getProfile(name);
  if (!profile) {
    return { ok: false, error: `Profile '${name}' not found. Run 'goli profile list' to see available profiles.` };
  }

  const root = getGoliRoot();
  mkdirSync(root, { recursive: true });
  writeFileSync(getCurrentProfileFile(), name, 'utf-8');
  return { ok: true };
}

/** Delete a profile. Returns true if deleted. */
export function deleteProfile(
  name: string,
  opts: { force?: boolean } = {},
): { ok: boolean; error?: string } {
  const profile = getProfile(name);
  if (!profile) {
    return { ok: false, error: `Profile '${name}' not found` };
  }

  // Don't delete the active profile unless --force.
  if (profile.active && !opts.force) {
    return { ok: false, error: `Profile '${name}' is currently active. Use --force to delete anyway.` };
  }

  // Don't delete the legacy default profile directory.
  if (profile.path === join(getHomeDir(), '.goli-cli')) {
    return { ok: false, error: 'Cannot delete the legacy default profile directory' };
  }

  rmSync(profile.path, { recursive: true, force: true });

  // If we deleted the active profile, clear the current marker.
  if (profile.active) {
    const currentFile = getCurrentProfileFile();
    if (existsSync(currentFile)) {
      rmSync(currentFile, { force: true });
    }
  }

  return { ok: true };
}

/** Run the `goli profile` command. */
export async function runProfile(args: string[]): Promise<number> {
  const subcommand = args[0] ?? 'list';

  switch (subcommand) {
    case 'list': {
      const profiles = listProfiles();
      process.stdout.write('Profiles:\n');
      for (const p of profiles) {
        const marker = p.active ? ' *' : '  ';
        const created = p.createdAt ? ` (created ${p.createdAt.slice(0, 10)})` : '';
        process.stdout.write(`${marker} ${p.name.padEnd(20)} ${p.path}${created}\n`);
      }
      process.stdout.write('\n* = active\n');
      return 0;
    }
    case 'create': {
      const name = args[1];
      if (!name) {
        process.stderr.write('Usage: goli profile create <name> [--copy-from <source>]\n');
        return 1;
      }
      const copyFromIdx = args.indexOf('--copy-from');
      const copyFrom = copyFromIdx >= 0 ? args[copyFromIdx + 1] : undefined;
      const result = createProfile(name, { copyFrom });
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        return 1;
      }
      process.stdout.write(`Created profile '${name}' at ${result.profile!.path}\n`);
      return 0;
    }
    case 'use': {
      const name = args[1];
      if (!name) {
        process.stderr.write('Usage: goli profile use <name>\n');
        return 1;
      }
      const result = useProfile(name);
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        return 1;
      }
      process.stdout.write(`Switched to profile '${name}'. New Goli-CLI invocations will use this profile.\n`);
      process.stdout.write(`To use it immediately: GOLI_HOME=$(goli profile path ${name}) goli ...\n`);
      return 0;
    }
    case 'delete': {
      const name = args[1];
      if (!name) {
        process.stderr.write('Usage: goli profile delete <name> [--force]\n');
        return 1;
      }
      const force = args.includes('--force');
      const result = deleteProfile(name, { force });
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        return 1;
      }
      process.stdout.write(`Deleted profile '${name}'\n`);
      return 0;
    }
    case 'path': {
      const name = args[1];
      if (!name) {
        process.stderr.write('Usage: goli profile path <name>\n');
        return 1;
      }
      const profile = getProfile(name);
      if (!profile) {
        process.stderr.write(`Profile '${name}' not found\n`);
        return 1;
      }
      process.stdout.write(`${profile.path}\n`);
      return 0;
    }
    default:
      process.stderr.write(`Unknown profile subcommand: ${subcommand}\n`);
      process.stderr.write('Available: list, create, use, delete, path\n');
      return 1;
  }
}
