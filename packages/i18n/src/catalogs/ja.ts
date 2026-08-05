/**
 * Japanese locale catalog.
 *
 * @module i18n/catalogs/ja
 */

import type { Catalog } from '../types.js';

/**
 *
 */
export const ja: Catalog = {
  // ─── アプリメタデータ ──────────────────────────────────────────
  'app.name': 'goli-cli',
  'app.tagline': 'マルチエージェント ソフトウェア スワーム',
  'app.version_label': 'バージョン',
  'app.description': '本番環境対応のマルチエージェント ソフトウェア エンジニアリング ツール。',

  // ─── 一般語 ────────────────────────────────────────────────────
  'common.yes': 'はい',
  'common.no': 'いいえ',
  'common.ok': 'OK',
  'common.cancel': 'キャンセル',
  'common.error': 'エラー',
  'common.warning': '警告',
  'common.success': '成功',
  'common.info': '情報',
  'common.loading': '読み込み中...',
  'common.done': '完了',
  'common.retry': '再試行',
  'common.skip': 'スキップ',
  'common.abort': '中止',
  'common.continue': '続行',
  'common.unknown': '不明',

  // ─── CLI フラグ + ヘルプ ──────────────────────────────────────
  'cli.help_flag': 'ヘルプを表示',
  'cli.version_flag': 'バージョンを表示',
  'cli.interactive_flag': '完全なインタラクティブ TUI を開始',
  'cli.demo_flag': 'デモモードで実行（LLM 不要）',
  'cli.model_flag': 'このセッションで使用するモデル ID',
  'cli.god_flag': 'すべての安全ゲートをバイパス（極めて注意して使用）',
  'cli.auto_flag': 'Tier 2（リスクあり）アクションを自動承認',
  'cli.sandbox_flag': 'サンドボックスモード：read-only | workspace-write | danger-full-access',
  'cli.effort_flag': '推論努力：low | high | max',
  'cli.debug_flag': 'デバッグログを有効化',
  'cli.print_flag': 'ヘッドレスモード：実行して結果を stdout に出力',
  'cli.output_format_flag': '出力形式：text | json | stream-json',
  'cli.prompt_flag': 'プロンプトテキスト（または "-" で stdin から）',

  // ─── コマンド：doctor ──────────────────────────────────────────
  'cmd.doctor.title': 'GOLI-CLI ドクター — 環境ヘルスチェック',
  'cmd.doctor.checking': '確認中',
  'cmd.doctor.node_version': 'Node.js バージョン',
  'cmd.doctor.ripgrep': 'ripgrep (rg) インストール済み',
  'cmd.doctor.git': 'git インストール済み',
  'cmd.doctor.model_endpoint': 'モデルエンドポイント到達可能',
  'cmd.doctor.goli_md': 'GOLI.md プロジェクトメモリファイル存在',
  'cmd.doctor.config_dir_writable': '~/.goli-cli/ ディレクトリ書き込み可能',
  'cmd.doctor.all_pass': 'すべてのチェックが合格しました',
  'cmd.doctor.some_fail': '一部のチェックが失敗しました',

  // ─── コマンド：status ──────────────────────────────────────────
  'cmd.status.title': 'GOLI-CLI ステータス',
  'cmd.status.active_sessions': 'アクティブセッション',
  'cmd.status.uptime': '稼働時間',
  'cmd.status.memory_usage': 'メモリ使用量',

  // ─── コマンド：usage ───────────────────────────────────────────
  'cmd.usage.title': 'GOLI-CLI 使用量',
  'cmd.usage.tokens_used': '使用トークン',
  'cmd.usage.cost': 'コスト',
  'cmd.usage.sessions': 'セッション',

  // ─── コマンド：cron ────────────────────────────────────────────
  'cmd.cron.title': 'スケジュール済みジョブ',
  'cmd.cron.add': 'スケジュール済みジョブを追加',
  'cmd.cron.list': 'スケジュール済みジョブ一覧',
  'cmd.cron.remove': 'スケジュール済みジョブを削除',
  'cmd.cron.pause': 'スケジュール済みジョブを一時停止',
  'cmd.cron.resume': '一時停止中のジョブを再開',

  // ─── コマンド：init ────────────────────────────────────────────
  'cmd.init.title': 'GOLI.md を初期化',
  'cmd.init.created': 'GOLI.md を作成しました',
  'cmd.init.exists': 'GOLI.md は既に存在します',

  // ─── コマンド：mcp ─────────────────────────────────────────────
  'cmd.mcp.title': 'MCP サーバー管理',
  'cmd.mcp.add': 'MCP サーバーを追加',
  'cmd.mcp.list': 'MCP サーバー一覧',
  'cmd.mcp.remove': 'MCP サーバーを削除',

  // ─── エラー ────────────────────────────────────────────────────
  'error.no_prompt': 'エラー：-p フラグにはプロンプトが必要です（または "-" で stdin から）',
  'error.invalid_output_format': 'エラー：無効な --output-format "{format}"。text | json | stream-json のいずれかが必要です',
  'error.generic': 'エラー：{message}',
  'error.unknown_command': 'エラー：不明なコマンド "{command}"',
  'error.missing_dependency': 'エラー：依存関係 "{dep}" がありません',
  'error.permission_denied': 'エラー：アクセス拒否',
  'error.network_unreachable': 'エラー：ネットワーク到達不能',
  'error.timeout': 'エラー：{seconds}秒後に操作がタイムアウトしました',

  // ─── フェーズ ──────────────────────────────────────────────────
  'phase.init': '初期化',
  'phase.plan': '計画',
  'phase.tool': 'ツール',
  'phase.gen': '生成',
  'phase.done': '完了',
  'phase.init_description': 'エージェントスワームを初期化中',
  'phase.plan_description': 'タスク分解を計画中',
  'phase.tool_description': 'ツール呼び出しを実行中',
  'phase.gen_description': '応答を生成中',
  'phase.done_description': 'タスク完了',

  // ─── アクセシビリティ ──────────────────────────────────────────
  'a11y.spinner_label': '読み込み中です、お待ちください',
  'a11y.progress_label': '進捗インジケーター',
  'a11y.error_icon': 'エラーインジケーター',
  'a11y.success_icon': '成功インジケーター',
  'a11y.warning_icon': '警告インジケーター',
  'a11y.high_contrast_mode': 'ハイコントラストモード有効',
  'a11y.screen_reader_mode': 'スクリーンリーダーモード有効',

  // ─── サンドボックス ────────────────────────────────────────────
  'sandbox.read_only': '読み取り専用サンドボックス',
  'sandbox.workspace_write': 'ワークスペース書き込みサンドボックス',
  'sandbox.danger_full_access': '危険：完全アクセス（サンドボックスなし）',
  'sandbox.violation': 'サンドボックス違反：{action} は {mode} モードで許可されていません',

  // ─── 承認 ──────────────────────────────────────────────────────
  'approval.tier1_safe': 'Tier 1（安全）— 自動承認',
  'approval.tier2_risky': 'Tier 2（リスクあり）— 承認が必要',
  'approval.tier3_dangerous': 'Tier 3（危険）— 明示的な承認が必要',
  'approval.prompt': 'このアクションを承認しますか？(y/N)',
};
