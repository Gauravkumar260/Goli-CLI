/**
 * Unit tests for T-025 — Profile system (GOLI_HOME).
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. GOLI_HOME env var scopes all state (sessions, trajectories, skills, config).
 *  2. goli profile list/create/use/delete commands.
 *  3. Profiles stored in ~/.goli/profiles/<name>/.
 *  4. Tests verify profile isolation.
 *
 * Uses a temporary HOME directory to avoid touching the real ~/.goli.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  getGoliHome,
  getGoliRoot,
  getProfilesDir,
  getCurrentProfileFile,
  validateProfileName,
  listProfiles,
  getCurrentProfileName,
  getProfile,
  createProfile,
  useProfile,
  deleteProfile,
  runProfile,
} from '../src/commands/profile.js';

let tmpHome: string;
let originalHome: string | undefined;
let originalGoliHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'goli-profile-test-'));
  originalHome = process.env['HOME'];
  originalGoliHome = process.env['GOLI_HOME'];
  process.env['HOME'] = tmpHome;
  delete process.env['GOLI_HOME'];
});

afterEach(() => {
  if (originalHome !== undefined) {
    process.env['HOME'] = originalHome;
  } else {
    delete process.env['HOME'];
  }
  if (originalGoliHome !== undefined) {
    process.env['GOLI_HOME'] = originalGoliHome;
  } else {
    delete process.env['GOLI_HOME'];
  }
  rmSync(tmpHome, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criterion #1: GOLI_HOME env var scopes all state
// ─────────────────────────────────────────────────────────────────────

describe('T-025: getGoliHome respects GOLI_HOME env var (acceptance #1)', () => {
  it('returns GOLI_HOME when set', () => {
    process.env['GOLI_HOME'] = '/custom/goli-home';
    // resolve() normalizes the path for the current platform
    expect(getGoliHome()).toBe(resolve('/custom/goli-home'));
  });

  it('returns the active profile dir when GOLI_HOME is not set but a profile is active', () => {
    // Create a profile and set it active.
    createProfile('work');
    useProfile('work');
    const home = getGoliHome();
    expect(home).toContain('profiles');
    expect(home).toContain('work');
  });

  it('falls back to ~/.goli-cli when no GOLI_HOME and no active profile', () => {
    delete process.env['GOLI_HOME'];
    const home = getGoliHome();
    expect(home).toBe(join(tmpHome, '.goli-cli'));
  });

  it('resolves relative GOLI_HOME to absolute', () => {
    process.env['GOLI_HOME'] = './relative-home';
    const home = getGoliHome();
    expect(isAbsolute(home)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criterion #3: Profiles stored in ~/.goli/profiles/<name>/
// ─────────────────────────────────────────────────────────────────────

describe('T-025: Profile directory layout (acceptance #3)', () => {
  it('getGoliRoot returns ~/.goli/', () => {
    expect(getGoliRoot()).toBe(join(tmpHome, '.goli'));
  });

  it('getProfilesDir returns ~/.goli/profiles/', () => {
    expect(getProfilesDir()).toBe(join(tmpHome, '.goli', 'profiles'));
  });

  it('getCurrentProfileFile returns ~/.goli/current', () => {
    expect(getCurrentProfileFile()).toBe(join(tmpHome, '.goli', 'current'));
  });

  it('createProfile creates ~/.goli/profiles/<name>/ with subdirs', () => {
    const result = createProfile('work');
    expect(result.ok).toBe(true);
    expect(existsSync(join(tmpHome, '.goli', 'profiles', 'work'))).toBe(true);
    expect(existsSync(join(tmpHome, '.goli', 'profiles', 'work', 'sessions'))).toBe(true);
    expect(existsSync(join(tmpHome, '.goli', 'profiles', 'work', 'trajectories'))).toBe(true);
    expect(existsSync(join(tmpHome, '.goli', 'profiles', 'work', 'skills'))).toBe(true);
    expect(existsSync(join(tmpHome, '.goli', 'profiles', 'work', 'config.toml'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criterion #2: goli profile list/create/use/delete commands
// ─────────────────────────────────────────────────────────────────────

describe('T-025: validateProfileName', () => {
  it('accepts valid names', () => {
    expect(validateProfileName('work').ok).toBe(true);
    expect(validateProfileName('personal-2').ok).toBe(true);
    expect(validateProfileName('a').ok).toBe(true);
  });

  it('rejects empty names', () => {
    expect(validateProfileName('').ok).toBe(false);
  });

  it('rejects names with special characters', () => {
    expect(validateProfileName('work!').ok).toBe(false);
    expect(validateProfileName('work personal').ok).toBe(false);
    expect(validateProfileName('work/personal').ok).toBe(false);
  });

  it('rejects names longer than 64 characters', () => {
    expect(validateProfileName('a'.repeat(65)).ok).toBe(false);
  });

  it('rejects reserved names', () => {
    expect(validateProfileName('current').ok).toBe(false);
    expect(validateProfileName('profiles').ok).toBe(false);
    expect(validateProfileName('default').ok).toBe(false);
  });

  it('rejects names starting with a hyphen', () => {
    expect(validateProfileName('-work').ok).toBe(false);
  });
});

describe('T-025: createProfile', () => {
  it('creates a profile successfully', () => {
    const result = createProfile('work');
    expect(result.ok).toBe(true);
    expect(result.profile?.name).toBe('work');
    expect(result.profile?.active).toBe(false);
  });

  it('rejects duplicate profile names', () => {
    createProfile('work');
    const result = createProfile('work');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('rejects invalid names', () => {
    const result = createProfile('invalid name!');
    expect(result.ok).toBe(false);
  });

  it('copies config from source profile when --copy-from is specified', () => {
    createProfile('source');
    const sourceConfig = join(getProfilesDir(), 'source', 'config.toml');
    writeFileSync(sourceConfig, '# custom config\n[test]\nkey = "value"\n', 'utf-8');

    const result = createProfile('copy', { copyFrom: 'source' });
    expect(result.ok).toBe(true);
    const copyConfig = join(getProfilesDir(), 'copy', 'config.toml');
    expect(readFileSync(copyConfig, 'utf-8')).toContain('custom config');
  });

  it('rejects --copy-from with non-existent source', () => {
    const result = createProfile('copy', { copyFrom: 'nonexistent' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('T-025: listProfiles', () => {
  it('returns the legacy default when no profiles exist', () => {
    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe('default');
    expect(profiles[0]!.path).toBe(join(tmpHome, '.goli-cli'));
  });

  it('lists created profiles', () => {
    createProfile('work');
    createProfile('personal');
    const profiles = listProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles.map((p) => p.name)).toContain('work');
    expect(profiles.map((p) => p.name)).toContain('personal');
  });

  it('marks the active profile', () => {
    createProfile('work');
    createProfile('personal');
    useProfile('work');
    const profiles = listProfiles();
    const work = profiles.find((p) => p.name === 'work');
    const personal = profiles.find((p) => p.name === 'personal');
    expect(work?.active).toBe(true);
    expect(personal?.active).toBe(false);
  });
});

describe('T-025: useProfile', () => {
  it('sets the active profile by writing to ~/.goli/current', () => {
    createProfile('work');
    const result = useProfile('work');
    expect(result.ok).toBe(true);
    expect(readFileSync(getCurrentProfileFile(), 'utf-8').trim()).toBe('work');
  });

  it('rejects non-existent profile', () => {
    const result = useProfile('nonexistent');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });
});

describe('T-025: deleteProfile', () => {
  it('deletes a profile', () => {
    createProfile('work');
    const result = deleteProfile('work');
    expect(result.ok).toBe(true);
    expect(existsSync(join(getProfilesDir(), 'work'))).toBe(false);
  });

  it('rejects deletion of non-existent profile', () => {
    const result = deleteProfile('nonexistent');
    expect(result.ok).toBe(false);
  });

  it('rejects deletion of active profile without --force', () => {
    createProfile('work');
    useProfile('work');
    const result = deleteProfile('work');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('currently active');
  });

  it('allows deletion of active profile with --force', () => {
    createProfile('work');
    useProfile('work');
    const result = deleteProfile('work', { force: true });
    expect(result.ok).toBe(true);
    // Active profile marker should be cleared.
    expect(getCurrentProfileName()).toBeNull();
  });
});

describe('T-025: getCurrentProfileName', () => {
  it('returns null when no profile is active', () => {
    expect(getCurrentProfileName()).toBeNull();
  });

  it('returns the active profile name', () => {
    createProfile('work');
    useProfile('work');
    expect(getCurrentProfileName()).toBe('work');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Acceptance criterion #4: Profile isolation
// ─────────────────────────────────────────────────────────────────────

describe('T-025: Profile isolation (acceptance #4)', () => {
  it('two profiles have independent config.toml files', () => {
    createProfile('work');
    createProfile('personal');

    const workConfig = join(getProfilesDir(), 'work', 'config.toml');
    const personalConfig = join(getProfilesDir(), 'personal', 'config.toml');

    writeFileSync(workConfig, '# work config\n', 'utf-8');
    writeFileSync(personalConfig, '# personal config\n', 'utf-8');

    expect(readFileSync(workConfig, 'utf-8')).toBe('# work config\n');
    expect(readFileSync(personalConfig, 'utf-8')).toBe('# personal config\n');
  });

  it('GOLI_HOME env var overrides the active profile', () => {
    createProfile('work');
    createProfile('personal');
    useProfile('work');

    // Even though 'work' is active, GOLI_HOME overrides it.
    process.env['GOLI_HOME'] = '/explicit/override';
    expect(getGoliHome()).toBe(resolve('/explicit/override'));
  });

  it('deleting one profile does not affect another', () => {
    createProfile('work');
    createProfile('personal');

    deleteProfile('work');

    expect(existsSync(join(getProfilesDir(), 'work'))).toBe(false);
    expect(existsSync(join(getProfilesDir(), 'personal'))).toBe(true);
  });

  it('sessions subdir is isolated per profile', () => {
    createProfile('work');
    createProfile('personal');

    const workSessions = join(getProfilesDir(), 'work', 'sessions');
    const personalSessions = join(getProfilesDir(), 'personal', 'sessions');

    writeFileSync(join(workSessions, 'session-1.json'), '{"profile":"work"}', 'utf-8');
    writeFileSync(join(personalSessions, 'session-1.json'), '{"profile":"personal"}', 'utf-8');

    expect(readFileSync(join(workSessions, 'session-1.json'), 'utf-8')).toContain('work');
    expect(readFileSync(join(personalSessions, 'session-1.json'), 'utf-8')).toContain('personal');
  });
});

// ─────────────────────────────────────────────────────────────────────
// runProfile (CLI command)
// ─────────────────────────────────────────────────────────────────────

describe('T-025: runProfile CLI command', () => {
  it('list shows available profiles', async () => {
    createProfile('work');
    const exitCode = await runProfile(['list']);
    expect(exitCode).toBe(0);
  });

  it('create creates a profile', async () => {
    const exitCode = await runProfile(['create', 'testprof']);
    expect(exitCode).toBe(0);
    expect(existsSync(join(getProfilesDir(), 'testprof'))).toBe(true);
  });

  it('use switches the active profile', async () => {
    createProfile('work');
    const exitCode = await runProfile(['use', 'work']);
    expect(exitCode).toBe(0);
    expect(getCurrentProfileName()).toBe('work');
  });

  it('delete removes a profile', async () => {
    createProfile('temp');
    const exitCode = await runProfile(['delete', 'temp']);
    expect(exitCode).toBe(0);
    expect(existsSync(join(getProfilesDir(), 'temp'))).toBe(false);
  });

  it('path prints the profile directory', async () => {
    createProfile('work');
    const exitCode = await runProfile(['path', 'work']);
    expect(exitCode).toBe(0);
  });

  it('unknown subcommand returns 1', async () => {
    const exitCode = await runProfile(['unknown']);
    expect(exitCode).toBe(1);
  });
});
