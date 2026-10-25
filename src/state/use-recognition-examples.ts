import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BASELINE_VERSION, MAX_EXAMPLES, MAX_TRAINING_EXAMPLES, captureSaveIssue, emptyDataset, evaluateExamples, exampleLabel, personalVariantKey, personalVariants, trainPersonalRanker, usableCapture, validDataset,
  type BenchmarkReport, type ExampleDataset, type PersonalRanker, type RecognitionCapture, type RecognitionExample } from '@/recognition/recognition-examples';

const DATA_FILE = 'signbridge-examples-v1.json';
const uniqueId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const yieldWork = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
type Request = { token: string; label: string | null; signer: string; session: string; split: 'train' | 'test'; activation: object; variantId?: string };

/** Explicit local collection only. Normal camera use never saves landmarks. */
export function useRecognitionExamples(open: boolean, active: boolean, sessionToken: number) {
  const activation = useMemo(() => ({ active, sessionToken }), [active, sessionToken]);
  const [dataset, setDataset] = useState<ExampleDataset>(emptyDataset);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState('');
  const [signer, setSigner] = useState('me');
  const [split, setSplit] = useState<'train' | 'test'>('train');
  const [session, setSession] = useState(uniqueId);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [storedRequest, setRequest] = useState<Request | null>(null);
  const request = active && storedRequest?.activation === activation ? storedRequest : null;
  const requestRef = useRef<Request | null>(null);
  const [pending, setPending] = useState<RecognitionExample | null>(null);
  const [saveError, setSaveError] = useState('');
  const [ranker, setRanker] = useState<PersonalRanker | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('Examples stay on this device. No video is saved.');
  const cancel = useCallback(() => { requestRef.current = null; setRequest(null); }, []);
  useLayoutEffect(() => {
    if (!active || requestRef.current?.activation !== activation) requestRef.current = null;
    return () => { requestRef.current = null; };
  }, [active, activation]);
  useEffect(() => {
    if (!open || loaded) return;
    let current = true;
    void (async () => {
      try {
        const file = new File(Paths.document, DATA_FILE);
        if (file.exists) {
          if (file.size > 20_000_000) throw new Error('Saved examples exceed the size limit.');
          const saved: unknown = JSON.parse(await file.text());
          if (!validDataset(saved)) throw new Error('Saved examples have an incompatible format. The file was kept. Delete all to start a new collection.');
          if (current) { setDataset(saved); if (saved.profile) setSigner(saved.profile.signer); }
          if (saved.profile) {
            try {
              const restored = await trainPersonalRanker(saved, saved.profile.signer, yieldWork);
              if (current) { setRanker(restored); setEnabled(saved.profile.enabled); }
            } catch {
              if (current) setNotice('Examples loaded. Record clearer examples and learn again before enabling personal signs.');
            }
          }
        }
        if (current) setLoaded(true);
      } catch (error) { if (current) setNotice(error instanceof Error ? error.message : 'Could not load saved examples.'); }
    })();
    return () => { current = false; };
  }, [open, loaded]);

  const perform = async (action: () => Promise<void>, onError?: (message: string) => void) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await yieldWork(); await action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'The operation could not finish.';
      setNotice(message); onError?.(message);
    }
    finally { busyRef.current = false; setBusy(false); }
  };
  const writeDataset = async (next: ExampleDataset) => {
    if (!validDataset(next)) throw new Error('The examples could not be validated. Nothing was overwritten.');
    const temporary = new File(Paths.document, `${DATA_FILE}.tmp`);
    temporary.create({ overwrite: true });
    await temporary.write(JSON.stringify(next));
    await temporary.move(new File(Paths.document, DATA_FILE), { overwrite: true });
    setDataset(next);
  };
  const persist = async (next: ExampleDataset) => {
    // Editing examples invalidates the previously calibrated personal profile.
    await writeDataset({ version: next.version, examples: next.examples });
    setRanker(null); setEnabled(false); setReport(null);
  };
  const arm = () => {
    if (!active || !loaded || busyRef.current) return;
    const expected = exampleLabel(label);
    const unknown = label.trim().toUpperCase() === 'UNKNOWN';
    if ((!expected && !unknown) || (unknown && split === 'train')) { setNotice('Enter a word or short phrase (up to 40 characters). UNKNOWN is reserved for testing unsupported gestures.'); return; }
    if (!signer.trim() || signer.trim().length > 60) { setNotice('Enter a short signer nickname.'); return; }
    if (dataset.examples.length >= MAX_EXAMPLES) { setNotice('The 120-example limit is reached. Export and remove examples first.'); return; }
    if (variantId) {
      const saved = personalVariants(dataset, signer.trim());
      if (saved.length >= MAX_TRAINING_EXAMPLES / 3 && !saved.some((v) => v.id === personalVariantKey(expected!, variantId))) {
        setNotice('Eight gesture versions are saved. Remove a saved version before recording another.'); return;
      }
    }
    const next = { token: uniqueId(), label: expected, signer: signer.trim(), session, split, activation, ...(variantId ? { variantId } : {}) };
    requestRef.current = next; setRequest(next); setPending(null); setSaveError('');
    setNotice(`Recording ${expected ?? 'UNKNOWN'}. Sign once, then lower your hands or tap Finish sign.`);
  };
  const onCapture = useCallback((token: string, capture: RecognitionCapture) => {
    const current = requestRef.current;
    if (!current || current.token !== token) return;
    setPending({ ...capture, id: token, label: current.label, signer: current.signer, session: current.session, split: current.split,
      createdAt: new Date().toISOString(), baselineVersion: BASELINE_VERSION, ...(current.variantId ? { variantId: current.variantId } : {}) });
    requestRef.current = null; setRequest(null);
    setSaveError('');
    setNotice(`Gesture captured. Save to associate this recording with ${current.label ?? 'UNKNOWN'}.`);
  }, []);
  const learning = useMemo(() => ({ captureToken: request?.token ?? null, ranker: enabled ? ranker : null, onCapture }), [request, enabled, ranker, onCapture]);
  const variantLabel = exampleLabel(label);
  const variantCount = variantId ? dataset.examples.filter((e) => e.variantId === variantId && e.split === 'train' && e.signer === signer.trim()
    && e.label === variantLabel && usableCapture(e)).length : 0;
  const savedVariants = useMemo(() => personalVariants(dataset, signer.trim()), [dataset, signer]);

  const enableSaved = async (expectedVariant?: string) => {
    const trained = await trainPersonalRanker(dataset, signer.trim(), yieldWork);
    if (expectedVariant && !trained.calibration.some((c) => c.variant === expectedVariant)) throw new Error('Save three usable examples for this version first.');
    await writeDataset({ ...dataset, profile: { signer: trained.signer, enabled: true } });
    setRanker(trained); setEnabled(true); setReport(null);
    setNotice('Saved versions enabled. Try a fresh sign and review the suggestions.');
  };

  return { dataset, loaded, label, setLabel, signer, setSigner, split, session, request, pending, ranker, enabled, report, busy, notice, learning, arm, cancel,
    variantLabel, variantCount, variantId, savedVariants, saveError,
    beginVariant: (word?: string) => {
      if (busyRef.current || requestRef.current || pending) { setNotice('Save or discard the current example first.'); return false; }
      const canonical = word === undefined ? '' : exampleLabel(word);
      if (canonical === null) { setNotice('Enter a word or short phrase, up to 40 characters.'); return false; }
      setLabel(canonical); setVariantId(word === undefined ? null : uniqueId()); setSplit('train'); setSession(uniqueId());
      setSaveError('');
      setNotice(word === undefined ? 'Choose a Dictionary word or add a new word.' : `Record three examples of your version of ${canonical}. Earlier versions are kept.`); return true;
    },
    changeSplit: (next: 'train' | 'test') => { cancel(); setPending(null); setVariantId(null); setSplit(next); setSession(uniqueId()); },
    newSession: () => { cancel(); setPending(null); setVariantId(null); setSession(uniqueId()); setNotice('New capture session. Keep test recordings separate from training.'); },
    discard: () => { cancel(); setPending(null); setSaveError(''); setNotice('Capture discarded.'); },
    save: () => perform(async () => {
      if (!pending) return;
      setSaveError('');
      const issue = pending.split === 'train' ? captureSaveIssue(pending) : null;
      if (issue) throw new Error(issue);
      await persist({ ...dataset, examples: [...dataset.examples, pending] }); setPending(null); setNotice('Example saved locally.');
    }, (message) => setSaveError(`Could not save this example. ${message}`)),
    removeLast: () => perform(async () => { await persist({ ...dataset, examples: dataset.examples.slice(0, -1) }); setNotice('Last saved example removed.'); }),
    forgetVariant: (id: string) => perform(async () => {
      const version = savedVariants.find((v) => v.id === id); if (!version) return;
      const ids = new Set(version.examples.map((e) => e.id));
      await persist({ ...dataset, examples: dataset.examples.filter((e) => e.variantId && e.variantId === version.examples[0].variantId
        ? e.label !== version.label || e.signer !== signer.trim() : !ids.has(e.id)) });
      setNotice('Version removed. Use saved versions to enable your remaining examples.');
    }),
    clear: () => perform(async () => {
      cancel(); setPending(null); setSaveError('');
      const file = new File(Paths.document, DATA_FILE); if (file.exists) file.delete();
      const temporary = new File(Paths.document, `${DATA_FILE}.tmp`); if (temporary.exists) temporary.delete();
      setDataset(emptyDataset()); setLoaded(true); setRanker(null); setEnabled(false); setReport(null); setNotice('All local examples deleted.');
    }),
    train: () => perform(async () => {
      const trained = await trainPersonalRanker(dataset, signer.trim(), yieldWork);
      await writeDataset({ ...dataset, profile: { signer: trained.signer, enabled: false } });
      setRanker(trained); setEnabled(false); setReport(null);
      setNotice(`Learned ${trained.calibration.length} gesture versions. Run a separate test before enabling. This does not retrain the full model.`);
    }),
    activateVariant: () => perform(async () => {
      if (!variantLabel || !variantId || variantCount < 3) throw new Error('Save three examples of this gesture version first.');
      await enableSaved(personalVariantKey(variantLabel, variantId));
    }),
    activateSavedVariants: () => perform(async () => { await enableSaved(); }),
    toggle: () => perform(async () => {
      if (!ranker) return;
      await writeDataset({ ...dataset, profile: { signer: ranker.signer, enabled: !enabled } });
      setEnabled(!enabled);
    }),
    evaluate: () => perform(async () => { setReport(await evaluateExamples(dataset, ranker, yieldWork)); setNotice('Test results use held-out examples only. Small personal tests do not establish general accuracy.'); }),
    export: () => perform(async () => {
      const directory = await Directory.pickDirectoryAsync();
      const file = directory.createFile(`signbridge-examples-${uniqueId()}.json`, 'application/json');
      await file.write(JSON.stringify({ ...dataset, report })); setNotice('Examples exported to your selected folder.');
    }),
  };
}
