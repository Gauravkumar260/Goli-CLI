/**
 * Dynamic system-prompt assembler (Module 1).
 *
 * The system prompt is NOT a static string — it's assembled from 13
 * conditional fragments based on runtime state. This gives a 10–20%
 * SWE-bench lift over static prompts (per the upstream Module 1 spec).
 *
 * ## Fragment List (in stable order for prefix-cache friendliness)
 *
 * 1.  **Identity** — who the agent is, what it does
 * 2.  **Tool definitions** — what tools are available (summary, not full schemas)
 * 3.  **Sandbox mode** — current sandbox mode (read-only / workspace-write / danger)
 * 4.  **Mode** — mode-specific prompt (T-MODE: read-only / plan / build / god / local-llms)
 * 5.  **Language** — the user's preferred response language
 * 6.  **Git context** — current branch, repo state
 * 7.  **TODO** — current task and in-progress item (from the planner)
 * 8.  **Memory** — frozen snapshot of MEMORY.md / USER.md / PROJECT.md (Phase 8)
 * 9.  **Retrieved context** — P2-7: code-intelligence results from the hybrid retriever
 * 10. **Skills** — P1-4 fix: L1 metadata from SkillLoader (ADR-0026)
 * 11. **Recent file reads** — P2-9 fix: files the agent has read this session (capped at 20)
 * 12. **Safety** — safety rules (deferred to hooks in Phase 6; prompt-level until then)
 * 13. **Output format** — how to format responses (markdown, code blocks, etc.)
 *
 * ## Why stable order?
 *
 * The model (like most LLMs) uses prefix caching: if the start of the
 * prompt is identical to a previous call, the cached prefix is reused
 * (free — no re-compute). Keeping fragment order stable maximizes cache
 * hits. Variable content (TODO state, memory snapshot, retrieved
 * context) goes LAST.
 *
 * ## P2-10 note (audit Finding CC-5 / 2.4) — superseded by P2-18
 *
 * The audit originally recommended replacing SystemPromptAssembler with
 * a `PromptBuilder` class to "get all 9 brief-listed fragments." After
 * review, SystemPromptAssembler already had MORE fragments than
 * PromptBuilder (12 vs 8) and included the brief-listed ones
 * PromptBuilder lacked (mode, todo, memory, retrieved-context, skills).
 * P2-18 (remediation plan Phase 18) then deleted `prompt-builder.ts`
 * entirely as dead code — it was never instantiated in production.
 * SystemPromptAssembler is now the sole canonical assembler (13
 * fragments after the P2-9 recentReadFilesFragment addition).
 *
 * ## P1-4 note (verification report item #4 — Skills subsystem)
 *
 * The skills subsystem (SkillLoader, SkillCatalog, SkillWriter,
 * SkillArchiver) was fully implemented and unit-tested but had zero
 * production callers — `formatL1ForPrompt()` was never invoked from
 * the agent loop or the system-prompt assembler. We now wire it up:
 * the assembler accepts an optional `skillsL1` string (produced by
 * `SkillLoader.formatL1ForPrompt()`) and injects it as the "Skills"
 * fragment. The AgentLoop constructs a SkillLoader lazily and passes
 * the L1 summary to the assembler via `SystemPromptContext.skillsL1`.
 *
 * @module agent/system-prompt
 */

import { relative, sep } from 'node:path';

import { MODE_PROMPTS } from '@goli-cli/config/mode-prompts.js';

import { AGENT_ROLE_LABELS } from './types.js';

import type { AgentRole } from './types.js';
import type { BasePromptContext } from './types.js';
import type { SandboxMode } from '@goli-cli/config/schema.js';

/**
 * Per-role mission statements. Each role in the 11-agent swarm has a
 * specialized one-sentence mission that replaces the generic "help the
 * user with software engineering tasks" line. This gives the model
 * clear role-specific guidance without busting the prefix cache (the
 * mission is stable for the lifetime of a conversation).
 */
