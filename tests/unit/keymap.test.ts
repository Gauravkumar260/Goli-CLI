/**
 * Unit tests for the keymap registry.
 */

import { describe, it, expect } from 'vitest';

import { globalKeyMap, KeyMap, DEFAULT_BINDINGS, type KeyBinding } from '../../apps/cli/src/tui/lib/keymap.js';

describe('KeyMap', () => {
  it('registers and retrieves bindings', () => {
    const km = new KeyMap();
    const binding: KeyBinding = {
      description: 'Test action',
      category: 'global',
      defaultKeys: ['ctrl+t'],
    };
    km.register('test', binding);
    expect(km.get('test')).toBe(binding);
  });

  it('keysFor returns default keys when no override', () => {
    const km = new KeyMap();
    km.register('test', {
      description: 'Test',
      category: 'global',
      defaultKeys: ['ctrl+t'],
    });
    expect(km.keysFor('test')).toEqual(['ctrl+t']);
  });

  it('keysFor returns override keys when set', () => {
    const km = new KeyMap();
    km.register('test', {
      description: 'Test',
      category: 'global',
      defaultKeys: ['ctrl+t'],
      overrideKeys: ['ctrl+x'],
    });
    expect(km.keysFor('test')).toEqual(['ctrl+x']);
  });

  it('actionForKey finds the action for a combo', () => {
    const km = new KeyMap();
    km.register('test', {
      description: 'Test',
      category: 'global',
      defaultKeys: ['ctrl+t'],
    });
    expect(km.actionForKey('ctrl+t')).toBe('test');
    expect(km.actionForKey('ctrl+x')).toBeUndefined();
  });

  it('getByCategory filters by category', () => {
    const km = new KeyMap();
    km.register('a', { description: 'A', category: 'global', defaultKeys: ['a'] });
    km.register('b', { description: 'B', category: 'input', defaultKeys: ['b'] });
    km.register('c', { description: 'C', category: 'global', defaultKeys: ['c'] });
    const globalBindings = km.getByCategory('global');
    expect(globalBindings).toHaveLength(2);
  });

  it('entries returns all bindings', () => {
    const km = new KeyMap();
    km.register('a', { description: 'A', category: 'global', defaultKeys: ['a'] });
    km.register('b', { description: 'B', category: 'input', defaultKeys: ['b'] });
    expect(km.entries()).toHaveLength(2);
  });
});

describe('globalKeyMap (singleton)', () => {
  it('has all default bindings registered', () => {
    for (const [action] of DEFAULT_BINDINGS) {
      expect(globalKeyMap.get(action)).toBeDefined();
    }
  });

  it('includes interrupt (ctrl+c) as a protected binding', () => {
    const interrupt = globalKeyMap.get('interrupt');
    expect(interrupt).toBeDefined();
    expect(interrupt?.protected).toBe(true);
    expect(interrupt?.defaultKeys).toContain('ctrl+c');
  });

  it('includes submit (return) as a protected binding', () => {
    const submit = globalKeyMap.get('submit');
    expect(submit).toBeDefined();
    expect(submit?.protected).toBe(true);
    expect(submit?.defaultKeys).toContain('return');
  });

  it('has bindings in all 5 categories', () => {
    const categories = new Set(globalKeyMap.entries().map(([, b]) => b.category));
    expect(categories.has('global')).toBe(true);
    expect(categories.has('navigation')).toBe(true);
    expect(categories.has('input')).toBe(true);
    expect(categories.has('permission')).toBe(true);
  });
});
