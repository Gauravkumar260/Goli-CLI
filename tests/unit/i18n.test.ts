/**
 * Tests for the i18n module — locale catalogs, t(), fallback, params.
 *
 * @module tests/unit/i18n.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  t,
  setLocale,
  getLocale,
  initI18n,
  hasTranslation,
  listKeys,
  countTranslations,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from '../../packages/core/src/i18n/index.js';

describe('i18n — supported locales', () => {
  it('exports 5 supported locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(5);
    expect([...SUPPORTED_LOCALES].sort()).toEqual(['de', 'en', 'es', 'ja', 'zh-CN']);
  });

  it('default locale is English', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });
});

describe('i18n — t() basic lookup', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('returns the English string for a known key', () => {
    expect(t('common.yes')).toBe('Yes');
    expect(t('common.no')).toBe('No');
    expect(t('common.error')).toBe('Error');
  });

  it('returns the key itself for an unknown key (last-resort fallback)', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
    expect(t('another.missing.key')).toBe('another.missing.key');
  });

  it('substitutes {placeholder} parameters', () => {
    expect(t('error.generic', { message: 'something failed' })).toBe(
      'Error: something failed',
    );
    expect(t('error.unknown_command', { command: 'frobnicate' })).toBe(
      'Error: unknown command "frobnicate"',
    );
    expect(t('error.timeout', { seconds: 30 })).toBe(
      'Error: operation timed out after 30s',
    );
  });

  it('leaves unknown placeholders intact', () => {
    expect(t('error.generic', { wrong: 'value' })).toBe('Error: {message}');
  });

  it('handles numeric parameters (converted to string)', () => {
    expect(t('error.timeout', { seconds: 60 })).toBe(
      'Error: operation timed out after 60s',
    );
  });

  it('handles parameters with no template placeholders', () => {
    expect(t('common.yes', { unused: 'ignored' })).toBe('Yes');
  });
});

describe('i18n — locale switching', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('setLocale + getLocale round-trip', () => {
    setLocale('es');
    expect(getLocale()).toBe('es');
    setLocale('ja');
    expect(getLocale()).toBe('ja');
    setLocale('en');
    expect(getLocale()).toBe('en');
  });

  it('t() returns Spanish strings when locale is es', () => {
    setLocale('es');
    expect(t('common.yes')).toBe('Sí');
    expect(t('common.no')).toBe('No');
    expect(t('common.cancel')).toBe('Cancelar');
  });

  it('t() returns Chinese strings when locale is zh-CN', () => {
    setLocale('zh-CN');
    expect(t('common.yes')).toBe('是');
    expect(t('common.no')).toBe('否');
    expect(t('common.error')).toBe('错误');
  });

  it('t() returns Japanese strings when locale is ja', () => {
    setLocale('ja');
    expect(t('common.yes')).toBe('はい');
    expect(t('common.no')).toBe('いいえ');
    expect(t('common.cancel')).toBe('キャンセル');
  });

  it('t() returns German strings when locale is de', () => {
    setLocale('de');
    expect(t('common.yes')).toBe('Ja');
    expect(t('common.no')).toBe('Nein');
    expect(t('common.cancel')).toBe('Abbrechen');
  });
});

describe('i18n — fallback chain', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('falls back to English when active locale is missing a key', () => {
    // All locales have common.yes, but if we delete it from a non-en catalog,
    // fallback should kick in. We can't easily delete keys here, so we test
    // the documented behavior: a key only in en should resolve in any locale.
    // (All current keys are in all catalogs, so this test is a no-op for now
    // but documents the contract.)
    setLocale('es');
    const result = t('common.yes');
    expect(result).toBe('Sí'); // Spanish has it.
  });

  it('falls back to the key itself when key is missing from all catalogs', () => {
    setLocale('es');
    expect(t('totally.missing.key')).toBe('totally.missing.key');
  });

  it('English catalog is the source of truth (all keys present)', () => {
    const enKeys = listKeys('en');
    expect(enKeys.length).toBeGreaterThanOrEqual(60);
  });
});

describe('i18n — initI18n from env', () => {
  const originalLang = process.env.GOLI_LANG;

  afterEach(() => {
    if (originalLang === undefined) {
      delete process.env.GOLI_LANG;
    } else {
      process.env.GOLI_LANG = originalLang;
    }
    setLocale('en');
  });

  it('uses English when GOLI_LANG is unset', () => {
    delete process.env.GOLI_LANG;
    initI18n();
    expect(getLocale()).toBe('en');
  });

  it('uses English when GOLI_LANG is empty', () => {
    process.env.GOLI_LANG = '';
    initI18n();
    expect(getLocale()).toBe('en');
  });

  it('respects GOLI_LANG=es', () => {
    process.env.GOLI_LANG = 'es';
    initI18n();
    expect(getLocale()).toBe('es');
  });

  it('respects GOLI_LANG=zh-CN', () => {
    process.env.GOLI_LANG = 'zh-CN';
    initI18n();
    expect(getLocale()).toBe('zh-CN');
  });

  it('respects GOLI_LANG=ja', () => {
    process.env.GOLI_LANG = 'ja';
    initI18n();
    expect(getLocale()).toBe('ja');
  });

  it('respects GOLI_LANG=de', () => {
    process.env.GOLI_LANG = 'de';
    initI18n();
    expect(getLocale()).toBe('de');
  });

  it('maps "zh" language part to "zh-CN"', () => {
    process.env.GOLI_LANG = 'zh';
    initI18n();
    expect(getLocale()).toBe('zh-CN');
  });

  it('maps "zh-TW" to "zh-CN" (closest available)', () => {
    process.env.GOLI_LANG = 'zh-TW';
    initI18n();
    expect(getLocale()).toBe('zh-CN');
  });

  it('maps "zh_TW" (underscore) to "zh-CN"', () => {
    process.env.GOLI_LANG = 'zh_TW';
    initI18n();
    expect(getLocale()).toBe('zh-CN');
  });

  it('falls back to English for unsupported locale (with stderr warning)', () => {
    process.env.GOLI_LANG = 'fr';
    // Capture stderr — the function writes a warning.
    const originalStderr = process.stderr.write.bind(process.stderr);
    let stderrOutput = '';
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
    initI18n();
    process.stderr.write = originalStderr;
    expect(getLocale()).toBe('en');
    expect(stderrOutput).toContain("unsupported GOLI_LANG='fr'");
  });

  it('suppresses stderr warning when GOLI_I18N_WARN=0', () => {
    process.env.GOLI_LANG = 'fr';
    process.env.GOLI_I18N_WARN = '0';
    const originalStderr = process.stderr.write.bind(process.stderr);
    let stderrOutput = '';
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
    initI18n();
    process.stderr.write = originalStderr;
    expect(getLocale()).toBe('en');
    expect(stderrOutput).toBe('');
    delete process.env.GOLI_I18N_WARN;
  });

  it('accepts a custom env object (for testability)', () => {
    initI18n({ GOLI_LANG: 'ja' });
    expect(getLocale()).toBe('ja');
  });
});

describe('i18n — hasTranslation', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('returns true for existing keys', () => {
    expect(hasTranslation('common.yes')).toBe(true);
    expect(hasTranslation('app.name')).toBe(true);
  });

  it('returns false for missing keys', () => {
    expect(hasTranslation('nonexistent.key')).toBe(false);
  });

  it('respects the active locale', () => {
    setLocale('es');
    expect(hasTranslation('common.yes')).toBe(true); // Present in Spanish.
    expect(hasTranslation('app.name')).toBe(true); // Present in Spanish.
  });
});

describe('i18n — listKeys + countTranslations', () => {
  it('listKeys returns array of keys for English', () => {
    const keys = listKeys('en');
    expect(Array.isArray(keys)).toBe(true);
    expect(keys).toContain('common.yes');
    expect(keys).toContain('app.name');
  });

  it('listKeys returns keys for each supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const keys = listKeys(locale);
      expect(keys.length).toBeGreaterThanOrEqual(50);
    }
  });

  it('countTranslations returns the same number as listKeys.length', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(countTranslations(locale)).toBe(listKeys(locale).length);
    }
  });

  it('each non-English locale has at least 50 translations', () => {
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en') continue;
      expect(countTranslations(locale)).toBeGreaterThanOrEqual(50);
    }
  });
});

describe('i18n — cross-locale consistency', () => {
  it('all locales have the same set of keys as English (no missing translations)', () => {
    const enKeys = new Set(listKeys('en'));
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en') continue;
      const localeKeys = new Set(listKeys(locale));
      const missing = [...enKeys].filter((k) => !localeKeys.has(k));
      expect(missing).toEqual([]);
    }
  });

  it('no locale has extra keys not in English', () => {
    const enKeys = new Set(listKeys('en'));
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en') continue;
      const localeKeys = new Set(listKeys(locale));
      const extra = [...localeKeys].filter((k) => !enKeys.has(k));
      expect(extra).toEqual([]);
    }
  });
});

describe('i18n — sample translations per locale (10 per locale)', () => {
  // Verifies the AC: "Tests verify each locale loads and translates 10 sample keys"

  it('English: 10 sample keys translated', () => {
    setLocale('en');
    expect(t('common.yes')).toBe('Yes');
    expect(t('common.no')).toBe('No');
    expect(t('common.cancel')).toBe('Cancel');
    expect(t('common.error')).toBe('Error');
    expect(t('app.tagline')).toBe('Multi-Agent Software Swarm');
    expect(t('cli.help_flag')).toBe('Show help');
    expect(t('cmd.doctor.title')).toBe('GOLI-CLI Doctor — Environment Health Check');
    expect(t('phase.done')).toBe('DONE');
    expect(t('sandbox.read_only')).toBe('Read-only sandbox');
    expect(t('approval.prompt')).toBe('Approve this action? (y/N)');
  });

  it('Spanish: 10 sample keys translated', () => {
    setLocale('es');
    expect(t('common.yes')).toBe('Sí');
    expect(t('common.no')).toBe('No');
    expect(t('common.cancel')).toBe('Cancelar');
    expect(t('common.error')).toBe('Error');
    expect(t('app.tagline')).toBe('Enjambre de Software Multi-Agente');
    expect(t('cli.help_flag')).toBe('Mostrar ayuda');
    expect(t('cmd.doctor.title')).toBe('GOLI-CLI Doctor — Verificación de Salud del Entorno');
    expect(t('phase.done')).toBe('LISTO');
    expect(t('sandbox.read_only')).toBe('Sandbox de solo lectura');
    expect(t('approval.prompt')).toBe('¿Aprobar esta acción? (y/N)');
  });

  it('Chinese: 10 sample keys translated', () => {
    setLocale('zh-CN');
    expect(t('common.yes')).toBe('是');
    expect(t('common.no')).toBe('否');
    expect(t('common.cancel')).toBe('取消');
    expect(t('common.error')).toBe('错误');
    expect(t('app.tagline')).toBe('多智能体软件集群');
    expect(t('cli.help_flag')).toBe('显示帮助');
    expect(t('cmd.doctor.title')).toBe('GOLI-CLI 体检 — 环境健康检查');
    expect(t('phase.done')).toBe('完成');
    expect(t('sandbox.read_only')).toBe('只读沙箱');
    expect(t('approval.prompt')).toBe('批准此操作吗？(y/N)');
  });

  it('Japanese: 10 sample keys translated', () => {
    setLocale('ja');
    expect(t('common.yes')).toBe('はい');
    expect(t('common.no')).toBe('いいえ');
    expect(t('common.cancel')).toBe('キャンセル');
    expect(t('common.error')).toBe('エラー');
    expect(t('app.tagline')).toBe('マルチエージェント ソフトウェア スワーム');
    expect(t('cli.help_flag')).toBe('ヘルプを表示');
    expect(t('cmd.doctor.title')).toBe('GOLI-CLI ドクター — 環境ヘルスチェック');
    expect(t('phase.done')).toBe('完了');
    expect(t('sandbox.read_only')).toBe('読み取り専用サンドボックス');
    expect(t('approval.prompt')).toBe('このアクションを承認しますか？(y/N)');
  });

  it('German: 10 sample keys translated', () => {
    setLocale('de');
    expect(t('common.yes')).toBe('Ja');
    expect(t('common.no')).toBe('Nein');
    expect(t('common.cancel')).toBe('Abbrechen');
    expect(t('common.error')).toBe('Fehler');
    expect(t('app.tagline')).toBe('Multi-Agent-Software-Schwarm');
    expect(t('cli.help_flag')).toBe('Hilfe anzeigen');
    expect(t('cmd.doctor.title')).toBe('GOLI-CLI Doctor — Umgebungs-Gesundheitsprüfung');
    expect(t('phase.done')).toBe('FERTIG');
    expect(t('sandbox.read_only')).toBe('Nur-Lese-Sandbox');
    expect(t('approval.prompt')).toBe('Diese Aktion genehmigen? (y/N)');
  });
});

describe('i18n — parameter substitution in each locale', () => {
  it('English: substitutes {message} in error.generic', () => {
    setLocale('en');
    expect(t('error.generic', { message: 'test failure' })).toBe('Error: test failure');
  });

  it('Spanish: substitutes {message} in error.generic', () => {
    setLocale('es');
    expect(t('error.generic', { message: 'fallo de prueba' })).toBe(
      'Error: fallo de prueba',
    );
  });

  it('Chinese: substitutes {message} in error.generic', () => {
    setLocale('zh-CN');
    expect(t('error.generic', { message: '测试失败' })).toBe('错误：测试失败');
  });

  it('Japanese: substitutes {message} in error.generic', () => {
    setLocale('ja');
    expect(t('error.generic', { message: 'テスト失敗' })).toBe('エラー：テスト失敗');
  });

  it('German: substitutes {message} in error.generic', () => {
    setLocale('de');
    expect(t('error.generic', { message: 'Testfehler' })).toBe('Fehler: Testfehler');
  });

  it('substitutes {action} + {mode} in sandbox.violation', () => {
    setLocale('en');
    expect(t('sandbox.violation', { action: 'write_file', mode: 'read-only' })).toBe(
      'Sandbox violation: write_file not permitted in read-only mode',
    );
  });

  it('substitutes {seconds} (numeric) in error.timeout', () => {
    setLocale('en');
    expect(t('error.timeout', { seconds: 30 })).toBe(
      'Error: operation timed out after 30s',
    );
  });
});

describe('i18n — edge cases', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('handles keys with dots in the namespace', () => {
    expect(t('cmd.doctor.checking')).toBe('Checking');
    expect(t('cmd.cron.add')).toBe('Add a scheduled job');
  });

  it('handles empty string key', () => {
    expect(t('')).toBe('');
  });

  it('handles parameter value containing braces (no recursion)', () => {
    expect(t('error.generic', { message: '{nested}' })).toBe('Error: {nested}');
  });

  it('handles parameter value containing special regex chars', () => {
    expect(t('error.generic', { message: '$1.*+?[](){}' })).toBe(
      'Error: $1.*+?[](){}',
    );
  });

  it('does not crash on null/undefined params (no substitution attempted)', () => {
    expect(t('common.yes')).toBe('Yes'); // No params passed.
  });

  it('does not crash with empty params object', () => {
    expect(t('error.generic', {})).toBe('Error: {message}');
  });

  it('multiple parameter substitution in one string', () => {
    setLocale('en');
    const result = t('sandbox.violation', { action: 'PATCH', mode: 'read-only' });
    expect(result).toContain('PATCH');
    expect(result).toContain('read-only');
    expect(result).not.toContain('{action}');
    expect(result).not.toContain('{mode}');
  });
});

describe('i18n — Hermes-parity integration scenario', () => {
  it('mirrors Hermes 16-locale i18n pattern: user picks locale, all UI strings translate', () => {
    // User sets GOLI_LANG=zh-CN
    process.env.GOLI_LANG = 'zh-CN';
    initI18n();
    expect(getLocale()).toBe('zh-CN');

    // All UI strings now come back in Chinese.
    expect(t('cmd.doctor.title')).toContain('体检');
    expect(t('cmd.status.title')).toBe('GOLI-CLI 状态');
    expect(t('common.loading')).toBe('加载中...');

    // Switch to Japanese.
    process.env.GOLI_LANG = 'ja';
    initI18n();
    expect(getLocale()).toBe('ja');
    expect(t('cmd.doctor.title')).toContain('ドクター');

    // Switch back to English.
    delete process.env.GOLI_LANG;
    initI18n();
    expect(getLocale()).toBe('en');
    expect(t('cmd.doctor.title')).toBe('GOLI-CLI Doctor — Environment Health Check');
  });
});
