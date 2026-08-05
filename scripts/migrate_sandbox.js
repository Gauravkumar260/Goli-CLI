import fs from 'fs';
import path from 'path';

function move(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    console.log(`Moved ${src} to ${dest}`);
  }
}

// 1. Create packages/sandbox
fs.mkdirSync('packages/sandbox/src', { recursive: true });
fs.mkdirSync('packages/sandbox/__tests__', { recursive: true });

// package.json
fs.writeFileSync('packages/sandbox/package.json', JSON.stringify({
  name: "@goli-cli/sandbox",
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
    "zod": "^3.23.8"
  },
  devDependencies: {
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}, null, 2));

// tsconfig.json
fs.writeFileSync('packages/sandbox/tsconfig.json', JSON.stringify({
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

// 2. Move src
const sandboxFiles = fs.readdirSync('packages/core/src/sandbox');
for (const file of sandboxFiles) {
  move(`packages/core/src/sandbox/${file}`, `packages/sandbox/src/${file}`);
}

// 3. Recreate core/src/sandbox/index.ts shim
fs.mkdirSync('packages/core/src/sandbox', { recursive: true });
fs.writeFileSync('packages/core/src/sandbox/index.ts', `// Shim for backward compatibility
export * from '@goli-cli/sandbox';

// Approval engine re-exports (temporarily kept here)
export { ApprovalEngine } from '../approval/engine.js';
export type { ActionClassification, ApprovalEngineOptions } from '../approval/engine.js';
export {
  computeBlastRadius,
  DEFAULT_BLAST_RADIUS_CONFIG,
} from '../approval/blast-radius.js';
export type { BlastRadiusConfig, BlastRadiusResult } from '../approval/blast-radius.js';

export {
  EnhancedApprovalEngine,
  DANGEROUS_PATTERNS,
  withSessionContext,
  getSessionContext,
  findDangerousPattern,
} from '../approval/enhanced-approval.js';
export type {
  DangerousPattern,
  ApprovalDecision as EnhancedApprovalDecision,
  ApprovalResult,
  EnhancedApprovalEngineOptions,
} from '../approval/enhanced-approval.js';
`);

// 4. Remove approval exports from sandbox/src/index.ts
let sandboxIndex = fs.readFileSync('packages/sandbox/src/index.ts', 'utf8');
sandboxIndex = sandboxIndex.replace(/\/\/ Approval engine[\s\S]*/, '');
fs.writeFileSync('packages/sandbox/src/index.ts', sandboxIndex);

// 5. Move tests
const testsToMove = [
  'audit-log.test.ts',
  'network-egress.test.ts',
  'path-validation.test.ts',
  'toctou-path-safety.test.ts'
];

for (const t of testsToMove) {
  move(`tests/unit/${t}`, `packages/sandbox/__tests__/${t}`);
  
  // Fix imports in the tests
  let content = fs.readFileSync(`packages/sandbox/__tests__/${t}`, 'utf8');
  content = content.replace(/..\/..\/packages\/core\/src\/sandbox\//g, '../src/');
  content = content.replace(/..\/..\/..\/packages\/core\/src\/sandbox\//g, '../src/'); // just in case
  fs.writeFileSync(`packages/sandbox/__tests__/${t}`, content);
}

// Update core package.json to depend on sandbox
const corePkgPath = 'packages/core/package.json';
const corePkg = JSON.parse(fs.readFileSync(corePkgPath, 'utf8'));
corePkg.dependencies = corePkg.dependencies || {};
corePkg.dependencies['@goli-cli/sandbox'] = "*";
fs.writeFileSync(corePkgPath, JSON.stringify(corePkg, null, 2));

console.log('Sandbox migration complete.');
