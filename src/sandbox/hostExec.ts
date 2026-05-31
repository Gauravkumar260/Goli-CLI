import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * Runs a command in the WSL2 host environment (outside the Docker container).
 * Used exclusively for applying patches and other host-side management.
 */
export async function execHost(
  command: string,
  opts: { timeoutMs?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, {
    timeout: opts.timeoutMs ?? 30_000,
    cwd:     opts.cwd,
    env:     { ...process.env },
  })
}
