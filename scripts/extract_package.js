import fs from 'fs';
import path from 'path';

const [, , srcDir, pkgName] = process.argv;
const shortName = pkgName.replace('@goli-cli/', '');

function move(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    console.log(`Moved ${src} to ${dest}`);
  }
}

// 1. Create packages
fs.mkdirSync(`packages/${shortName}/src`, { recursive: true });
fs.mkdirSync(`packages/${shortName}/__tests__`, { recursive: true });

// package.json
const pkgJson = {
  name: pkgName,
  version: "0.1.0",
  type: "module",
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  scripts: {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "clean": "rm -rf dist tsconfig.tsbuildinfo"
  },
  dependencies: {
    "zod": "^3.23.8",
    "@goli-cli/shared": "*"
  },
  devDependencies: {
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
};
fs.writeFileSync(`packages/${shortName}/package.json`, JSON.stringify(pkgJson, null, 2));

// tsconfig.json
fs.writeFileSync(`packages/${shortName}/tsconfig.json`, JSON.stringify({
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "tsBuildInfoFile": "./tsconfig.tsbuildinfo"
  },
  "include": ["src/**/*.ts", "__tests__/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}, null, 2));

// 2. Move src recursively
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
moveDir(`packages/core/src/${srcDir}`, `packages/${shortName}/src`);

// 3. Move tests automatically
const testsDir = 'tests/unit';
if (fs.existsSync(testsDir)) {
  const testFiles = fs.readdirSync(testsDir);
  for (const t of testFiles) {
    if (t.endsWith('.test.ts') || t.endsWith('.test.tsx')) {
      const content = fs.readFileSync(path.join(testsDir, t), 'utf8');
      const importRegex = new RegExp(`from '\\.\\.\\/\\.\\.\\/packages\\/core\\/src\\/${srcDir}\\/`, 'g');
      if (importRegex.test(content)) {
        move(path.join(testsDir, t), `packages/${shortName}/__tests__/${t}`);
      }
    }
  }
}

// 4. Update core to depend on this new package
const corePkgPath = 'packages/core/package.json';
const corePkg = JSON.parse(fs.readFileSync(corePkgPath, 'utf8'));
corePkg.dependencies = corePkg.dependencies || {};
corePkg.dependencies[pkgName] = "*";
fs.writeFileSync(corePkgPath, JSON.stringify(corePkg, null, 2));

// 5. Create a shim in core to avoid breaking everything instantly
fs.mkdirSync(`packages/core/src/${srcDir}`, { recursive: true });
fs.writeFileSync(`packages/core/src/${srcDir}/index.ts`, `export * from '${pkgName}';\n`);

// 6. Rewrite imports inside the new package
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
      for (const [dirName, pkgName] of Object.entries(packageMap)) {
        const regex = new RegExp(`from '(\\.\\.\\/)+${dirName}(\\/.*)?\\.js'`, 'g');
        content = content.replace(regex, `from '${pkgName}'`);
      }
      
      // Rewrite internal test imports inside __tests__
      if (full.includes('__tests__')) {
        content = content.replace(new RegExp(`from '\\.\\.\\/\\.\\.\\/packages\\/core\\/src\\/${srcDir}\\/(.*)\\.js'`, 'g'), "from '../src/$1.js'");
        content = content.replace(new RegExp(`from '\\.\\.\\/\\.\\.\\/\\.\\.\\/packages\\/core\\/src\\/${srcDir}\\/(.*)\\.js'`, 'g'), "from '../src/$1.js'");
      }
      
      fs.writeFileSync(full, content);
    }
  }
}

replaceImports(`packages/${shortName}/src`);
replaceImports(`packages/${shortName}/__tests__`);

console.log(`${pkgName} migration complete.`);
