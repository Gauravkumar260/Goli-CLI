/**
 * Spanish locale catalog.
 *
 * @module i18n/catalogs/es
 */

import type { Catalog } from '../types.js';

/**
 *
 */
export const es: Catalog = {
  // ─── App metadata ──────────────────────────────────────────────
  'app.name': 'goli-cli',
  'app.tagline': 'Enjambre de Software Multi-Agente',
  'app.version_label': 'versión',
  'app.description': 'Una herramienta de ingeniería de software multi-agente de grado producción.',

  // ─── Common words ──────────────────────────────────────────────
  'common.yes': 'Sí',
  'common.no': 'No',
  'common.ok': 'OK',
  'common.cancel': 'Cancelar',
  'common.error': 'Error',
  'common.warning': 'Advertencia',
  'common.success': 'Éxito',
  'common.info': 'Información',
  'common.loading': 'Cargando...',
  'common.done': 'Listo',
  'common.retry': 'Reintentar',
  'common.skip': 'Omitir',
  'common.abort': 'Abortar',
  'common.continue': 'Continuar',
  'common.unknown': 'Desconocido',

  // ─── CLI flags + help ──────────────────────────────────────────
  'cli.help_flag': 'Mostrar ayuda',
  'cli.version_flag': 'Mostrar versión',
  'cli.interactive_flag': 'Iniciar la TUI interactiva completa',
  'cli.demo_flag': 'Ejecutar en modo demo (sin LLM)',
  'cli.model_flag': 'ID del modelo a usar para esta sesión',
  'cli.god_flag': 'Omitir todas las barreras de seguridad (usar con extrema precaución)',
  'cli.auto_flag': 'Auto-aprobar acciones de Nivel 2 (Arriesgadas)',
  'cli.sandbox_flag': 'Modo sandbox: read-only | workspace-write | danger-full-access',
  'cli.effort_flag': 'Esfuerzo de razonamiento: low | high | max',
  'cli.debug_flag': 'Habilitar registro de depuración',
  'cli.print_flag': 'Modo sin cabeza: ejecutar e imprimir resultado a stdout',
  'cli.output_format_flag': 'Formato de salida: text | json | stream-json',
  'cli.prompt_flag': 'Texto del prompt (o "-" para stdin)',

  // ─── Command: doctor ───────────────────────────────────────────
  'cmd.doctor.title': 'GOLI-CLI Doctor — Verificación de Salud del Entorno',
  'cmd.doctor.checking': 'Verificando',
  'cmd.doctor.node_version': 'Versión de Node.js',
  'cmd.doctor.ripgrep': 'ripgrep (rg) instalado',
  'cmd.doctor.git': 'git instalado',
  'cmd.doctor.model_endpoint': 'Endpoint del modelo alcanzable',
  'cmd.doctor.goli_md': 'Archivo de memoria del proyecto GOLI.md existe',
  'cmd.doctor.config_dir_writable': 'Directorio ~/.goli-cli/ es escribible',
  'cmd.doctor.all_pass': 'Todas las verificaciones pasaron',
  'cmd.doctor.some_fail': 'Algunas verificaciones fallaron',

  // ─── Command: status ───────────────────────────────────────────
  'cmd.status.title': 'Estado de GOLI-CLI',
  'cmd.status.active_sessions': 'Sesiones activas',
  'cmd.status.uptime': 'Tiempo de actividad',
  'cmd.status.memory_usage': 'Uso de memoria',

  // ─── Command: usage ────────────────────────────────────────────
  'cmd.usage.title': 'Uso de GOLI-CLI',
  'cmd.usage.tokens_used': 'Tokens usados',
  'cmd.usage.cost': 'Costo',
  'cmd.usage.sessions': 'Sesiones',

  // ─── Command: cron ─────────────────────────────────────────────
  'cmd.cron.title': 'Trabajos Programados',
  'cmd.cron.add': 'Agregar un trabajo programado',
  'cmd.cron.list': 'Listar trabajos programados',
  'cmd.cron.remove': 'Eliminar un trabajo programado',
  'cmd.cron.pause': 'Pausar un trabajo programado',
  'cmd.cron.resume': 'Reanudar un trabajo pausado',

  // ─── Command: init ─────────────────────────────────────────────
  'cmd.init.title': 'Inicializar GOLI.md',
  'cmd.init.created': 'GOLI.md creado',
  'cmd.init.exists': 'GOLI.md ya existe',

  // ─── Command: mcp ──────────────────────────────────────────────
  'cmd.mcp.title': 'Gestión de Servidor MCP',
  'cmd.mcp.add': 'Agregar un servidor MCP',
  'cmd.mcp.list': 'Listar servidores MCP',
  'cmd.mcp.remove': 'Eliminar un servidor MCP',

  // ─── Errors ────────────────────────────────────────────────────
  'error.no_prompt': 'Error: la bandera -p requiere un prompt (o "-" para leer de stdin)',
  'error.invalid_output_format': 'Error: --output-format inválido "{format}". Debe ser: text | json | stream-json',
  'error.generic': 'Error: {message}',
  'error.unknown_command': 'Error: comando desconocido "{command}"',
  'error.missing_dependency': 'Error: dependencia faltante "{dep}"',
  'error.permission_denied': 'Error: permiso denegado',
  'error.network_unreachable': 'Error: red inalcanzable',
  'error.timeout': 'Error: operación agotó el tiempo después de {seconds}s',

  // ─── Phases ────────────────────────────────────────────────────
  'phase.init': 'INICIO',
  'phase.plan': 'PLAN',
  'phase.tool': 'HERRAMIENTA',
  'phase.gen': 'GEN',
  'phase.done': 'LISTO',
  'phase.init_description': 'Inicializando enjambre de agentes',
  'phase.plan_description': 'Planificando descomposición de tareas',
  'phase.tool_description': 'Ejecutando llamadas a herramientas',
  'phase.gen_description': 'Generando respuesta',
  'phase.done_description': 'Tarea completada',

  // ─── Accessibility ─────────────────────────────────────────────
  'a11y.spinner_label': 'Cargando, por favor espere',
  'a11y.progress_label': 'Indicador de progreso',
  'a11y.error_icon': 'Indicador de error',
  'a11y.success_icon': 'Indicador de éxito',
  'a11y.warning_icon': 'Indicador de advertencia',
  'a11y.high_contrast_mode': 'Modo de alto contraste habilitado',
  'a11y.screen_reader_mode': 'Modo de lector de pantalla habilitado',

  // ─── Sandbox ───────────────────────────────────────────────────
  'sandbox.read_only': 'Sandbox de solo lectura',
  'sandbox.workspace_write': 'Sandbox de escritura en workspace',
  'sandbox.danger_full_access': 'PELIGRO: Acceso completo (sin sandbox)',
  'sandbox.violation': 'Violación de sandbox: {action} no permitido en modo {mode}',

  // ─── Approval ──────────────────────────────────────────────────
  'approval.tier1_safe': 'Nivel 1 (Seguro) — auto-aprobado',
  'approval.tier2_risky': 'Nivel 2 (Arriesgado) — requiere aprobación',
  'approval.tier3_dangerous': 'Nivel 3 (Peligroso) — requiere aprobación explícita',
  'approval.prompt': '¿Aprobar esta acción? (y/N)',
};
