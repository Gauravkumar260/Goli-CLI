/**
 * German locale catalog.
 *
 * @module i18n/catalogs/de
 */

import type { Catalog } from '../types.js';

/**
 *
 */
export const de: Catalog = {
  // ─── App-Metadaten ─────────────────────────────────────────────
  'app.name': 'goli-cli',
  'app.tagline': 'Multi-Agent-Software-Schwarm',
  'app.version_label': 'Version',
  'app.description': 'Ein produktionsreifes Multi-Agent-Software-Engineering-Werkzeug.',

  // ─── Allgemeine Wörter ─────────────────────────────────────────
  'common.yes': 'Ja',
  'common.no': 'Nein',
  'common.ok': 'OK',
  'common.cancel': 'Abbrechen',
  'common.error': 'Fehler',
  'common.warning': 'Warnung',
  'common.success': 'Erfolg',
  'common.info': 'Info',
  'common.loading': 'Laden...',
  'common.done': 'Fertig',
  'common.retry': 'Wiederholen',
  'common.skip': 'Überspringen',
  'common.abort': 'Abbrechen',
  'common.continue': 'Fortfahren',
  'common.unknown': 'Unbekannt',

  // ─── CLI-Flags + Hilfe ────────────────────────────────────────
  'cli.help_flag': 'Hilfe anzeigen',
  'cli.version_flag': 'Version anzeigen',
  'cli.interactive_flag': 'Vollständige interaktive TUI starten',
  'cli.demo_flag': 'Im Demo-Modus ausführen (kein LLM erforderlich)',
  'cli.model_flag': 'Modell-ID für diese Sitzung',
  'cli.god_flag': 'Alle Sicherheitsgateways umgehen (mit äußerster Vorsicht verwenden)',
  'cli.auto_flag': 'Tier 2 (Risikobehaftete) Aktionen automatisch genehmigen',
  'cli.sandbox_flag': 'Sandbox-Modus: read-only | workspace-write | danger-full-access',
  'cli.effort_flag': 'Denkaufwand: low | high | max',
  'cli.debug_flag': 'Debug-Protokollierung aktivieren',
  'cli.print_flag': 'Headless-Modus: ausführen und Ergebnis auf stdout ausgeben',
  'cli.output_format_flag': 'Ausgabeformat: text | json | stream-json',
  'cli.prompt_flag': 'Prompt-Text (oder "-" für stdin)',

  // ─── Befehl: doctor ────────────────────────────────────────────
  'cmd.doctor.title': 'GOLI-CLI Doctor — Umgebungs-Gesundheitsprüfung',
  'cmd.doctor.checking': 'Prüfe',
  'cmd.doctor.node_version': 'Node.js-Version',
  'cmd.doctor.ripgrep': 'ripgrep (rg) installiert',
  'cmd.doctor.git': 'git installiert',
  'cmd.doctor.glm_endpoint': 'GLM-5.2-Endpunkt erreichbar',
  'cmd.doctor.goli_md': 'GOLI.md Projekt-Gedächtnisdatei existiert',
  'cmd.doctor.config_dir_writable': '~/.goli-cli/-Verzeichnis ist beschreibbar',
  'cmd.doctor.all_pass': 'Alle Prüfungen bestanden',
  'cmd.doctor.some_fail': 'Einige Prüfungen fehlgeschlagen',

  // ─── Befehl: status ────────────────────────────────────────────
  'cmd.status.title': 'GOLI-CLI-Status',
  'cmd.status.active_sessions': 'Aktive Sitzungen',
  'cmd.status.uptime': 'Betriebszeit',
  'cmd.status.memory_usage': 'Speichernutzung',

  // ─── Befehl: usage ─────────────────────────────────────────────
  'cmd.usage.title': 'GOLI-CLI-Nutzung',
  'cmd.usage.tokens_used': 'Verwendete Token',
  'cmd.usage.cost': 'Kosten',
  'cmd.usage.sessions': 'Sitzungen',

  // ─── Befehl: cron ──────────────────────────────────────────────
  'cmd.cron.title': 'Geplante Jobs',
  'cmd.cron.add': 'Geplanten Job hinzufügen',
  'cmd.cron.list': 'Geplante Jobs auflisten',
  'cmd.cron.remove': 'Geplanten Job entfernen',
  'cmd.cron.pause': 'Geplanten Job pausieren',
  'cmd.cron.resume': 'Pausierten Job fortsetzen',

  // ─── Befehl: init ──────────────────────────────────────────────
  'cmd.init.title': 'GOLI.md initialisieren',
  'cmd.init.created': 'GOLI.md erstellt',
  'cmd.init.exists': 'GOLI.md existiert bereits',

  // ─── Befehl: mcp ───────────────────────────────────────────────
  'cmd.mcp.title': 'MCP-Server-Verwaltung',
  'cmd.mcp.add': 'MCP-Server hinzufügen',
  'cmd.mcp.list': 'MCP-Server auflisten',
  'cmd.mcp.remove': 'MCP-Server entfernen',

  // ─── Fehler ────────────────────────────────────────────────────
  'error.no_prompt': 'Fehler: -p-Flag erfordert einen Prompt (oder "-" für stdin)',
  'error.invalid_output_format': 'Fehler: ungültiges --output-format "{format}". Muss sein: text | json | stream-json',
  'error.generic': 'Fehler: {message}',
  'error.unknown_command': 'Fehler: unbekannter Befehl "{command}"',
  'error.missing_dependency': 'Fehler: fehlende Abhängigkeit "{dep}"',
  'error.permission_denied': 'Fehler: Berechtigung verweigert',
  'error.network_unreachable': 'Fehler: Netzwerk nicht erreichbar',
  'error.timeout': 'Fehler: Vorgang nach {seconds}s abgebrochen',

  // ─── Phasen ────────────────────────────────────────────────────
  'phase.init': 'INIT',
  'phase.plan': 'PLAN',
  'phase.tool': 'WERKZEUG',
  'phase.gen': 'GEN',
  'phase.done': 'FERTIG',
  'phase.init_description': 'Agenten-Schwarm wird initialisiert',
  'phase.plan_description': 'Aufgabenzersetzung wird geplant',
  'phase.tool_description': 'Werkzeugaufrufe werden ausgeführt',
  'phase.gen_description': 'Antwort wird generiert',
  'phase.done_description': 'Aufgabe abgeschlossen',

  // ─── Barrierefreiheit ──────────────────────────────────────────
  'a11y.spinner_label': 'Laden, bitte warten',
  'a11y.progress_label': 'Fortschrittsanzeige',
  'a11y.error_icon': 'Fehlerindikator',
  'a11y.success_icon': 'Erfolgsindikator',
  'a11y.warning_icon': 'Warnungsindikator',
  'a11y.high_contrast_mode': 'Hochkontrastmodus aktiviert',
  'a11y.screen_reader_mode': 'Bildschirmleser-Modus aktiviert',

  // ─── Sandbox ───────────────────────────────────────────────────
  'sandbox.read_only': 'Nur-Lese-Sandbox',
  'sandbox.workspace_write': 'Workspace-Schreib-Sandbox',
  'sandbox.danger_full_access': 'GEFAHR: Voller Zugriff (keine Sandbox)',
  'sandbox.violation': 'Sandbox-Verletzung: {action} in {mode}-Modus nicht erlaubt',

  // ─── Genehmigung ───────────────────────────────────────────────
  'approval.tier1_safe': 'Tier 1 (Sicher) — automatisch genehmigt',
  'approval.tier2_risky': 'Tier 2 (Risikobehaftet) — Genehmigung erforderlich',
  'approval.tier3_dangerous': 'Tier 3 (Gefährlich) — ausdrückliche Genehmigung erforderlich',
  'approval.prompt': 'Diese Aktion genehmigen? (y/N)',
};
