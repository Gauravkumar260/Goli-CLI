/**
 * Simplified Chinese locale catalog.
 *
 * @module i18n/catalogs/zh-CN
 */

import type { Catalog } from '../types.js';

/**
 *
 */
export const zhCN: Catalog = {
  // ─── 应用元数据 ────────────────────────────────────────────────
  'app.name': 'goli-cli',
  'app.tagline': '多智能体软件集群',
  'app.version_label': '版本',
  'app.description': '一个生产级的多智能体软件工程工具。',

  // ─── 常用词 ────────────────────────────────────────────────────
  'common.yes': '是',
  'common.no': '否',
  'common.ok': '确定',
  'common.cancel': '取消',
  'common.error': '错误',
  'common.warning': '警告',
  'common.success': '成功',
  'common.info': '信息',
  'common.loading': '加载中...',
  'common.done': '完成',
  'common.retry': '重试',
  'common.skip': '跳过',
  'common.abort': '中止',
  'common.continue': '继续',
  'common.unknown': '未知',

  // ─── CLI 标志 + 帮助 ──────────────────────────────────────────
  'cli.help_flag': '显示帮助',
  'cli.version_flag': '显示版本',
  'cli.interactive_flag': '启动完整交互式 TUI',
  'cli.demo_flag': '以演示模式运行（无需 LLM）',
  'cli.model_flag': '本次会话使用的模型 ID',
  'cli.god_flag': '绕过所有安全门（极其谨慎使用）',
  'cli.auto_flag': '自动批准 Tier 2（风险）操作',
  'cli.sandbox_flag': '沙箱模式：read-only | workspace-write | danger-full-access',
  'cli.effort_flag': '推理努力：low | high | max',
  'cli.debug_flag': '启用调试日志',
  'cli.print_flag': '无头模式：运行并打印结果到 stdout',
  'cli.output_format_flag': '输出格式：text | json | stream-json',
  'cli.prompt_flag': '提示文本（或 "-" 表示从 stdin 读取）',

  // ─── 命令：doctor ──────────────────────────────────────────────
  'cmd.doctor.title': 'GOLI-CLI 体检 — 环境健康检查',
  'cmd.doctor.checking': '检查中',
  'cmd.doctor.node_version': 'Node.js 版本',
  'cmd.doctor.ripgrep': 'ripgrep (rg) 已安装',
  'cmd.doctor.git': 'git 已安装',
  'cmd.doctor.glm_endpoint': 'GLM-5.2 端点可达',
  'cmd.doctor.goli_md': 'GOLI.md 项目记忆文件存在',
  'cmd.doctor.config_dir_writable': '~/.goli-cli/ 目录可写',
  'cmd.doctor.all_pass': '所有检查通过',
  'cmd.doctor.some_fail': '部分检查失败',

  // ─── 命令：status ──────────────────────────────────────────────
  'cmd.status.title': 'GOLI-CLI 状态',
  'cmd.status.active_sessions': '活跃会话',
  'cmd.status.uptime': '运行时长',
  'cmd.status.memory_usage': '内存使用',

  // ─── 命令：usage ───────────────────────────────────────────────
  'cmd.usage.title': 'GOLI-CLI 用量',
  'cmd.usage.tokens_used': 'Token 使用量',
  'cmd.usage.cost': '费用',
  'cmd.usage.sessions': '会话数',

  // ─── 命令：cron ────────────────────────────────────────────────
  'cmd.cron.title': '定时任务',
  'cmd.cron.add': '添加定时任务',
  'cmd.cron.list': '列出定时任务',
  'cmd.cron.remove': '删除定时任务',
  'cmd.cron.pause': '暂停定时任务',
  'cmd.cron.resume': '恢复已暂停的任务',

  // ─── 命令：init ────────────────────────────────────────────────
  'cmd.init.title': '初始化 GOLI.md',
  'cmd.init.created': '已创建 GOLI.md',
  'cmd.init.exists': 'GOLI.md 已存在',

  // ─── 命令：mcp ─────────────────────────────────────────────────
  'cmd.mcp.title': 'MCP 服务器管理',
  'cmd.mcp.add': '添加 MCP 服务器',
  'cmd.mcp.list': '列出 MCP 服务器',
  'cmd.mcp.remove': '删除 MCP 服务器',

  // ─── 错误 ──────────────────────────────────────────────────────
  'error.no_prompt': '错误：-p 标志需要一个提示（或 "-" 从 stdin 读取）',
  'error.invalid_output_format': '错误：无效的 --output-format "{format}"。必须是：text | json | stream-json',
  'error.generic': '错误：{message}',
  'error.unknown_command': '错误：未知命令 "{command}"',
  'error.missing_dependency': '错误：缺少依赖 "{dep}"',
  'error.permission_denied': '错误：权限被拒绝',
  'error.network_unreachable': '错误：网络不可达',
  'error.timeout': '错误：操作在 {seconds} 秒后超时',

  // ─── 阶段 ──────────────────────────────────────────────────────
  'phase.init': '初始化',
  'phase.plan': '计划',
  'phase.tool': '工具',
  'phase.gen': '生成',
  'phase.done': '完成',
  'phase.init_description': '正在初始化智能体集群',
  'phase.plan_description': '正在规划任务分解',
  'phase.tool_description': '正在执行工具调用',
  'phase.gen_description': '正在生成响应',
  'phase.done_description': '任务完成',

  // ─── 无障碍 ────────────────────────────────────────────────────
  'a11y.spinner_label': '加载中，请稍候',
  'a11y.progress_label': '进度指示器',
  'a11y.error_icon': '错误指示器',
  'a11y.success_icon': '成功指示器',
  'a11y.warning_icon': '警告指示器',
  'a11y.high_contrast_mode': '高对比度模式已启用',
  'a11y.screen_reader_mode': '屏幕阅读器模式已启用',

  // ─── 沙箱 ──────────────────────────────────────────────────────
  'sandbox.read_only': '只读沙箱',
  'sandbox.workspace_write': '工作区写入沙箱',
  'sandbox.danger_full_access': '危险：完全访问（无沙箱）',
  'sandbox.violation': '沙箱违规：{action} 在 {mode} 模式下不允许',

  // ─── 审批 ──────────────────────────────────────────────────────
  'approval.tier1_safe': 'Tier 1（安全）— 自动批准',
  'approval.tier2_risky': 'Tier 2（风险）— 需要批准',
  'approval.tier3_dangerous': 'Tier 3（危险）— 需要明确批准',
  'approval.prompt': '批准此操作吗？(y/N)',
};
