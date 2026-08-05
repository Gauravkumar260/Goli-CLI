'use client';

import { motion } from 'framer-motion';
import {
  Sparkles,
  FileCode2,
  Bug,
  BookOpen,
  PenLine,
  Search,
  GitBranch,
} from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const EXAMPLES: Array<{
  icon: React.ReactNode;
  label: string;
  prompt: string;
}> = [
  {
    icon: <Bug className="size-3.5" />,
    label: 'Debug a stack trace',
    prompt:
      "Help me debug this stack trace: TypeError: Cannot read properties of undefined (reading 'map') at UserList (UserList.tsx:23)",
  },
  {
    icon: <FileCode2 className="size-3.5" />,
    label: 'Explain a code snippet',
    prompt:
      'Explain what `useEffect(() => {}, [])` does in React and when to avoid it.',
  },
  {
    icon: <PenLine className="size-3.5" />,
    label: 'Write a new module',
    prompt:
      'Create a new file src/lib/rate-limit.ts that implements a token-bucket rate limiter with TypeScript.',
  },
  {
    icon: <Search className="size-3.5" />,
    label: 'Search the workspace',
    prompt: 'Find every place that calls `fetch` directly and list the URLs used.',
  },
  {
    icon: <BookOpen className="size-3.5" />,
    label: 'Summarize docs',
    prompt: 'Read README.md and summarize the project in 5 bullet points.',
  },
  {
    icon: <GitBranch className="size-3.5" />,
    label: 'Refactor a function',
    prompt:
      'Refactor the `parseConfig` function to use the Result type instead of throwing.',
  },
];

interface EmptyStateProps {
  onPick: (prompt: string) => void;
}

/**
 *
 */
export function EmptyState({ onPick }: EmptyStateProps) {
  return (
    <div className="relative flex w-full flex-col items-center justify-center px-4 py-12 text-center">
      {/* Backdrop grid */}
      <div
        className="goli-grid-bg pointer-events-none absolute inset-0 -z-10 opacity-50"
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/80 to-primary text-primary-foreground shadow-lg"
      >
        <Sparkles className="size-6" aria-hidden />
        <div className="absolute -inset-1 -z-10 rounded-2xl bg-primary/30 blur-xl" aria-hidden />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        What should we build today?
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="mt-2 max-w-md text-pretty text-sm text-muted-foreground"
      >
        Goli is your agentic coding partner. Ask, plan, edit, and ship — all
        from one console. Try an example below or type your own prompt.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => onPick(ex.prompt)}
            className={cn(
              'group flex items-start gap-3 rounded-xl border border-border bg-card/60 p-3 text-left transition',
              'hover:border-primary/40 hover:bg-accent/60 hover:shadow-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition group-hover:text-primary">
              {ex.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{ex.label}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {ex.prompt}
              </span>
            </span>
          </button>
        ))}
      </motion.div>
    </div>
  );
}
