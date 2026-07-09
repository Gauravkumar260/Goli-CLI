/**
 * i18n — Internationalization catalog system for Goli-CLI.
 *
 * Closes the accessibility gap vs hermes-agent (which ships 16-locale
 * catalogs in its wheel via data-files). Goli's T-022 starts with 5
 * locales: English (en), Spanish (es), Simplified Chinese (zh-CN),
 * Japanese (ja), German (de).
 *
 * ## Design
 *
 * - Catalogs are TypeScript modules exporting a `Record<string, string>`.
 *   This avoids runtime YAML/JSON parsing and lets TypeScript check
 *   parameter substitution at compile time (when the catalog is typed).
 * - The active locale is selected by `GOLI_LANG` env var (default: `en`).
 * - `t(key, params?)` looks up the key in the active locale, falling back
 *   to English, then to the key itself (so missing translations never
 *   crash — they just show the key).
 * - Parameter substitution uses `{name}` placeholders: `t('greeting', { name: 'world' })`
 *   returns "Hello, world" for `en`.
 *
 * ## Adding a new locale
 *
 * 1. Create `catalogs/<locale>.ts` with at least the same keys as `en.ts`.
 * 2. Register it in `SUPPORTED_LOCALES` below.
 * 3. Add a test case in `tests/unit/i18n.test.ts`.
 *
 * ## Why not JSON files?
 *
 * JSON requires a file loader (fs.readFileSync + JSON.parse) at runtime.
 * TS modules are bundled by tsup into the CLI binary, so no runtime file
 * IO is needed. This also means `t()` is synchronous and fast (<1µs per
 * lookup after first load).
 *
 * @module i18n
 */

import { de } from './catalogs/de.js';
import { en } from './catalogs/en.js';
import { es } from './catalogs/es.js';
import { ja } from './catalogs/ja.js';
import { zhCN } from './catalogs/zh-CN.js';

/** A translation catalog: key -> translated string. */
export type Catalog = Record<string, string>;

/** Supported locale codes. */
export const SUPPORTED_LOCALES = ['en', 'es', 'zh-CN', 'ja', 'de'] as const;

/** The default locale used when GOLI_LANG is unset or invalid. */
export const DEFAULT_LOCALE = 'en' as const;

/** Type for a supported locale code. */
export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

/** All loaded catalogs, keyed by locale code. */
const CATALOGS: Record<LocaleCode, Catalog> = {
  en,
  es,
  'zh-CN': zhCN,
  ja,
  de,
};

/** The currently active locale. */
let activeLocale: LocaleCode = DEFAULT_LOCALE;

/**
 * Initialize the i18n system from the `GOLI_LANG` env var.
 * Call this once at process start (e.g., in the CLI entry point).
 *
 * If `GOLI_LANG` is unset, uses `DEFAULT_LOCALE`.
 * If `GOLI_LANG` is set to an unsupported value, falls back to `DEFAULT_LOCALE`
 * and emits a warning to stderr (once per process).
 */
export function initI18n(env: NodeJS.ProcessEnv = process.env): void {
  const requested = env.GOLI_LANG?.trim();
  if (!requested) {
    activeLocale = DEFAULT_LOCALE;
    return;
  }
  if (isSupportedLocale(requested)) {
    activeLocale = requested;
    return;
  }
  // Try the language part (e.g., "zh" -> "zh-CN" if exact match fails).
  const langPart = requested.split(/[-_]/)[0]?.toLowerCase();
  if (langPart === 'zh') {
    activeLocale = 'zh-CN';
    return;
  }
  // Unsupported — fall back to default and warn once.
  if (env.GOLI_I18N_WARN !== '0') {
    process.stderr.write(
      `goli: unsupported GOLI_LANG='${requested}', falling back to '${DEFAULT_LOCALE}'. Supported: ${SUPPORTED_LOCALES.join(', ')}.\n`,
    );
  }
  activeLocale = DEFAULT_LOCALE;
}

/**
 * Type guard for LocaleCode.
 */
function isSupportedLocale(value: string): value is LocaleCode {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Set the active locale explicitly (mainly for tests).
 *
 * @param locale - The locale to activate.
 */
export function setLocale(locale: LocaleCode): void {
  activeLocale = locale;
}

/**
 * Get the currently active locale.
 *
 * @returns The active locale code.
 */
export function getLocale(): LocaleCode {
  return activeLocale;
}

/**
 * Look up a translation key in the active locale.
 *
 * Lookup chain:
 * 1. Active locale's catalog.
 * 2. English catalog (fallback).
 * 3. The key itself (last resort — ensures we never crash on a missing key).
 *
 * Parameter substitution: `{name}` placeholders in the translated string
 * are replaced with values from `params`.
 *
 * @param key - The translation key (e.g., 'cli.help_flag').
 * @param params - Optional parameter values for `{placeholder}` substitution.
 * @returns The translated (and parameter-substituted) string.
 *
 * @example
 * ```ts
 * t('common.error'); // "Error"
 * t('cli.greeting', { name: 'world' }); // "Hello, world"
 * t('nonexistent.key'); // "nonexistent.key" (fallback)
 * ```
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = lookup(key);
  if (!params) {
    return template;
  }
  return substituteParams(template, params);
}

/**
 * Look up a key in active -> en -> key fallback chain (no param substitution).
 *
 * @param key - The translation key.
 * @returns The raw translated string.
 */
function lookup(key: string): string {
  const activeCatalog = CATALOGS[activeLocale];
  if (activeCatalog && key in activeCatalog) {
    return activeCatalog[key]!;
  }
  if (key in en) {
    return en[key]!;
  }
  return key;
}

/**
 * Substitute `{name}` placeholders in a template string.
 *
 * @param template - The template string with `{placeholder}` markers.
 * @param params - The parameter values.
 * @returns The substituted string.
 */
function substituteParams(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (name in params) {
      return String(params[name]);
    }
    return match; // Leave unknown placeholders intact.
  });
}

/**
 * Check if a key has a translation in the active locale (not fallback).
 *
 * @param key - The translation key.
 * @returns True if the key exists in the active locale's catalog.
 */
export function hasTranslation(key: string): boolean {
  const activeCatalog = CATALOGS[activeLocale];
  return Boolean(activeCatalog && key in activeCatalog);
}

/**
 * Get the list of keys in a catalog (defaults to active locale).
 *
 * @param locale - Optional locale (defaults to active).
 * @returns Array of translation keys.
 */
export function listKeys(locale: LocaleCode = activeLocale): string[] {
  return Object.keys(CATALOGS[locale] ?? {});
}

/**
 * Count translations in a catalog (defaults to active locale).
 *
 * @param locale - Optional locale (defaults to active).
 * @returns The number of translated keys.
 */
export function countTranslations(locale: LocaleCode = activeLocale): number {
  return Object.keys(CATALOGS[locale] ?? {}).length;
}

/** Re-export catalog types for external use. */
export type { Catalog as TranslationCatalog } from './types.js';
