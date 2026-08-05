'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Folder,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Loader2,
  FileText,
  Copy,
  Check,
  PanelRightClose,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface FileBrowserPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsertPath: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: TreeNode[];
}

interface TreeResponse {
  workspaceDir: string;
  tree: TreeNode[];
  truncated?: boolean;
}

/**
 *
 */
export function FileBrowserPanel({
  open,
  onOpenChange,
  onInsertPath,
}: FileBrowserPanelProps) {
  const { data, isLoading, error, refetch, isFetching } = useQuery<TreeResponse>({
    queryKey: ['workspace-files'],
    queryFn: async () => {
      const r = await fetch('/api/workspace/files', {
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error('Failed to load workspace tree');
      return r.json() as Promise<TreeResponse>;
    },
    enabled: open,
    staleTime: 10_000,
    retry: 0,
  });

  return (
    <aside
      className={cn(
        'relative hidden shrink-0 border-l border-border bg-card/40 transition-all duration-200 ease-in-out md:flex',
        open ? 'w-72' : 'w-0',
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          'flex h-full w-72 flex-col overflow-hidden',
          !open && 'pointer-events-none opacity-0',
        )}
      >
        {/* Header */}
        <div className="flex h-12 items-center gap-2 border-b border-border px-3">
          <FileText className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-xs font-semibold">Workspace files</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 w-7 p-0"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh file tree"
          >
            {isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onOpenChange(false)}
            aria-label="Close file browser"
          >
            <PanelRightClose className="size-3.5" />
          </Button>
        </div>

        {/* Tree */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {isLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Loading…
              </div>
            ) : error ? (
              <div className="px-2 py-3 text-[11px] text-muted-foreground">
                Couldn't load workspace.
              </div>
            ) : !data || data.tree.length === 0 ? (
              <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                The workspace is empty.
              </div>
            ) : (
              <Tree
                nodes={data.tree}
                onInsertPath={onInsertPath}
                depth={0}
              />
            )}
            {data?.truncated && (
              <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                Tree truncated at 1000 nodes.
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}

function Tree({
  nodes,
  onInsertPath,
  depth,
}: {
  nodes: TreeNode[];
  onInsertPath: (p: string) => void;
  depth: number;
}) {
  return (
    <ul className="flex flex-col">
      {nodes.map((n) => (
        <TreeRow key={n.path} node={n} onInsertPath={onInsertPath} depth={depth} />
      ))}
    </ul>
  );
}

function TreeRow({
  node,
  onInsertPath,
  depth,
}: {
  node: TreeNode;
  onInsertPath: (p: string) => void;
  depth: number;
}) {
  const [open, setOpen] = React.useState(depth < 1);
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(node.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const handleInsert = (e: React.MouseEvent) => {
    e.stopPropagation();
    onInsertPath(node.path);
  };

  if (node.type === 'dir') {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="group flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] transition hover:bg-accent/60"
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )}
          <Folder
            className={cn(
              'size-3.5 shrink-0',
              open ? 'text-primary' : 'text-muted-foreground',
            )}
          />
          <span className="min-w-0 truncate font-medium text-foreground">
            {node.name}
          </span>
        </button>
        {open && node.children && node.children.length > 0 && (
          <Tree nodes={node.children} onInsertPath={onInsertPath} depth={depth + 1} />
        )}
      </li>
    );
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={handleInsert}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleInsert(e as unknown as React.MouseEvent);
          }
        }}
        className="group flex w-full cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] transition hover:bg-accent/60"
        style={{ paddingLeft: `${depth * 12 + 22}px` }}
        title={node.path}
      >
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-foreground/90">
          {node.name}
        </span>
        {node.size !== undefined && (
          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
            {formatSize(node.size)}
          </span>
        )}
        <button
          type="button"
          className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
          onClick={handleCopy}
          aria-label="Copy path"
          title="Copy path"
        >
          {copied ? (
            <Check className="size-3 text-emerald-500" />
          ) : (
            <Copy className="size-3" />
          )}
        </button>
      </div>
    </li>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// Suppress unused import.
void FileIcon;
