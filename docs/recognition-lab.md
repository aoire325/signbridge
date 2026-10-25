# Improving recognition with local examples

No labeled phone recordings were supplied for this change. The app therefore has **no measured new accuracy gain**, and the bundled neural weights are unchanged. The 500-word allowlist reduces competing output labels; it does not fix a model that cannot separate two included signs.

## Add a personal gesture version

1. Open Dictionary, search for HELLO (or another word), and select it. Then choose Teach my version. Options → Personal signs → Choose Dictionary word reaches the same flow.
2. For a word outside Dictionary, choose Word not here? Add new word, or Options → Personal signs → Add new word. Enter a word or short phrase (up to 40 characters). You define the gesture-to-word association and record that gesture three times; the app does not judge it against Dictionary. Existing Dictionary names are reused instead of creating duplicate labels. UNKNOWN is reserved for negative test captures.
3. Tap Record example, sign once, then lower your hands and pause or tap Finish sign. Save the example under the meaning you selected. Repeat until 3 of 3 examples are saved for this version. The model can guess FOREST, PILLOW, CLOUD or nothing; that never changes the HELLO label you selected. There is no ASL-correctness check or requirement for agreement with the pretrained model. Tracking must still provide a usable sequence.
4. Tap Save & use this version, then Done and perform a fresh sign. Your saved gesture version is matched against the new capture; close matches contribute its associated word to the three review choices. Nothing is automatically appended to the transcript.
5. Add another version of the same word to retain a different gesture pattern. Earlier versions stay active after saving and enabling the new one; same-word versions never create duplicate suggestion chips. Eight versions total are supported to bound device work. Remove version asks for a confirming tap and removes only that pattern's examples; Use saved versions enables the remaining bank.

The old Teach a sign component/entry is removed. Existing saved records remain readable: explicit versions keep their IDs, while older records form groups of three within their original word/session. Their pretrained baseline guesses are kept for provenance. Old v1 baseline test recordings require fresh v2 tests after the ranking change; their training examples are preserved.

Profiles persist locally and rebuild when the camera screen opens. Closing Personal signs discards only an unsaved capture. Switching/stopping the camera cancels in-flight collection. Adding/removing examples disables the previous profile until versions are enabled again. Multiple words may deliberately use similar or identical gestures; matching meanings are offered as alternatives rather than rejecting the user's associations. This is personal mapping, not verification of standardized ASL.

## Collect and evaluate

1. Start the camera in Words mode. Open Options → Recognition Lab.
2. Enter the intended word (built-in or personal) and a signer nickname. Choose Training. Tap Record example, sign once, then lower your hands and pause or tap Finish sign. Save to associate the captured gesture with the word you entered. The app does not check signing correctness, and choosing a suggestion does not label a training example.
3. Record three varied examples of each confusion word, such as NAME, LIKE and HELP. Use natural speed and small variations in position; include both hands and shoulders. Train up to eight gesture versions total, each with three examples. Do not mirror signs arbitrarily: handedness can carry linguistic information.
4. Choose Test to start a separate session. Record fresh examples; do not reuse a training clip. Record UNKNOWN examples for unsupported signs and ordinary hand motion. For meaningful generalization testing, also collect separate signers, lighting, distances, left/right dominant hands and phone orientations, with consent.
5. Tap Learn examples, then Run test. The report compares baseline and personal top-one/top-three results, improvements, regressions, confusions and changed guesses for unknown gestures. Enabling personal learning is optional and is saved locally; the profile is rebuilt from saved examples when the camera screen reopens. Relearn after adding/removing examples. Retest on fresh data after revising training; repeatedly tuning to the same test set invalidates its independence.
6. Export examples opens the system folder picker on iOS/Android. JSON contains features and labels, no video. Captures with unavailable predictions store empty baseline/displayed lists, not fake choices. Capture-only diagnostics show Primary, Mirrored and Secondary leaders so HELLO failures can be investigated. Delete all removes the app-owned data, not previously exported copies. Web camera/training is not a supported native target.

