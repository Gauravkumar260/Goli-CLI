import fs from 'fs';
import path from 'path';

const testsDir = 'tests/unit';
const testFiles = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.ts') || f.endsWith('.test.tsx'));

let movedToVscode = 0, movedToCli = 0;

for (const f of testFiles) {
  const srcPath = path.join(testsDir, f);
  const content = fs.readFileSync(srcPath, 'utf8');

  // Rewrite any old import paths that still point to packages/cli  
  let newContent = content
    // packages/cli -> apps/cli
    .replace(/from '(\.\.\/)+packages\/cli\/(.*?)'/g, "from '../../apps/cli/$2'")
    .replace(/from '\.\.\/\.\.\/packages\/cli\/(.*?)'/g, "from '../../apps/cli/$1'")
    // packages/core -> via new packages
    .replace(/from '(\.\.\/)+packages\/core\/src\/agent\/(.*?)'/g, "from '@goli-cli/agent-core'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/tools\/(.*?)'/g, "from '@goli-cli/tool-system'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/config\/(.*?)'/g, "from '@goli-cli/config'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/memory\/(.*?)'/g, "from '@goli-cli/memory-engine'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/context\/(.*?)'/g, "from '@goli-cli/context-engine'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/observability\/(.*?)'/g, "from '@goli-cli/observability'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/providers\/(.*?)'/g, "from '@goli-cli/llm-providers'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/orchestration\/(.*?)'/g, "from '@goli-cli/orchestration'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/approval\/(.*?)'/g, "from '@goli-cli/approval'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/i18n\/(.*?)'/g, "from '@goli-cli/i18n'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/plugins\/(.*?)'/g, "from '@goli-cli/plugins'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/evals\/(.*?)'/g, "from '@goli-cli/evals'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/utils\/(.*?)'/g, "from '@goli-cli/shared'")
    .replace(/from '(\.\.\/)+packages\/core\/src\/sandbox\/(.*?)'/g, "from '@goli-cli/sandbox'");

  if (content.includes('vscode-ext') || f === 'vscode-ext-isolation.test.ts') {
    const destPath = `apps/vscode-ext/__tests__/${f}`;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, newContent);
    fs.unlinkSync(srcPath);
    movedToVscode++;
    console.log(`Moved to vscode-ext: ${f}`);
  } else {
    const destPath = `apps/cli/__tests__/${f}`;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, newContent);
    fs.unlinkSync(srcPath);
    movedToCli++;
  }
}

console.log(`\nDone! ${movedToCli} tests -> apps/cli/__tests__, ${movedToVscode} tests -> apps/vscode-ext/__tests__`);

// Clean up remaining misc files
const misc = ['docs-expansion.test.ts', 'lint-enforcement.test.ts', 'perf-baseline.test.ts'];
for (const f of misc) {
  const p = path.join(testsDir, f);
  if (fs.existsSync(p)) {
    const dest = `apps/cli/__tests__/${f}`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(p, dest);
    console.log(`Moved misc: ${f}`);
  }
}
