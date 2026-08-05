'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

import { ThemeProvider } from '@/components/console/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Client-side providers shared by the whole app:
 * - next-themes ThemeProvider (class=dark on <html>)
 * - TanStack Query QueryClientProvider (for sessions, workspace)
 * - Radix TooltipProvider (so Tooltips don't need their own provider each use)
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
