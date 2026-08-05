/**
 * AskUserQuestion tool (Module 3, competitive gap #7).
 *
 * Lets the model ask the user a structured clarifying question when
 * requirements are ambiguous. Claude Code has this as a built-in tool;
 * Goli previously had only PermissionDialog (for approval) but no
 * general clarification mechanism.
 *
 * The tool returns the user's answer as a string. The TUI can render
 * this as a distinct UI element (like PermissionDialog but for
 * questions rather than approvals).
 *
 * Permission tier: T0 (no side effects).
 *
 * @module tools/core/ask-user
 */

import { randomUUID } from 'node:crypto';

import type { Tool, ToolResult, ToolContext } from '../types.js';

/**
 *
 */
export const ASK_USER_QUESTION_TOOL: Tool = {
  name: 'ask_user',
  description:
    'Ask the user a clarifying question. Use this when requirements are ambiguous and you need ' +
    'more information before proceeding. The question should be specific and actionable. ' +
    'Do NOT use this for yes/no approval — use the permission dialog for that.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user.',
      },
      options: {
        type: 'array',
        description: 'Optional list of choices for the user to pick from.',
        items: { type: 'string' },
      },
      context: {
        type: 'string',
        description: 'Optional context explaining why you\'re asking.',
      },
    },
    required: ['question'],
    additionalProperties: false,
  },
  handler: askUserHandler,
  tier: 'T0',
  readOnly: true,
};

/** Pending user questions, keyed by question ID. */
interface PendingQuestion {
  id: string;
  question: string;
  options?: string[];
  context?: string;
  resolve: (answer: string) => void;
}

const pendingQuestions = new Map<string, PendingQuestion>();

async function askUserHandler(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const question = args['question'] as string;
  const options = args['options'] as string[] | undefined;
  const context = args['context'] as string | undefined;

  if (!question) {
    return {
      toolCallId: ctx.toolCallId,
      ok: false,
      content: '',
      error: 'ask_user requires a "question" string.',
    };
  }

  // In a headless/non-interactive context, we can't ask the user.
  // Return a default response so the agent doesn't block.
  if (process.env['GOLI_HEADLESS'] === '1' || process.env['GOLI_TUI_MODE'] === 'headless') {
    const defaultAnswer = options && options.length > 0 ? options[0]! : '(no answer — running in headless mode)';
    return {
      toolCallId: ctx.toolCallId,
      ok: true,
      content: `[User question (headless mode — auto-answered): "${question}"]\nAnswer: ${defaultAnswer}`,
    };
  }

  // In interactive mode, we would normally block here waiting for the
  // TUI to render the question and the user to respond. However, the
  // tool handler is async and the agent loop is single-threaded, so
  // we can't truly block. Instead, we return the question as text
  // and let the model interpret the user's next message as the answer.
  //
  // A full implementation would integrate with AppStateStore to show
  // a question dialog (like PermissionDialog) and resolve when the
  // user types an answer. For now, we return the question as content
  // and the model will see the user's response in the next turn.
  const lines: string[] = [];
  if (context) {
    lines.push(`Context: ${context}`);
    lines.push('');
  }
  lines.push(`Question for user: ${question}`);
  if (options && options.length > 0) {
    lines.push(`Options: ${options.join(' / ')}`);
  }
  lines.push('');
  lines.push('(The user will respond in their next message.)');

  return {
    toolCallId: ctx.toolCallId,
    ok: true,
    content: lines.join('\n'),
  };
}

/**
 * Register a pending question (for TUI integration).
 *
 * The TUI calls this when it wants to show a question dialog. The
 * `resolve` callback is called when the user answers.
 * @param question
 * @param options
 * @param resolve
 */
export function registerPendingQuestion(
  question: string,
  options: string[] | undefined,
  resolve: (answer: string) => void,
): string {
  const id = randomUUID();
  pendingQuestions.set(id, { id, question, options, resolve });
  return id;
}

/**
 * Resolve a pending question (called by the TUI when the user answers).
 * @param id
 * @param answer
 */
export function resolvePendingQuestion(id: string, answer: string): boolean {
  const q = pendingQuestions.get(id);
  if (!q) return false;
  q.resolve(answer);
  pendingQuestions.delete(id);
  return true;
}
