// This exercises the Node build guard, not mobile filesystem APIs.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');

jest.mock('node:child_process', () => ({ execFileSync: () => '.git' }));
const { prepareModelAssets } = require('../../scripts/prepare-model-assets.cjs');

let root: string;
const fixture = Buffer.from([8, 0, 0, 0, 84, 70, 76, 51, 0, 0, 0, 0, 0, 0, 0, 0]);
const oid = createHash('sha256').update(fixture).digest('hex');
const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${fixture.length}\n`;
const assetPath = () => path.join(root, 'assets/models/test.tflite');
const cachePath = () => path.join(root, '.git/lfs/objects', oid.slice(0, 2), oid.slice(2, 4), oid);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'signbridge-model-assets-'));
  fs.mkdirSync(path.join(root, 'assets/models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/models/bundled-models.json'), JSON.stringify({
    'test.tflite': { bytes: fixture.length, sha256: oid },
  }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('restores pointer files from verified local LFS data and is idempotent', () => {
  fs.writeFileSync(assetPath(), pointer);
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  fs.writeFileSync(cachePath(), fixture);
  expect(prepareModelAssets(root)).toEqual({ verified: 1, restored: ['test.tflite'] });
  expect(fs.readFileSync(assetPath())).toEqual(fixture);
  expect(prepareModelAssets(root)).toEqual({ verified: 1, restored: [] });
});

it('blocks packaging a pointer when the actual model has not been fetched', () => {
  fs.writeFileSync(assetPath(), pointer);
  expect(() => prepareModelAssets(root)).toThrow(/git lfs pull/i);
  expect(fs.readFileSync(assetPath(), 'utf8')).toBe(pointer);
});

it('rejects corrupt LFS cache content before replacing a pointer', () => {
  fs.writeFileSync(assetPath(), pointer);
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  const corrupt = Buffer.from(fixture); corrupt[15] = 1;
  fs.writeFileSync(cachePath(), corrupt);
  expect(() => prepareModelAssets(root)).toThrow(/checksum failed/i);
  expect(fs.readFileSync(assetPath(), 'utf8')).toBe(pointer);
});

it('blocks HTML, empty and truncated model files', () => {
  for (const bad of [Buffer.from('<html>Error</html>'), Buffer.alloc(0), fixture.subarray(0, 8)]) {
    fs.writeFileSync(assetPath(), bad);
    expect(() => prepareModelAssets(root)).toThrow(/invalid model data/i);
  }
});

it('can verify without repairing or downloading files', () => {
  fs.writeFileSync(assetPath(), pointer);
  expect(() => prepareModelAssets(root, { repair: false })).toThrow(/Git LFS pointer/i);
}); 

