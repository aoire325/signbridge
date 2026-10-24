const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';

function inspectModel(filePath, expected) {
  const size = fs.statSync(filePath).size;
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(256);
  let count;
  try { count = fs.readSync(fd, header, 0, header.length, 0); }
  finally { fs.closeSync(fd); }
  const bytes = header.subarray(0, count);
  if (bytes.toString('utf8').startsWith(POINTER_PREFIX)) return 'pointer';
  if (size !== expected.bytes || bytes.subarray(4, 8).toString('ascii') !== 'TFL3') return 'invalid';
  return 'model';
}

function prepareModelAssets(projectRoot, { repair = true } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'assets/models/bundled-models.json'), 'utf8'));
  let commonDir;
  const restored = [];
  for (const [name, expected] of Object.entries(manifest)) {
    const modelPath = path.join(projectRoot, 'assets/models', name);
    const state = fs.existsSync(modelPath) ? inspectModel(modelPath, expected) : 'missing';
    if (state === 'model') continue;
    if (!repair || state === 'invalid') {
      throw new Error(`${name}: ${state === 'pointer' ? 'Git LFS pointer, not a TFLite model' : `${state} model data`}. Run git lfs pull, then npm run models:prepare before building.`);
    }
    if (!commonDir) {
      try {
        commonDir = path.resolve(projectRoot, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
      } catch {
        throw new Error(`${name}: model data is missing. Fetch Git LFS assets with git lfs pull, then run npm run models:prepare.`);
      }
    }
    const oid = expected.sha256;
    const cached = path.join(commonDir, 'lfs/objects', oid.slice(0, 2), oid.slice(2, 4), oid);
    if (!fs.existsSync(cached) || inspectModel(cached, expected) !== 'model') {
      throw new Error(`${name}: Git LFS model is not available locally. Run git lfs pull, then npm run models:prepare. A build containing pointer files cannot recognize signs.`);
    }
    // Validate the cached object before replacing a pointer; never alter Git's object store.
    const bytes = fs.readFileSync(cached);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== oid) {
      throw new Error(`${name}: cached model checksum failed. Fetch a valid copy with git lfs pull.`);
    }
    const temporary = `${modelPath}.restoring`;
    try {
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, modelPath);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    restored.push(name);
  }
  return { verified: Object.keys(manifest).length, restored };
}

module.exports = { inspectModel, prepareModelAssets };

if (require.main === module) {
  try {
    const result = prepareModelAssets(path.resolve(__dirname, '..'));
    for (const name of result.restored) console.log(`Restored ${name} from the local Git LFS cache.`);
    console.log(`Verified ${result.verified} bundled TFLite models.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} 

