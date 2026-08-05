/**
 * GET /api/sessions/[id]/export — download the session transcript as Markdown.
 */
import { NextResponse } from 'next/server';

import { getSessionWithMessages } from '@/lib/storage/session';

/**
 *
 */
export const dynamic = 'force-dynamic';

/**
 *
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });

  const result = await getSessionWithMessages(id);
  if (!result) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  }

  const lines: string[] = [];
  lines.push(`# ${result.session.title}`);
  lines.push('');
  lines.push(`> Session \`${result.session.id}\``);
  lines.push(`> Created: ${result.session.createdAt.toISOString()}`);
  lines.push(`> Updated: ${result.session.updatedAt.toISOString()}`);
  lines.push(`> Permission mode: ${result.session.permissionMode}`);
  lines.push('');

  for (const m of result.messages) {
    if (m.role === 'user') {
      lines.push(`## You`);
      lines.push('');
      lines.push(m.content);
      lines.push('');
    } else if (m.role === 'assistant') {
      lines.push(`## Goli`);
      lines.push('');
      lines.push(m.content);
      lines.push('');
    } else if (m.role === 'tool') {
      lines.push(`### Tool: ${m.toolName ?? 'unknown'}${m.isError ? ' (error)' : ''}`);
      lines.push('');
      lines.push('```');
      lines.push(m.content);
      lines.push('```');
      lines.push('');
    } else if (m.role === 'system') {
      lines.push(`> _system: ${m.content}_`);
      lines.push('');
    }
  }

  const safeTitle = result.session.title.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  const filename = `${safeTitle || 'session'}.md`;
  const md = lines.join('\n');

  return new NextResponse(md, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
