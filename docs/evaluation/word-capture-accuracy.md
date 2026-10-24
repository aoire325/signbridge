# Word capture accuracy check

The weights are unchanged. The main defect was dropping body observations before the first detected hand and after the last detected hand. Citizen was trained on complete isolated-sign videos; this trimming changed both temporal positions and clip-level shoulder normalization. Sampling only every 80 ms compounded the loss.

## Result

Twelve previously inspected examples were used to diagnose the defect. Full-clip replay had 8/12 correct Citizen top classes at source rate versus 1/12 with the former capture at an 80 ms minimum interval. The corrected boundaries recovered 7/12 at that slower interval and 8/12 at source rate. Those twelve examples are not independent validation.

After implementing 600 ms of body lead-in, the existing 550 ms hands-out ending, and denser sampling, a **separate 48-gloss check** produced:

| Capture | Citizen top-1 correct | Correct word among up to three suggestions |
| --- | ---: | ---: |
| Previous trimming, minimum 80 ms interval | 19/48 (39.6%) | 25/48 |
| Preserved context, minimum 80 ms interval | 31/48 (64.6%) | 37/48 |
| Preserved context, minimum 33 ms interval | 33/48 (68.8%) | 40/48 (83.3%) |

The suggestion policy is the same in all three rows: Citizen alternatives are preferred; WLASL can contribute a word outside Citizen's vocabulary. The raw Citizen top-1 metric uses the model's highest-logit class, merging numeric variant suffixes for correctness. Suggestion recall means a correct choice was available, **not** that the app automatically transcribed it correctly. Every expanded suggestion still requires confirmation.

The WLASL-2000 adapter got 2/31 in-vocabulary examples correct in all three conditions. WLASL-1000 got 2/14 with old trimming and 1/14 with retained context. The legacy 1,000-word mode therefore keeps its prior trimming behavior; it is no longer the default. This small ASL Citizen sample favors the Citizen model's data domain and does not establish rankings on WLASL footage or real phone captures.

## What was checked

- Pinned public `SorensenAI/asl-citizen-poses` revision `06068a7ce431c3d1482aea838e8d918ba1eb5853`; membership verified against the original Microsoft test split.
- Deterministic selection from the first 1,000 entries of `batch_001`, one example per gloss, preferring the script's common-label set. The diagnostic 12 and check 48 use offsets 0 and 12, so their glosses do not overlap.
- Real app TypeScript packing, segmentation, normalization and suggestion functions; local bundled TFLite weights. The evaluated model SHA and per-example source hashes/results are in `word-capture-accuracy.json`.
- Replay ends at the first automatic boundary, or explicitly finishes at the original file end. It does not synthesize idle video after the source clip ends.
- The 33 ms condition is a sampling allowance, **not a measured 30 fps phone result**. Serial native processing still drops excess frames on slower devices.
- A separate synthetic geometry regression verifies that a centered portrait crop maps back to the same 4:3 XY geometry, including missing-hand sentinels. Landscape reference input remains unchanged. The 48-example table uses landscape extracted poses; it does not measure this portrait adaptation or new MediaPipe detections.

This is a small convenience sample from known vocabulary. It does not estimate unknown-gesture false positives, demographic or signer generalization, real camera error rates, or sentence translation quality. The 15/48 remaining first-choice errors prevent claiming maximum or production-grade accuracy. No thresholds or weights were fitted to the separate 48 examples.

## Reproduce locally

Use a developer Python environment with `requests`, `numpy`, and `pose-format==0.13.0` to fetch metadata and poses. The original conversion environment has TensorFlow for inference. No datasets or participant frames belong in the app bundle.

```bash
python scripts/fetch-citizen-metadata.py --output /tmp/signbridge-accuracy-metadata --extract
python scripts/prepare-citizen-evaluation.py --test-csv /tmp/signbridge-accuracy-metadata/test.csv --output /tmp/signbridge-accuracy-check --count 48 --offset 12

# Set SIGNBRIDGE_EVAL_PYTHON to a Python interpreter with TensorFlow installed.
node scripts/evaluate-expanded-words.cjs /tmp/signbridge-accuracy-check --single-view --legacy-trim --interval-ms 80
cp /tmp/signbridge-accuracy-check/report.json /tmp/signbridge-accuracy-check/before.json
node scripts/evaluate-expanded-words.cjs /tmp/signbridge-accuracy-check --single-view --interval-ms 80
cp /tmp/signbridge-accuracy-check/report.json /tmp/signbridge-accuracy-check/context-slow.json
node scripts/evaluate-expanded-words.cjs /tmp/signbridge-accuracy-check --single-view --interval-ms 33
cp /tmp/signbridge-accuracy-check/report.json /tmp/signbridge-accuracy-check/context-fast.json
```

The metadata downloader refuses large/full-archive responses and extracts only metadata. The pose downloader stores public research data under `/tmp`; remove it after local evaluation. No camera footage is uploaded.

## Device validation still needed

The updated iOS simulator app and Android native camera module compile. The regression suite checks capture boundaries, faster-rate buffer capacity, lost context, stale/duplicate confirmation, portrait geometry, and sentence recording duration. The connected-device inventory listed Nguyen's iPhone as unavailable, so the change has not been installed or measured on that phone.

Rebuild the development app for continuous idle body tracking and the lower native frame interval. A JavaScript reload alone cannot update these native behaviors. Next, evaluate labeled supported signs, unknown gestures, and full sentences from the actual phone, across multiple signers and lighting conditions. Further model accuracy requires matched training/evaluation data; enlarging label lists or loosening score thresholds cannot substitute for it.

