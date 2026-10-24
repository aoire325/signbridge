const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const processInfo = require('node:process');
const { execFileSync } = require('node:child_process');
const { addTfliteIsolationHook } = require('../../plugins/with-ios-tflite-isolation');

const podfile = `target 'SignBridge' do
  post_install do |installer|
    react_native_post_install(installer)
  end
end
`;

it('installs one post-install hook without replacing React Native integration', () => {
  const patched = addTfliteIsolationHook(podfile);
  expect(patched).toContain('SignBridgeTfliteIsolation.apply(installer)');
  expect(patched).toContain('react_native_post_install(installer)');
  expect(addTfliteIsolationHook(patched)).toBe(patched);
  expect(patched.match(/SignBridgeTfliteIsolation.apply/g)).toHaveLength(1);
});

it('fails explicitly if a future Podfile has no supported post-install hook', () => {
  expect(() => addTfliteIsolationHook("target 'Changed' do\nend")).toThrow(/post_install block was not found/);
});

const nativeTest = processInfo.platform === 'darwin' ? it : it.skip;
nativeTest('keeps internal calls bound to their own runtime after symbol isolation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signbridge-ios-symbols-'));
  try {
    const a = path.join(root, 'runtime-a.c');
    const b = path.join(root, 'runtime-b.c');
    const aObject = path.join(root, 'runtime-a.o');
    const bObject = path.join(root, 'runtime-b.o');
    const symbols = path.join(root, 'internal-symbols.txt');
    const binary = path.join(root, 'isolated-runtimes');
    fs.writeFileSync(a, 'int TfLiteInternalFixture(void) { return 11; }\nint RuntimeA(void) { return TfLiteInternalFixture(); }\n');
    fs.writeFileSync(b, 'int RuntimeA(void);\nint TfLiteInternalFixture(void) { return 22; }\nint main(void) { return RuntimeA() == 11 && TfLiteInternalFixture() == 22 ? 0 : 1; }\n');
    execFileSync('xcrun', ['clang', '-O0', '-c', a, '-o', aObject]);
    execFileSync('xcrun', ['clang', '-O0', '-c', b, '-o', bObject]);
    expect(() => execFileSync('xcrun', ['clang', aObject, bObject, '-o', binary], { stdio: 'pipe' })).toThrow();
    fs.writeFileSync(symbols, '_TfLiteInternalFixture\n');
    execFileSync('xcrun', ['nmedit', '-R', symbols, aObject]);
    execFileSync('xcrun', ['clang', aObject, bObject, '-o', binary]);
    expect(() => execFileSync(binary)).not.toThrow();
    const exports = execFileSync('xcrun', ['nm', '-gjU', aObject], { encoding: 'utf8' });
    expect(exports).toContain('_RuntimeA');
    expect(exports).not.toContain('_TfLiteInternalFixture');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}); 

