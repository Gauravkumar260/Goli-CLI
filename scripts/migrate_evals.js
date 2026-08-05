import fs from 'fs';
import path from 'path';

function move(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    console.log(`Moved ${src} to ${dest}`);
  }
}

// 1. Move core evals to evals/src
const srcDir = 'packages/core/src/evals';
const destDir = 'packages/evals/src';

function moveDir(src, dest) {
  if (!fs.existsSync(src)) return;
  const files = fs.readdirSync(src);
  for (const file of files) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    if (fs.statSync(srcPath).isDirectory()) {
      moveDir(srcPath, destPath);
    } else {
      move(srcPath, destPath);
    }
  }
}
moveDir(srcDir, destDir);

// 2. Add dependencies
const evalsPkgPath = 'packages/evals/package.json';
const evalsPkg = JSON.parse(fs.readFileSync(evalsPkgPath, 'utf8'));
evalsPkg.dependencies = evalsPkg.dependencies || {};
evalsPkg.dependencies['@goli-cli/shared'] = "*";
evalsPkg.dependencies['@goli-cli/agent-core'] = "*";
evalsPkg.dependencies['@goli-cli/tool-system'] = "*";
fs.writeFileSync(evalsPkgPath, JSON.stringify(evalsPkg, null, 2));

// 3. Shim in core
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'index.ts'), `export * from '@goli-cli/evals';\n`);

// 4. Update imports
const packageMap = {
  'config': '@goli-cli/config',
  'observability': '@goli-cli/observability',
  'approval': '@goli-cli/approval',
  'tools': '@goli-cli/tool-system',
  'agent': '@goli-cli/agent-core',
  'memory': '@goli-cli/memory-engine',
  'context': '@goli-cli/context-engine',
  'providers': '@goli-cli/llm-providers',
  'orchestration': '@goli-cli/orchestration',
  'evals': '@goli-cli/evals',
  'i18n': '@goli-cli/i18n',
  'plugins': '@goli-cli/plugins',
  'sandbox': '@goli-cli/sandbox'
};

function replaceImports(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      replaceImports(full);
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      let content = fs.readFileSync(full, 'utf8');
      
      // Generic replacement for shared utils and types
      content = content.replace(/from '(\.\.\/)+utils\/(.*)\.js'/g, "from '@goli-cli/shared/utils/$2.js'");
      content = content.replace(/from '(\.\.\/)+types\.js'/g, "from '@goli-cli/shared'");
      
      // Map other extracted packages
      for (const [dName, pkgName] of Object.entries(packageMap)) {
        const regex = new RegExp(`from '(\\.\\.\\/)+${dName}(\\/.*)?\\.js'`, 'g');
        content = content.replace(regex, `from '${pkgName}'`);
      }
      
      fs.writeFileSync(full, content);
    }
  }
}

replaceImports('packages/evals/src');

console.log('Evals migration complete.');
