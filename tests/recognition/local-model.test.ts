const mockDownload = jest.fn();
const mockAsset = { name: 'test-model', uri: 'asset:bundled-model', localUri: null as string | null, downloadAsync: mockDownload };
const mockLoad = jest.fn(async (_source: unknown, _delegates: unknown) => ({ inputs: [], run: jest.fn() }));
const mockRead = jest.fn();
const mockClose = jest.fn();
const mockOpen = jest.fn(() => ({ readBytes: mockRead, close: mockClose }));
let mockSize = 16;
jest.mock('expo-asset', () => ({ Asset: { fromModule: () => mockAsset } }));
jest.mock('expo-file-system', () => ({
  File: class { get size() { return mockSize; } open = mockOpen; },
  FileMode: { ReadOnly: 'readOnly' },
}));
jest.mock('react-native-fast-tflite', () => ({ loadTensorflowModel: (source: unknown, delegates: unknown) => mockLoad(source, delegates) }));

import { loadBundledModel } from '../../src/recognition/local-model';

beforeEach(() => {
  mockAsset.name = 'test-model'; mockAsset.uri = 'asset:bundled-model'; mockAsset.localUri = null;
  mockDownload.mockReset(); mockLoad.mockClear();
  mockRead.mockReset(); mockRead.mockResolvedValue(new Uint8Array([8, 0, 0, 0, 84, 70, 76, 51]));
  mockClose.mockClear(); mockOpen.mockClear(); mockSize = 16;
});

describe('offline model asset loading', () => {
  it('resolves a packaged asset to a local file before invoking the native model loader', async () => {
    mockDownload.mockImplementation(async () => { mockAsset.localUri = 'file:///cache/model.tflite'; });
    await loadBundledModel(7, false);
    expect(mockLoad).toHaveBeenCalledWith({ url: 'file:///cache/model.tflite' }, []);
    expect(mockRead).toHaveBeenCalledWith(64);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('refuses network fallback in a release build', async () => {
    mockAsset.uri = 'https://example.invalid/model.tflite';
    await expect(loadBundledModel(7, false)).rejects.toThrow(/missing from this build/i);
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('reuses an already local asset and rejects unresolved remote URIs', async () => {
    mockAsset.localUri = 'file:///bundle/model.tflite';
    await loadBundledModel(7, false);
    expect(mockDownload).not.toHaveBeenCalled();
    mockAsset.localUri = null;
    mockDownload.mockResolvedValue(mockAsset);
    await expect(loadBundledModel(7, false)).rejects.toThrow(/local file/i);
  });

  it('rejects Git LFS pointer text before entering native TFLite code and closes the handle', async () => {
    mockAsset.localUri = 'file:///cache/pointer.tflite';
    mockRead.mockResolvedValue(new Uint8Array(Array.from('version https://git-lfs.github.com/spec/v1').map((c) => c.charCodeAt(0))));
    await expect(loadBundledModel(7, false)).rejects.toThrow(/missing or incomplete/i);
    expect(mockLoad).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('rejects a truncated known model even when its header is intact', async () => {
    mockAsset.localUri = 'file:///cache/truncated.tflite'; mockAsset.name = 'asl_words_1000';
    await expect(loadBundledModel(7, false)).rejects.toThrow(/missing or incomplete/i);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('closes the file handle if header reading fails', async () => {
    mockAsset.localUri = 'file:///cache/model.tflite';
    mockRead.mockRejectedValue(new Error('Read failed'));
    await expect(loadBundledModel(7, false)).rejects.toThrow('Read failed');
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockLoad).not.toHaveBeenCalled();
  });
}); 

