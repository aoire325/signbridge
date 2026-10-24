import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('expo-modules-jsi/package.json');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const sourceRoot = join(dirname(packageJsonPath), 'apple', 'Sources', 'ExpoModulesJSI');

// Expo Modules JSI 58 uses weak-let properties that Swift 6.2 rejects. Weak vars
// retain the same zeroing behavior; nonisolated(unsafe) opts out of Sendable checks.
if (!packageJson.version.startsWith('58.')) {
  throw new Error(
    `Expected expo-modules-jsi 58.x for this compatibility patch, found ${packageJson.version}.`,
  );
}

async function findSwiftFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findSwiftFiles(path);
    return entry.isFile() && path.endsWith('.swift') ? [path] : [];
  }));
  return nested.flat();
}

const files = await findSwiftFiles(sourceRoot);
let patchedDeclarations = 0;
const unsupportedDeclarations = [];

for (const path of files) {
  const source = await readFile(path, 'utf8');
  const updated = source.replace(
    /private weak let runtime: JavaScriptRuntime\?/g,
    () => {
      patchedDeclarations += 1;
      return 'nonisolated(unsafe) weak var runtime: JavaScriptRuntime?';
    },
  );

  if (updated !== source) await writeFile(path, updated);

  if (/\bweak let\b/.test(updated)) unsupportedDeclarations.push(path);
}

if (unsupportedDeclarations.length > 0) {
  throw new Error(
    `Unrecognized weak-let declarations remain in expo-modules-jsi: ${unsupportedDeclarations.join(', ')}`,
  );
}

if (patchedDeclarations > 0) {
  console.log(`Patched ${patchedDeclarations} expo-modules-jsi Swift declarations for Swift 6.2.`);
} else {
  console.log('expo-modules-jsi Swift sources already support this Xcode toolchain.');
} 

