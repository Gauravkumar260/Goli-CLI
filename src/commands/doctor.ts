import { execHost } from "../sandbox/hostExec";
import * as os from "os";

export async function runDoctor(): Promise<void> {
  console.log('\n🛡️  Goli-CLI System Health Check');
  console.log('──────────────────────────────────────────────────────────');

  const isWindows = os.platform() === 'win32';
  const dockerPrefix = isWindows ? 'wsl docker' : 'docker';

  const checks: Array<{ name: string; check: () => Promise<boolean>; hint: string }> = [
    {
      name: 'Bun Runtime',
      check: async () => {
          try {
              const { stdout } = await execHost('bun --version');
              return stdout.length > 0;
          } catch { return false; }
      },
      hint: 'Install Bun: curl -fsSL https://bun.sh/install | bash'
    },
    {
      name: 'Docker Daemon',
      check: async () => {
          try {
              const { stdout } = await execHost(`${dockerPrefix} info`);
              return stdout.includes('ID:');
          } catch { return false; }
      },
      hint: isWindows ? 'Ensure Docker Desktop is running with WSL2 integration enabled.' : 'Docker Engine must be running.'
    },
    {
      name: 'Docker Access',
      check: async () => {
          try {
              const { stdout } = await execHost(`${dockerPrefix} run --rm hello-world`);
              return stdout.includes('Hello from Docker!');
          } catch { return false; }
      },
      hint: 'Ensure your user has permissions to run Docker.'
    },
    {
      name: 'WSL2 Kernel (>= 5.15)',
      check: async () => {
          try {
              const { stdout } = await execHost('wsl uname -r');
              const match = stdout.match(/^(\d+)\.(\d+)/);
              if (!match || !match[1] || !match[2]) return false;
              const major = parseInt(match[1]);
              const minor = parseInt(match[2]);
              return major > 5 || (major === 5 && minor >= 15);
          } catch {
              return !isWindows; // Skip if not on Windows
          }
      },
      hint: 'Update WSL: wsl --update'
    },
    {
      name: 'Goli-CLI Sandbox Image',
      check: async () => {
          try {
              const { stdout } = await execHost(`${dockerPrefix} image inspect goli_cli-sandbox:v1`);
              return stdout.includes('Id": "sha256:');
          } catch { return false; }
      },
      hint: 'Build the sandbox image: bun run build-sandbox (or equivalent build command)'
    },
    {
      name: 'API Configuration',
      check: async () => {
          return !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OLLAMA_API_KEY);
      },
      hint: 'Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_API_KEY in your .env'
    }
  ];

  let allPassed = true;
  for (const { name, check, hint } of checks) {
    const passed = await check().catch(() => false);
    const icon = passed ? '✅' : '❌';
    const color = passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`  ${color}${icon}\x1b[0m  ${name}`);
    if (!passed) {
      console.log(`       └─ 💡 Hint: ${hint}`);
      allPassed = false;
    }
  }

  console.log('──────────────────────────────────────────────────────────');
  if (allPassed) {
    console.log('✨ SUCCESS: Goli-CLI is fully operational.\n');
  } else {
    console.error('⚠️  ISSUES FOUND: Please resolve the hints above.\n');
    process.exit(1);
  }
}