const ROLE_MISSIONS: Record<AgentRole, string> = {
  orchestrator:
    'Your job is to coordinate the agent pipeline: decompose the task, delegate to specialist roles, track budget, and merge results into a coherent final answer.',
  scout:
    'Your job is to explore the repository and identify the minimal set of files needed to accomplish the task. Do NOT modify any files. Report file paths with a one-line relevance explanation.',
  researcher:
    'Your job is to gather external context (library docs, API references, best practices) that will help the Architect design the solution. Cite your sources.',
  architect:
    'Your job is to design the solution approach. Consider alternatives, trade-offs, and edge cases. Do NOT write implementation code — produce a design doc the Planner can break into steps.',
  planner:
    'Your job is to break the design into atomic, testable steps. Each step must be independently verifiable. Use the `plan_task` tool to create the tracked TODO list.',
  implementer:
    'Your job is to execute the TODO list step by step. After each step, verify the change works. Use `edit_file` for surgical changes, `write_file` for new files. Follow project conventions.',
  debugger:
    'Your job is to run the test suite, identify failures, and fix the root cause — not the symptom. Do NOT weaken tests. If a test is wrong, fix the test; if the code is wrong, fix the code.',
  'qa-tester':
    'Your job is to write tests for the new functionality. Cover happy path, edge cases, and error conditions. Run the full suite to verify no regressions.',
  'security-auditor':
    'Your job is to review the diff for security vulnerabilities, secrets, and unsafe patterns. Report findings by severity. Read-only — do NOT modify files.',
  reviewer:
    'Your job is to review the diff for code quality, naming conventions, error handling, and adherence to project conventions. Be specific — cite line numbers.',
  documenter:
    'Your job is to update README, CHANGELOG, and inline JSDoc/TSDoc to reflect the changes. Do NOT modify implementation code — only docs.',
};

