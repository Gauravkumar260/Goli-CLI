import os from 'os';

export function getMaxParallel(): number {
  const totalMem = os.totalmem();
  const cpuCount = os.cpus().length; // logical CPUs

  if (totalMem >= 32 * 1024 ** 3) return 3;
  if (totalMem >= 16 * 1024 ** 3 && cpuCount >= 8) return 2;
  if (totalMem >= 16 * 1024 ** 3 && cpuCount >= 4) {
    // 16GB, 4 threads (current machine): 1 if Ollama running; 2 if API-only
    return process.env.USE_LOCAL_LLM === 'true' ? 1 : 2;
  }
  return 1;
}

export class TeamRunner {
  // Logic for parallel agent execution
}
