/**
 * Session storage layer (Prisma + SQLite).
 *
 * Append-only transcript via Message[]. Provides CRUD + a few convenience
 * helpers used by the API routes and the agent runtime.
 */
import type { PermissionMode } from '@/lib/types';

import { db } from '@/lib/db';

/**
 *
 */
export interface SessionWithMessages {
  session: {
    id: string;
    title: string;
    permissionMode: string;
    systemPreamble: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  messages: Array<{
    id: string;
    sequence: number;
    role: string;
    content: string;
    toolName: string | null;
    toolCallId: string | null;
    isError: boolean;
    createdAt: Date;
  }>;
}

function deriveTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New session';
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

/**
 *
 */
export async function listSessions(limit = 50) {
  const sessions = await db.session.findMany({
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: {
      messages: {
        orderBy: { sequence: 'desc' },
        take: 1,
        select: { content: true, role: true },
      },
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    permissionMode: s.permissionMode as PermissionMode,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    lastSnippet:
      s.messages[0]?.role === 'user'
        ? s.messages[0]?.content?.slice(0, 120)
        : undefined,
  }));
}

/**
 *
 */
export async function getSessionWithMessages(
  id: string,
): Promise<SessionWithMessages | null> {
  const session = await db.session.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { sequence: 'asc' } },
    },
  });
  if (!session) return null;
  return {
    session: {
      id: session.id,
      title: session.title,
      permissionMode: session.permissionMode,
      systemPreamble: session.systemPreamble,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    messages: session.messages.map((m) => ({
      id: m.id,
      sequence: m.sequence,
      role: m.role,
      content: m.content,
      toolName: m.toolName,
      toolCallId: m.toolCallId,
      isError: m.isError,
      createdAt: m.createdAt,
    })),
  };
}

/**
 *
 */
export async function upsertSession(input: {
  id: string;
  permissionMode?: PermissionMode;
  systemPreamble?: string | null;
  title?: string;
}) {
  return db.session.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      title: input.title ?? 'New session',
      permissionMode: input.permissionMode ?? 'ask',
      systemPreamble: input.systemPreamble ?? null,
    },
    update: {
      ...(input.title ? { title: input.title } : {}),
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      ...(input.systemPreamble !== undefined
        ? { systemPreamble: input.systemPreamble }
        : {}),
    },
  });
}

/**
 *
 */
export async function renameSession(id: string, title: string) {
  try {
    return await db.session.update({
      where: { id },
      data: { title },
    });
  } catch {
    return null;
  }
}

/**
 *
 */
export async function deleteSession(id: string) {
  await db.session.delete({ where: { id } });
}

/**
 *
 */
export interface AppendMessageInput {
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string | null;
  toolCallId?: string | null;
  isError?: boolean;
}

/** Append a message and bump the session's updatedAt (and title if first user msg). */
export async function appendMessage(input: AppendMessageInput) {
  const last = await db.message.findFirst({
    where: { sessionId: input.sessionId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });
  const nextSeq = (last?.sequence ?? -1) + 1;

  const [message] = await db.$transaction([
    db.message.create({
      data: {
        sessionId: input.sessionId,
        sequence: nextSeq,
        role: input.role,
        content: input.content,
        toolName: input.toolName ?? null,
        toolCallId: input.toolCallId ?? null,
        isError: input.isError ?? false,
      },
    }),
    db.session.update({
      where: { id: input.sessionId },
      data: {
        updatedAt: new Date(),
        // If this is the very first user message, derive a title.
        ...(input.role === 'user' && nextSeq === 0
          ? { title: deriveTitle(input.content) }
          : {}),
      },
    }),
  ]);
  return message;
}

/** Load the transcript (role/content pairs) for an agent run, as plain chat messages. */
export async function loadTranscriptForAgent(sessionId: string) {
  const rows = await db.message.findMany({
    where: { sessionId },
    orderBy: { sequence: 'asc' },
    select: { role: true, content: true },
  });
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
    }));
}

// Re-export the client-safe newSessionId helper for API routes that need it.
/**
 *
 */
export { newSessionId } from '@/lib/id';