/** Runtime context for assembling the system prompt. */
export interface SystemPromptContext extends BasePromptContext {
  /** T-MODE: The current app mode (read-only/plan/build/god/local-llms). */
  appMode?: 'read-only' | 'plan' | 'build' | 'god' | 'local-llms';
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
      // P2-7: Code-intelligence context (from createContextEngine's
      // hybrid retriever). Injected before the safety fragment so the
      // agent sees relevant symbols before its first tool call.
      this.retrievedContextFragment(ctx),
      // P1-4 fix (verification report item #4): Skills L1 metadata
      // from SkillLoader. Injected before the safety fragment so the
      // agent knows which skills are available before its first tool
      // call. When no SkillLoader is configured, this fragment is
      // empty (filtered out by the assembler).
      this.skillsFragment(ctx),
      // P0-6 fix (remediation plan Phase 6): L2 skill instructions
      // loaded on-demand. When the user's query matches skill
      // triggers, the AgentLoop calls `loadL2Instructions()` for the
      // top matches and concatenates their full playbooks here. The
      // agent sees the complete instructions — not just the L1
      // metadata — so it can follow the skill's playbook directly.
      // When undefined or empty, no L2 fragment is injected.
      this.skillsL2Fragment(ctx),
      // P2-9 fix (re-verification report item #11): Recent file reads.
      // `state.readFiles` was tracked in loop.ts for Read-before-Edit
      // enforcement but never injected into the prompt — the agent
      // had no prompt-level awareness of which files it had already
      // read. We now surface the most recent N paths so the agent
      // can reference them without re-reading. When undefined or
      // empty, this fragment is omitted (backward-compatible).
      this.recentReadFilesFragment(ctx),
      // P2-18 fix (remediation plan Phase 18): Reflexion notes from
      // prior tool failures. Injected after recent-reads and before
      // the safety fragment so the agent sees prior lessons before its
      // next tool call. When undefined or empty, the fragment is
      // omitted (backward-compatible for callers that don't wire
      // ReflexionEngine).
      this.reflectionsFragment(ctx),
      this.safetyFragment(ctx),
      this.outputFormatFragment(ctx),
    ];

    return fragments
      .filter((f) => f.text.length > 0)
      .map((f) => f.text)
      .join('\n\n---\n\n');
  }

  /**
   * P1-4 fix (verification report item #4): Skills L1 fragment.
   *
   * When `ctx.skillsL1` is provided (by the AgentLoop, which constructs
   * a SkillLoader and calls `formatL1ForPrompt()`), the L1 metadata is
   * injected as a "Skills" fragment so the agent knows which skills are
   * available in the catalog. The agent can then request L2
   * instructions via the `ask_user` tool or by emitting a skill-name
   * tool call (future: a dedicated `load_skill` tool).
   *
   * When `ctx.skillsL1` is undefined or empty, this fragment is empty
   * (filtered out by the assembler). This preserves backward
   * compatibility for callers that don't configure a SkillLoader.
   */
  private skillsFragment(ctx: SystemPromptContext): SystemPromptFragment {
    const text = ctx.skillsL1?.trim() ?? '';
    if (text.length === 0) {
      return { name: 'skills', text: '' };
    }
    return {
      name: 'skills',
      text: `## Skills\n\n${text}\n\nTo request the full instructions for a skill, mention the skill name in your response.`,
    };
  }

  /**
   * P0-6 fix (remediation plan Phase 6): L2 skill instructions fragment.
   *
   * When `ctx.skillsL2` is provided (by the AgentLoop, which calls
   * `SkillLoader.loadL2Instructions()` for the top trigger-matching
   * skills), the assembler injects the full playbooks here. The agent
   * sees the complete instructions — not just the L1 metadata — so it
   * can follow the skill's playbook directly without an additional
   * `ask_user` round-trip.
   *
   * When `ctx.skillsL2` is undefined or empty, this fragment is empty
   * (filtered out by the assembler). This preserves backward
   * compatibility for callers that don't wire L2 loading.
   */
  private skillsL2Fragment(ctx: SystemPromptContext): SystemPromptFragment {
    const text = ctx.skillsL2?.trim() ?? '';
    if (text.length === 0) {
      return { name: 'skills-l2', text: '' };
    }
    return {
      name: 'skills-l2',
      text: `## Skill Instructions (L2 — loaded on-demand)\n\n${text}`,
    };
  }

  /**
   * P2-7: Retrieved-context fragment.
   *
   * When the AgentLoop is constructed with a context engine, it queries
   * the hybrid retriever (tree-sitter symbol graph + ripgrep lexical +
   * semantic) with the task prompt and passes the top-k results as
   * `ctx.retrievedContext`. We inject them here so the agent sees
   * relevant symbols, callers, and file paths before its first tool
   * call — reducing the number of exploratory read_file/grep calls.
   *
   * When `ctx.retrievedContext` is undefined or empty, this fragment
   * is empty (filtered out by the assembler).
   */
  private retrievedContextFragment(ctx: SystemPromptContext): SystemPromptFragment {
    const text = ctx.retrievedContext?.trim() ?? '';
    if (text.length === 0) {
      return { name: 'retrieved-context', text: '' };
    }
    return {
      name: 'retrieved-context',
      text: `## Retrieved Context\n\nThe following code-intelligence results were retrieved from the workspace symbol graph and may be relevant to your task. Use them to jump-start your work, but verify with read_file before making changes.\n\n${text}`,
    };
  }

  /**
   * P2-9 fix (re-verification report item #11): Recent file reads fragment.
   *
   * The AgentLoop tracks every file the agent has read via `read_file`
   * in `state.readFiles` (a `Set<string>` of resolved absolute paths).
   * This is primarily for Read-before-Edit enforcement (the
   * `edit_file` tool checks the set before allowing an edit), but it
   * ALSO tells the agent which files it has already explored — useful
   * context that was previously NOT surfaced in the prompt. The agent
   * would often re-read the same file or lose track of context after
   * compaction.
   *
   * We now inject the most recent N paths as a "Recent File Reads"
   * fragment. The list is capped (default 20) to keep the prompt
   * bounded — older reads age out. Paths are displayed relative to
   * `process.cwd()` when possible (shorter + more readable), falling
   * back to the absolute path for files outside the workspace.
   *
   * When `ctx.recentReadFiles` is undefined or empty, this fragment
   * is empty (filtered out by the assembler).
   */
  private recentReadFilesFragment(ctx: SystemPromptContext): SystemPromptFragment {
    const files = ctx.recentReadFiles;
    if (!files || files.length === 0) {
      return { name: 'recent-read-files', text: '' };
    }
    // Cap at 20 paths to keep the prompt bounded. The Set in loop.ts
    // preserves insertion order (most-recent-last in JS Sets), so we
    // take the last 20 and reverse to show most-recent-first.
    const MAX_FILES = 20;
    const cwd = process.cwd();
    const recent = files.slice(-MAX_FILES).reverse();
    const lines: string[] = ['## Recent File Reads', '', 'You have already read these files this session (most recent first):'];
    for (const absPath of recent) {
      // Display relative to cwd when the file is inside the workspace
      // (shorter + more readable), otherwise show the absolute path.
      // Use path.relative() so the "inside the workspace" test works on
      // both POSIX (`/`) and Windows (`\`) separators, and normalize any
      // remaining `\` to `/` for a stable, readable display path.
      const rel = relative(cwd, absPath);
      const isInside = rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith('..\\') && !rel.startsWith('../');
      const displayPath = isInside
        ? rel.split(sep).join('/')
        : absPath.split(sep).join('/');
      lines.push(`  - ${displayPath}`);
    }
    lines.push('');
    lines.push('You can reference these files without re-reading them unless the content has changed.');
    return { name: 'recent-read-files', text: lines.join('\n') };
  }

  /**
   * P2-18 fix (remediation plan Phase 18): Reflexion notes fragment.
   *
   * The AgentLoop instantiates a `ReflexionEngine` and calls
   * `reflect()` after each tool-call failure. The engine accumulates
   * the resulting `Reflection` entries (each with a `strategy` field
   * describing a concrete strategy change for the next attempt). The
   * loop then calls `reflexionEngine.formatForPrompt()` and passes the
   * resulting string here.
   *
   * When `ctx.reflections` is undefined or empty, this fragment is
   * empty (filtered out by the assembler) — backward-compatible for
   * callers that don't wire ReflexionEngine.
   */
  private reflectionsFragment(ctx: SystemPromptContext): SystemPromptFragment {
    const text = ctx.reflections?.trim() ?? '';
    if (text.length === 0) {
      return { name: 'reflections', text: '' };
    }
    return { name: 'reflections', text: text };
  }

  /**
   * Fragment 1: Identity (stable tier — byte-stable for prefix caching).
   *
   * The identity fragment varies by agent role. Each role has a
   * specialized mission statement so the model knows exactly what its
   * job is within the swarm. The role label and mission are both
   * injected here; the 11-agent pipeline overview is kept as a
   * shared second line so the model understands the handoff context.
   *
   * Note: `taskPrompt` is intentionally NOT injected here. The task changes
   * every turn, so including it in the stable identity fragment would
   * bust the prefix cache. The task is already in the latest user
   * message — no need to repeat it in the system prompt.
   * @param ctx
   */
  private identityFragment(ctx: SystemPromptContext): SystemPromptFragment {
    const roleLabel = AGENT_ROLE_LABELS[ctx.role];
    const mission = ROLE_MISSIONS[ctx.role] ?? ROLE_MISSIONS['orchestrator']!;
    return {
      name: 'identity',
      text: [
        `You are GOLI-CLI, an enterprise AI coding agent acting as the **${roleLabel}**.`,
        `You are part of an 11-agent swarm (Scout → Researcher → Architect → Planner → Implementer → Debugger → QA/Tester → Security Auditor → Reviewer → Orchestrator → Documenter).`,
        mission,
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
      // Validate the fallback — if 'build' doesn't exist in
      // MODE_PROMPTS (e.g., config refactored), use a safe
      // default string instead of `undefined`.
      text: MODE_PROMPTS[mode] ?? MODE_PROMPTS['build'] ?? 'You are a helpful coding assistant.',
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