The collection is capped at 120 clips to bound device memory/storage. Saving requires a valid sequence with at least four tracked observations and at least three hand-bearing observations. After resampling, at least half of the 24 time slots must retain tracked position features, including at least three slots with hand features. A single frame interval over 250 ms no longer rejects the entire recording. There is no 8 fps minimum or 40% hands-visible ratio: slow phones and a short sign surrounded by hands-out pauses can still provide usable recordings. No recognition result or Dictionary match is required. Tracking or storage errors appear beside Save example, the recording remains available to retry, and the counter advances only after a successful file write. Poor captures remain eligible as test data so evaluation does not hide tracking failures.

## Implemented recognition work

| Area | Current implementation | Remaining validation |
| --- | --- | --- |
| Confusion benchmark | Explicit expected labels, independent capture sessions, baseline guesses and capture diagnostics | Real recordings and representative per-word coverage |
| Hand detail | All 21 XYZ points per hand, palm normal, finger bends, wrist/body and fingertip/face positions; explicit missing masks | Device depth noise, occlusion and handedness failure rates |
| Sign boundaries | Visible lowered-hand rest with a settling interval; existing hands-out and Finish sign retained | Low-position signs and natural pauses in live use |
| Temporal learning | Elapsed-time resampling, velocities and masked dynamic time warping against labeled training sequences | A broader trained sequence network matched to phone data |
| Suggestion ranking | User-labeled gesture versions, bounded DTW matching, word deduplication and baseline fill; exactly three choices | Independent benefit and regression rates; universal calibrated ranking remains undone |
| Facial cues | Eight face anchors and eleven expression coefficients in the optional feature path | Facial cue ablations and linguistic validation; no RGB appearance model added |

The personal classifier uses three examples per gesture version and eight versions total. It derives a matching radius from within-version distances, capped at 0.12 for one word or 0.22 for multiple words, with a 0.015 floor. These are engineering heuristics, **not confidence probabilities**. Training accepts user-selected meanings regardless of pretrained agreement or overlap. At recognition time, the average distance to the nearest two examples must fit the saved radius; multiple matching versions of the same word produce only one choice. Multiple matching words remain alternatives. Existing model tensors, class order and preprocessing are unchanged.

Feature schema v1 stores 24 time-resampled frames: 203 position/shape/expression features plus 203 velocities and equally sized visibility masks. Hand Z is wrist-relative estimated depth; it is never subtracted from face/body Z or described as world-space depth. Missing points and long gaps remain masked. Personal DTW matching assigns an unobserved time slot a missing-data cost of 0.15 instead of making the whole comparison infinite, including when both slots are missing. Mostly missing sequences and sequences without enough hand observations remain ineligible for personal matching. The pretrained model inputs and camera interruption handling are unchanged. Features are computed only while recording an example or using personal learning. No raw images are retained.

## Reproduce evaluation

```bash
node scripts/evaluate-personal-words.cjs /path/to/examples.json --signer me
node scripts/evaluate-personal-words.cjs /path/to/examples.json --baseline-only
```

The CLI uses the same training/ranking code as the app, checks schema/vocabulary and baseline versions, rejects repeated train/test sequences and overlapping session IDs, and prints per-word counts, confusion pairs and aggregate metrics. It cannot detect semantically duplicated performances with different timestamps. Do not split adjacent frames from one recording between train and test. Top-three for UNKNOWN is not accuracy: by product requirement, every valid model result supplies three guesses, including for unknown gestures. The report separately counts personal promotions on these negative cases.

## Vocabulary provenance

`scripts/prepare-common-vocabulary.py` reproducibly derives the list from the pinned ASL-LEX CSV URL in `assets/models/asl_common_500_manifest.json`. It matches 876 of the former 1,000 words by normalized EntryID, selects the first 500 strictly by subjective mean frequency with alphabetical tie-breaking and no exceptions, then alphabetizes only the final display. See model attribution for both required ASL-LEX papers and licensing notes. No arbitrary alphabetical truncation, aliases or new model classes are used.

## Work that needs recordings

A significant accuracy claim requires a fixed, independently signed benchmark and enough examples of all 500 words. Training a new temporal network with these features, validating sign-boundary precision/recall, calibrating a global reranker and comparing facial-feature ablations remain data-dependent work. Public model weights alone and synthetic tests cannot establish those gains. The local pipeline supplies the collection, features, baseline comparisons and export needed to start that work without changing the functioning camera or introducing a cloud dependency.
