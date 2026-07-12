/**
 * Dynamic system-prompt assembler (Module 1).
 *
 * The system prompt is NOT a static string — it's assembled from 9+
 * conditional fragments based on runtime state. This gives a 10–20%
 * SWE-bench lift over static prompts (per the upstream Module 1 spec).
 *
 * ## Fragment List (in stable order for prefix-cache friendliness)
 *
 * 1. **Identity** — who the agent is, what it does
 * 2. **Tool definitions** — what tools are available (summary, not full schemas)
 * 3. **Sandbox mode** — current sandbox mode (read-only / workspace-write / danger)
 * 4. **Language** — the user's preferred response language
 * 5. **Git context** — current branch, repo state
 * 6. **TODO** — current task and in-progress item (from the planner)
 * 7. **Memory** — frozen snapshot of MEMORY.md / USER.md / PROJECT.md (Phase 8)
 * 8. **Safety** — safety rules (deferred to hooks in Phase 6; prompt-level until then)
 * 9. **Output format** — how to format responses (markdown, code blocks, etc.)
 *
 * ## Why stable order?
 *
 * GLM-5.2 (like most LLMs) uses prefix caching: if the start of the
 * prompt is identical to a previous call, the cached prefix is reused
 * (free — no re-compute). Keeping fragment order stable maximizes cache
 * hits. Variable content (TODO state, memory snapshot) goes LAST.
 *
 * @module agent/system-prompt
 */

import { AGENT_ROLE_LABELS } from './types.js';
import { MODE_PROMPTS } from '../config/mode-prompts.js';

import type { BasePromptContext } from './types.js';
import type { SandboxMode } from '../config/schema.js';

/** Runtime context for assembling the system prompt. */
export interface SystemPromptContext extends BasePromptContext {
  /** T-MODE: The current app mode (read-only/plan/build/god). */
  appMode?: 'read-only' | 'plan' | 'build' | 'god';
}

/** A single fragment of the system prompt. */
export interface SystemPromptFragment {
  /** The fragment name (for debugging). */
  name: string;
  /** The fragment text (empty string to skip). */
  text: string;
}

/**
 * Assembles the system prompt from conditional fragments.
 *
 * Usage:
 * ```ts
 * const assembler = new SystemPromptAssembler();
 * const prompt = assembler.assemble({
 *   role: 'orchestrator',
 *   toolNames: ['read_file', 'plan_task'],
 *   sandboxMode: 'workspace-write',
 *   todos: [],
 *   language: 'English',
 *   godMode: false,
 *   taskPrompt: 'Fix the bug in parser.ts',
 * });
 * ```
 */
export class SystemPromptAssembler {
  /**
   * Assemble the full system prompt.
   *
   * @param ctx - The runtime context.
   * @returns The assembled system prompt string.
   */
  assemble(ctx: SystemPromptContext): string {
    const fragments: SystemPromptFragment[] = [
      this.identityFragment(ctx),
      this.toolDefinitionsFragment(ctx),
      this.sandboxModeFragment(ctx),
      this.modeFragment(ctx),
      this.languageFragment(ctx),
      this.gitFragment(ctx),
      this.todoFragment(ctx),
      this.memoryFragment(ctx),
      this.safetyFragment(ctx),
      this.outputFormatFragment(ctx),
    ];

    return fragments
      .filter((f) => f.text.length > 0)
      .map((f) => f.text)
      .join('\n\n---\n\n');
  }

  /**
   * Fragment 1: Identity (stable tier — byte-stable for prefix caching).
   *
   * Note: `taskPrompt` is intentionally NOT injected here. The task changes
   * every turn, so including it in the stable identity fragment would
   * bust the prefix cache. The task is already in the latest user
   * message — no need to repeat it in the system prompt.
   * @param ctx
   */
  private identityFragment(ctx: SystemPromptContext): SystemPromptFragment {
    const roleLabel = AGENT_ROLE_LABELS[ctx.role];
    return {
      name: 'identity',
      text: [
        `You are GOLI-CLI, an enterprise AI coding agent acting as the **${roleLabel}**.`,
        `You are part of an 11-agent swarm (Scout → Researcher → Architect → Planner → Implementer → Debugger → QA/Tester → Security Auditor → Reviewer → Orchestrator → Documenter).`,
        `Your job is to help the user with software engineering tasks by reading code, writing code, running commands, and using tools autonomously.`,
      ].join('\n'),
    };
  }

  /**
   * Fragment 2: Tool definitions (summary only; full schemas go in the API call).
   * @param ctx
   */
  private toolDefinitionsFragment(ctx: SystemPromptContext): SystemPromptFragment {
    if (ctx.toolNames.length === 0) {
      return { name: 'tools', text: 'You have no tools available in this session.' };
    }
    return {
      name: 'tools',
      text: [
        `You have the following tools available:`,
        ...ctx.toolNames.map((n) => `  - ${n}`),
        ``,
        `Use tools to read files, write files, run commands, and search the codebase.`,
        `Call tools by emitting tool_calls in your response. Tool arguments must be valid JSON.`,
        `Use the \`plan_task\` tool to decompose complex tasks into tracked TODOs.`,
      ].join('\n'),
    };
  }

