import fs from 'fs';
import path from 'path';

function move(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    console.log(`Moved ${src} to ${dest}`);
  }
}

// 1. Create packages/shared
fs.mkdirSync('packages/shared/src/utils', { recursive: true });
fs.mkdirSync('packages/shared/src/types', { recursive: true });
fs.mkdirSync('packages/shared/__tests__', { recursive: true });

// package.json
fs.writeFileSync('packages/shared/package.json', JSON.stringify({
  name: "@goli-cli/shared",
  version: "0.1.0",
  type: "module",
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./utils/*": {
      "types": "./dist/utils/*.d.ts",
      "import": "./dist/utils/*.js"
    }
  },
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
fs.writeFileSync('packages/shared/tsconfig.json', JSON.stringify({
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
const utilsFiles = fs.readdirSync('packages/core/src/utils');
for (const file of utilsFiles) {
  move(`packages/core/src/utils/${file}`, `packages/shared/src/utils/${file}`);
}
if (fs.existsSync('packages/core/src/types')) {
  const typesFiles = fs.readdirSync('packages/core/src/types');
  for (const file of typesFiles) {
    move(`packages/core/src/types/${file}`, `packages/shared/src/types/${file}`);
  }
}
move('packages/core/src/types.ts', 'packages/shared/src/types.ts');

// Create index.ts
fs.writeFileSync('packages/shared/src/index.ts', `
export * from './types.js';
export * from './utils/constants.js';
export * from './utils/errors.js';
export * from './utils/json-utils.js';
export * from './utils/logger.js';
`);

// 3. Move tests
const testsToMove = [
  'errors.test.ts',
  'json-repair.test.ts',
  'logger.test.ts'
];
for (const t of testsToMove) {
  if (fs.existsSync(`tests/unit/${t}`)) {
    move(`tests/unit/${t}`, `packages/shared/__tests__/${t}`);
  }
}

// 4. Update core to depend on shared
const corePkgPath = 'packages/core/package.json';
const corePkg = JSON.parse(fs.readFileSync(corePkgPath, 'utf8'));
corePkg.dependencies = corePkg.dependencies || {};
corePkg.dependencies['@goli-cli/shared'] = "*";
fs.writeFileSync(corePkgPath, JSON.stringify(corePkg, null, 2));

// 5. Create a shim in core to avoid breaking everything instantly
fs.mkdirSync('packages/core/src/utils', { recursive: true });
fs.writeFileSync('packages/core/src/utils/logger.ts', "export * from '@goli-cli/shared/utils/logger.js';");
fs.writeFileSync('packages/core/src/utils/errors.ts', "export * from '@goli-cli/shared/utils/errors.js';");
fs.writeFileSync('packages/core/src/utils/constants.ts', "export * from '@goli-cli/shared/utils/constants.js';");
fs.writeFileSync('packages/core/src/utils/json-utils.ts', "export * from '@goli-cli/shared/utils/json-utils.js';");
fs.writeFileSync('packages/core/src/types.ts', "export * from '@goli-cli/shared';");
fs.mkdirSync('packages/core/src/types', { recursive: true });
if (fs.existsSync('packages/shared/src/types/optional-deps.d.ts')) {
  fs.writeFileSync('packages/core/src/types/optional-deps.d.ts', "/// <reference types=\"@goli-cli/shared/types/optional-deps\" />\n");
}

console.log('Shared migration complete.');
