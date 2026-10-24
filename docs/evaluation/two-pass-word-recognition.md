# Two-pass word recognition — October 24, 2026

The user reported eight errors in front-camera Expanded mode: mom→bed; thank you→lamp/four; ball→basic/email; not→longtime/nut/call; breathe→bow; check→to drown/project/fromthenon; hello→sunbathe/forest/lamp; bye→why not/mature. These are reported results, not captured landmark fixtures. Their exact cause and whether this update corrects them remain unverified. All eight intended signs exist in the expanded vocabulary, with MOTHER as Citizen's label for mom.

## Changes and reasoning

- Correct anatomical hand assignment when only one pose wrist is visible. Previously an occluded other wrist disabled the association completely. One-anchor matches require distance ≤0.08 image diagonals and a ≥0.04 separation between competing hands; existing two-anchor rules are unchanged. This fix is covered by geometric regressions, including ambiguous matches and crossed arms.
- Run the same Citizen model on the original and anatomically mirrored landmark sequence. Reflect X, swap left/right body joints and hand slots, preserve missing coordinates, then use the original training normalization. Average the two probability distributions equally. This does not change preview mirroring or classifier weights.
- Keep only Citizen candidates present in both top-three lexical rankings. Require the pre-existing strong-score heuristic for WLASL-only candidates (probability ≥0.65, margin ≥0.20). All results remain suggestions requiring explicit confirmation.
- Explain when the checks cannot find a consistent match. No reported output is remapped to an expected word.

## Evaluation

A separate 12-gloss development subset was used to explore anatomical mirroring and temporal scaling. Original top-1: 8/12. Two anatomical views: 9/12. Three speeds without mirroring: 8/12. All six views: 8/12. The two-view approach was selected before running the 48-gloss check; temporal scaling was not shipped.

The evaluation then replayed the same 48 original-test-split public pose files used in the earlier capture check, with the current actual app packing, segmentation, inference and suggestion code. This is not a new independent corpus. Each replay retains context and a 33 ms minimum sampling interval. Both before/after runs use the partial-wrist correction so the table isolates inference and suggestion changes.

| Measure across 48 clips | Single pass / previous suggestions | Two passes / stricter suggestions |
| --- | ---: | ---: |
| Highest Citizen class correct | 33 | 36 |
| First displayed suggestion correct | 33 | 35 |
| Correct word among displayed suggestions | 40 | 37 |
| Incorrect alternatives displayed | 50 | 21 |
| Total alternatives displayed | 90 | 58 |
| Clips with no suggestion | 0 | 4 |

The stricter policy intentionally withholds inconsistent guesses and also loses some correct alternatives. Reduced wrong suggestions must not be described as correcting every sign. The 48 examples contain known isolated signs, not unknown movements, continuous sentences or new phone-camera extraction. Scores are uncalibrated. No live-phone precision, latency, signer generalization or sentence improvement was measured. A second inference adds processing work; actual cost depends on the phone.

[Machine-readable results](two-pass-word-recognition.json) include the model SHA, dataset revision, source hashes, per-example results and the eight unverified user cases. No recordings or participant identifiers are bundled.

## Reproduction

Use the existing downloader with the pinned dataset revision and original test CSV. Keep public pose files outside the repository. `python3` needs TensorFlow; set `SIGNBRIDGE_EVAL_PYTHON` if it is installed in a separate interpreter.

```bash
python scripts/fetch-citizen-metadata.py --output /tmp/signbridge-two-pass-metadata --extract
python scripts/prepare-citizen-evaluation.py --test-csv /tmp/signbridge-two-pass-metadata/test.csv --output /tmp/signbridge-two-pass-check --count 48 --offset 12
node scripts/evaluate-expanded-words.cjs /tmp/signbridge-two-pass-check --single-view
cp /tmp/signbridge-two-pass-check/report.json /tmp/signbridge-two-pass-check/before.json
node scripts/evaluate-expanded-words.cjs /tmp/signbridge-two-pass-check
```

`--single-view` is required when reproducing older evaluations: the evaluator now defaults to the shipped two-pass policy. Delete downloaded metadata and poses after local evaluation. The update uses already-bundled models, so the development app can receive it through a JavaScript reload. Packaged standalone apps need a new build for distribution.

