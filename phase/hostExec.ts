// src/sandbox/hostExec.ts
//
// Runs a command in the WSL2 host environment (outside the Docker container).
// Used exclusively by DockerSandbox.applyDiffToHost() — i.e., only when the
// user has already approved the diff and explicitly triggered `apex commit`.
//
// Not used during provision() — that uses dockerode's container.putArchive() directly.

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function execHost(
  command: string,
  opts: { timeoutMs?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, {
    timeout: opts.timeoutMs ?? 10_000,
    cwd:     opts.cwd,
    env:     { ...process.env },   // explicit — never inherit blindly
  })
}
