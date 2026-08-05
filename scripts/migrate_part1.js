import fs from 'fs';
import path from 'path';

function move(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    console.log(`Moved ${src} to ${dest}`);
  }
}

// 1. Create apps, services
fs.mkdirSync('apps', { recursive: true });
fs.mkdirSync('services', { recursive: true });
fs.mkdirSync('packages/test-utils/src', { recursive: true });
// package.json for test-utils
fs.writeFileSync('packages/test-utils/package.json', JSON.stringify({
  name: "@goli-cli/test-utils",
  version: "0.1.0",
  private: true,
  type: "module",
  main: "src/index.js",
  types: "src/index.ts"
}, null, 2));

// 2. Move cli, studio, vscode-ext
move('apps/cli', 'apps/cli');
move('packages/studio', 'apps/studio');
move('packages/vscode-ext', 'apps/vscode-ext');

// 3. Move python_ml to services/ml-pipeline
move('python_ml', 'services/ml-pipeline');

// 4. Move bin and completions to apps/cli
move('bin', 'apps/cli/bin');
move('completions', 'apps/cli/completions');

// 5. Move __test_dirname.ts to test-utils
move('__test_dirname.ts', 'packages/test-utils/src/__test_dirname.ts');

// 6. Rename doctor to scripts/doctor.sh
move('doctor', 'scripts/doctor.sh');

// 7. Create .github
fs.mkdirSync('.github/workflows', { recursive: true });

// 8. Delete demo files (cleanup)
if (fs.existsSync('demo-err.txt')) fs.unlinkSync('demo-err.txt');
if (fs.existsSync('demo-output.txt')) fs.unlinkSync('demo-output.txt');

console.log("Migration part 1 complete");