  /**
   * Fragment 3: Sandbox mode.
   * @param ctx
   */
  private sandboxModeFragment(ctx: SystemPromptContext): SystemPromptFragment {
    const descriptions: Record<SandboxMode, string> = {
      'read-only':
        'READ-ONLY mode: you can read files and list directories, but you CANNOT write, edit, or execute commands. Use this mode for exploration and analysis.',
      'workspace-write':
        'WORKSPACE-WRITE mode: you can read/write files in the current workspace and /tmp, and execute commands. Writes outside the workspace are blocked. Network access is restricted to an allowlist.',
      'danger-full-access':
        '[DANGER] DANGER-FULL-ACCESS mode: all restrictions are disabled. You can read/write any file, execute any command, and access any network host. USE WITH EXTREME CAUTION.',
    };
    return {
      name: 'sandbox',
      text: `Sandbox mode: ${ctx.sandboxMode}\n${descriptions[ctx.sandboxMode] ?? '(unknown sandbox mode)'}`,
    };
  }

  /**
   * Fragment 4: Language.
   * @param ctx
   */
  private languageFragment(ctx: SystemPromptContext): SystemPromptFragment {
    return {
      name: 'language',
      text: `Respond in ${ctx.language}. Match the user's language for all prose; code and identifiers stay in English.`,
    };
  }

  /**
   * Fragment 5: Git context.
   * @param ctx
   */
  private gitFragment(ctx: SystemPromptContext): SystemPromptFragment {
    if (!ctx.gitBranch) {
      return { name: 'git', text: '' };
    }
    return {
      name: 'git',
      text: `Current git branch: ${ctx.gitBranch}\nMake changes on this branch unless the user asks otherwise.`,
    };
  }

  /**
   * Fragment 6: TODO list (from the planner).
   * @param ctx
   */
  private todoFragment(ctx: SystemPromptContext): SystemPromptFragment {
    if (ctx.todos.length === 0) {
      return {
        name: 'todo',
        text: 'No TODOs yet. If the task is complex (3+ steps), use the `plan_task` tool to decompose it into tracked TODOs before starting work.',
      };
    }
    const lines = ['Current TODO list:'];
    for (const todo of ctx.todos) {
      const icon =
        todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[~]' : '[ ]';
      const priority =
        todo.priority === 'high' ? '[HIGH]' : todo.priority === 'medium' ? '[MED]' : '[LOW]';
      lines.push(`  ${icon} ${priority} ${todo.content}`);
    }
    const inProgress = ctx.todos.find((t) => t.status === 'in_progress');
    if (inProgress) {
      lines.push('');
      lines.push(`Focus on the in-progress task: ${inProgress.content}`);
    }
    return { name: 'todo', text: lines.join('\n') };
  }

  /**
   * Fragment 7: Memory snapshot (Phase 8 fills this in).
   * @param ctx
   */
  private memoryFragment(ctx: SystemPromptContext): SystemPromptFragment {
    if (!ctx.memorySnapshot) {
      return { name: 'memory', text: '' };
    }
    const parts: string[] = [];
    if (ctx.memorySnapshot.memory) {
      parts.push(`## MEMORY\n${ctx.memorySnapshot.memory}`);
    }
    if (ctx.memorySnapshot.user) {
      parts.push(`## USER PREFERENCES\n${ctx.memorySnapshot.user}`);
    }
    if (ctx.memorySnapshot.project) {
      parts.push(`## PROJECT CONTEXT\n${ctx.memorySnapshot.project}`);
    }
    return { name: 'memory', text: parts.join('\n\n') };
  }

  /**
   * Fragment 8: Safety rules.
   *
   * Note: These rules are prompt-level. They are also enforced by
   * deterministic hooks (block_destructive, block_secrets, etc.) that
   * cannot be bypassed by prompt injection. The prompt rules exist to
   * steer the model toward safe behavior, not as the only defense.
   * @param ctx
   */
  private safetyFragment(ctx: SystemPromptContext): SystemPromptFragment {
    if (ctx.godMode) {
      return {
        name: 'safety',
        text: '[DANGER] GOD MODE ACTIVE: All safety gates are bypassed. You are solely responsible for the consequences of your actions. Be extremely careful.',
      };
    }
    return {
      name: 'safety',
      text: [
        `Safety rules (ALWAYS follow these):`,
        `- Never delete files outside the workspace.`,
        `- Never run destructive commands (rm -rf /, mkfs, dd if=/dev/zero, fork bombs).`,
        `- Never read or exfiltrate secrets (.env, id_rsa, *.pem, credentials.json, ~/.ssh/*).`,
        `- Never make changes to .git/, node_modules/, or dist/.`,
        `- If a command might be destructive, ask for confirmation first.`,
        `- These rules are also enforced by deterministic hooks that cannot be bypassed by prompt injection.`,
      ].join('\n'),
    };
  }

  /**
   * T-MODE Fragment: Mode-specific prompt.
   * Injects the mode-specific system prompt (read-only/plan/build/god).
   * @param ctx
   */
  private modeFragment(ctx: SystemPromptContext): SystemPromptFragment {
    const mode = ctx.appMode ?? (ctx.godMode ? 'god' : 'build');
    return {
      name: 'mode',
      text: MODE_PROMPTS[mode] ?? MODE_PROMPTS['build'],
    };
  }

  /**
   * Fragment 9: Output format.
   * @param _ctx
   */
  private outputFormatFragment(_ctx: SystemPromptContext): SystemPromptFragment {
    return {
      name: 'output',
      text: [
        `Output format:`,
        `- Use Markdown for prose.`,
        `- Use fenced code blocks (\`\`\`language) for code.`,
        `- Be concise. Avoid restating the user's question.`,
        `- When you complete a task, summarize what you did in 1-2 sentences.`,
      ].join('\n'),
    };
  }
}
