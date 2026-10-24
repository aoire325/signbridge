import { Asset } from 'expo-asset';
import { File, FileMode } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { loadTensorflowModel, type TensorflowPlugin } from 'react-native-fast-tflite';
import bundledModels from '../../assets/models/bundled-models.json';

/** Resolve packaged models to files; release inference never falls back to an asset server. */
export async function loadBundledModel(moduleId: number, allowDevelopmentServer = __DEV__) {
  const asset = Asset.fromModule(moduleId);
  if (!allowDevelopmentServer && /^https?:/i.test(asset.uri) && !asset.localUri) {
    throw new Error('The offline model is missing from this build. Install a build with bundled models.');
  }
  if (!asset.localUri) await asset.downloadAsync();
  if (!asset.localUri?.startsWith('file://')) throw new Error('The offline model could not be resolved to a local file.');
  // Read only a small header, even for the 325 MB decoder. Never pass pointer text to JNI.
  const file = new File(asset.localUri);
  const expected = bundledModels[`${asset.name}.tflite` as keyof typeof bundledModels];
  const handle = file.open(FileMode.ReadOnly);
  try {
    const header = await handle.readBytes(64);
    const identifier = String.fromCharCode(...header.subarray(4, 8));
    if (identifier !== 'TFL3' || (expected && file.size !== expected.bytes)) {
      throw new Error('The offline model files in this build are missing or incomplete. Install the updated app with its bundled models.');
    }
  } finally { handle.close(); }
  return loadTensorflowModel({ url: asset.localUri }, []);
}

export function useBundledModel(moduleId: number, enabled = true): TensorflowPlugin {
  const [state, setState] = useState<TensorflowPlugin>({ state: 'loading', model: undefined });
  const [loadedId, setLoadedId] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoadedId(null);
      setState({ state: 'loading', model: undefined });
      if (!enabled) return;
      try {
        const model = await loadBundledModel(moduleId);
        if (alive) { setLoadedId(moduleId); setState({ state: 'loaded', model }); }
      } catch (error) {
        if (alive) setState({ state: 'error', model: undefined, error: error instanceof Error ? error : new Error(String(error)) });
      }
    })();
    return () => { alive = false; };
  }, [moduleId, enabled]);
  return !enabled || (state.state === 'loaded' && loadedId !== moduleId)
    ? { state: 'loading', model: undefined } : state;
} 

