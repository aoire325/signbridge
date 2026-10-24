# Model, vocabulary, and limits

## Default 2,917-entry review vocabulary

The new option combines Microsoft's ASL Citizen ST-GCN (2,731 trained sign classes) and the WLASL TGCN 2,000-class checkpoint. Citizen variant suffixes and punctuation/case-normalized overlaps count once, yielding 2,917 distinct word/gloss entries. Some entries are lexicalized phrases; this count does not mean 2,917 frequency-ranked common English words. Exact trained-class arrays are bundled separately from the deduplicated display vocabulary. No output-layer classes or aliases were invented to reach the target count.

Expanded mode is the default and remains explicitly **review-only**: even apparent high-confidence agreement cannot append text automatically. It shows at most three alternatives; a current-session user selection is required. Citizen supplies alternatives from its own vocabulary, while WLASL can contribute a model-exclusive word. The legacy 1,000-sign and original 250-sign options remain selectable. Improved capture raised recognition in the recorded-pose checks below, but this implementation must not be described as a validated high-accuracy 2,500-word recognizer.

Citizen preprocessing follows the upstream 27-joint order and `[1,2,128,27]` tensor layout. Its original pipeline pads before computing clip-level shoulder normalization; the app preserves that behavior and finite low-visibility elbow estimates. A golden fixture from the actual upstream dataset validates every input coordinate. Expanded capture retains up to 600 ms of body lead-in and a 550 ms hands-out ending, including brief missed-hand observations. It permits at most five seconds of signing / 6.5 seconds including context / 200 raw observations. Clips are resampled to nominal 30 Hz before applying the upstream 128-frame limit. Native tracking allows observations every 33 ms instead of 80 ms and runs body tracking even without hands; actual throughput depends on device processing. UI redraws stay bounded to about 10 Hz while capture consumes every observation.

Portrait X coordinates map into a centered 4:3 canvas so image normalization does not stretch hand/arm proportions. Missing points remain missing and landscape reference inputs stay unchanged. Synthetic crop-equivalence tests cover this geometry; the 4:3 camera adaptation still requires real-phone evaluation. WLASL uses the existing experimental MediaPipe-to-OpenPose adapter and `[1,55,100]` input. Differences between training footage, phone frame rates and segmentation materially affect predictions.

Both converted models retain float32 weights. Maximum TFLite/reference error over three synthetic fixtures was approximately 0.000069 for Citizen and 0.0000067 for WLASL-2000. Native iOS simulator inference passed for both models before and after MediaPipe execution, alongside the sentence encoder and decoder. These checks establish conversion/runtime compatibility, not recognition accuracy. Nguyen's physical iPhone was unavailable for testing this change.

Reproducible utilities are `scripts/fetch-citizen-metadata.py`, `scripts/prepare-citizen-evaluation.py`, and `scripts/evaluate-expanded-words.cjs`. They use pinned public original-test-split poses, not app-user footage. The original twelve-example diagnostic is preserved in `docs/evaluation/expanded-word-spot-check.json`; its poor result exposed the trimming defect. After fixing it, a separate 48-gloss check improved Citizen top-1 from 19/48 to 31/48 at the old sampling rate and 33/48 with denser sampling; the correct word was among the current suggestions in 40/48 cases. This is a convenience sample, not a live-camera accuracy estimate. See `docs/evaluation/word-capture-accuracy.md` and its JSON report for protocol, limitations, and remaining errors. All expanded results still require confirmation. Sample poses, participant metadata and videos are not bundled in the app.

See the model manifests and attribution for exact revisions, hashes, reconstruction commands, licenses and research-data restrictions. Increasing classifier vocabulary does not improve or enlarge the separate sentence model.

### Two-pass word recognition update

Expanded mode now runs Citizen twice: once on the captured landmarks and once with X reflected and left/right anatomical joints swapped before normalization. Missing joints remain zero. Equal averaging happens after each pass's softmax; raw logit magnitudes from different passes cannot dominate the average. The display mirror is independent of this inference transformation. Citizen candidates must occur in both passes' three highest-ranked lexical entries. WLASL-only suggestions require a score of at least 0.65 and margin of 0.20; these remain uncalibrated heuristics and every suggestion still requires review. The second pass adds one Citizen inference and small landmark buffers, without new weights or a server.

The same 48-example public-pose check improved raw Citizen top-1 from 33 to 36 and first displayed suggestion from 33 to 35 correct. Incorrect alternatives fell from 50 to 21; correct-suggestion coverage fell from 40 to 37, and four clips now return no suggestion. This is a coverage/precision tradeoff, not proof that the user's reported eight live errors are fixed. See [protocol and results](evaluation/two-pass-word-recognition.md). The word update does not alter sentence decoding.

## Legacy 1,000-sign option

The legacy option uses the experimental TGCN-WLASL 1,000-class checkpoint from `sharonn18/tgcn-wlasl` revision `dacb4568719caa03c44764034f599a9f8a0f63f4`. Float32 conversion was checked numerically against its strict-loaded PyTorch reference; maximum error on the conversion fixture was about 0.000006. It expects `[1,55,100]`: 55 upper-body/hand joints with 50 XY samples. Missing coordinates use -1 and visible coordinates use `2 * coordinate - 1`. MediaPipe joints are mapped into the original OpenPose topology, so this conversion check does not establish live recognition accuracy. The class order follows the original TGCN lexicographic LabelEncoder; the weight mirror does not publish its own class map. The separate replay found only 2/14 eligible examples correct using its prior trimming, so this remains an experimental alternative. It keeps the original segmentation because retaining context did not improve this adapter in the check.

## Offline sentence translation

Sentence mode now captures an entire short utterance without per-word boundaries, then runs a separate trained T5 pose-to-English encoder/decoder locally. The source is `FatimahEmadEldin/ytasl-t5-v1_1-base` at revision `cc6330e8a992975b80bf95b098cdf27f8379febe`, declared CC BY 4.0, based on Google's T5 v1.1 base. There is no translation server, gloss-to-grammar template, or word substitution step.

Capture is bounded to 12 seconds / 96 samples at approximately 8 fps. Input contains 104 XY landmarks: 25 pose, 21 right hand, 21 left hand and 37 face points. The reference sign-space adapter normalizes body coordinates relative to shoulders and hands/face in local square boxes. **The checkpoint author does not specify the exact training normalization; this adapter is an unvalidated compatibility assumption.** The independent MediaPipe Tasks extractors also differ from training-time Holistic extraction. Consequently this is an experimental implementation, not a verified accurate translator.

The model graph is split into a `[1,96,208]` pose encoder with an attention mask and a fixed 64-token English decoder. Weights are stored as float16; activations remain float32. Greedy generation uses EOS=1, PAD=0, a no-repeat-trigram constraint, and a 63-token maximum. The average model log probability (including EOS) must exceed -3.5; this is an uncalibrated rejection heuristic, not an accuracy estimate. Empty, stationary, poorly framed and interrupted captures are rejected. Token-limit outputs are discarded rather than shown as completed sentences. Drafts require user review before transcript insertion.

Validation performed: strict checkpoint loading; float32 graph parity against PyTorch (maximum encoder error approximately 0.000003, decoder approximately 0.000012 on synthetic fixtures); float16 encoder maximum error approximately 0.00064, decoder approximately 0.0052; a 38-token greedy synthetic sequence matches the original model through EOS. These tests establish conversion/runtime conformance only. They do not evaluate signed-sentence meaning, word error rate or signer generalization. A labeled live-signer evaluation remains required.

The standalone Android release was installed on a Samsung SM-A376U1. Live landmark events, local sentence encoder/decoder loading with tensor allocation, entry into recording, and rejection of a hands-absent capture were checked on the phone. This device check did not run a valid signed sentence through generation or measure translation accuracy. Airplane mode was not toggled during the check.

Bundled sentence assets total approximately 496 MB. First loading, RAM pressure and token decoding latency depend on the phone. Release builds resolve packaged assets to local files and refuse remote model fallback; Android maps files instead of creating a model-sized Java array. A standalone build is required for airplane-mode use; the Expo development client still needs its development server to obtain its JavaScript bundle.

## Original 250-sign model

The original fallback uses the pretrained ISLR first-place model mirrored at `sign/kaggle-asl-signs-1st-place`, commit `d831c2f58cefbc5110dfbb91cc8e6eb516b4ccfc`. It classifies 250 isolated ASL signs from MediaPipe landmarks. No personal teaching is required. The exact index mapping is in `assets/models/asl_word_labels.json`; the screen can display all supported words. See `assets/models/ATTRIBUTION.md` for sources, hashes, the input-shape modification, and MIT licensing.

## Runtime

### Continuous face, upper-body and hand tracking

On iOS and Android, each processed frame runs the hand, pose and face models with the same image and timestamp. Face and body tracking continue when no hand is detected. Processing remains serial with late-frame dropping; the 33 ms minimum interval is a ceiling on sampling frequency, not a guaranteed frame rate. All three models are bundled and run locally.

The camera draws sparse facial contours (eyes, eyebrows, mouth and outline), shoulders/arms and hand skeletons. All layers share aspect-fit projection and front-camera mirroring. Visible status indicators and guidance check face anchors, shoulders, elbows, wrists and fingertips. These display checks reject invalid or off-screen points without changing the pretrained models' input coordinates. Overlay updates remain bounded to about 10 Hz.

Model inputs remain compatible with their existing weights:

| Model | Captured context used for recognition |
| --- | --- |
| Expanded ASL Citizen | Seven head/body points and twenty selected hand points; no face-mesh input |
| WLASL 1,000 / 2,000 | The existing 55-joint body/hand adapter; no face-mesh input |
| Original 250 signs | 468 face, 33 pose and 42 hand points |
| Sentence translation | 37 face, 25 pose and 42 hand points |

Facial landmark movement now remains available to sentence input during hands-out pauses instead of losing face context because hand detection stopped. Face blendshape coefficients are also detected, but the pretrained recognition models do not consume those coefficients. No new classifier weights or claimed accuracy gains are introduced by the tracking update. Unit tests cover visibility checks, missing hands, mirrored/letterboxed overlays and facial movement reaching sentence inputs. The optional public-portrait native test checks detection with and without hands; it does not measure signing accuracy or phone latency.

Input corrections: hand identities are reconciled against clearly visible pose wrists with a one-to-one assignment, including crossed arms. One visible wrist can anchor the signing hand even when the other wrist is hidden; this uses a tighter proximity threshold and rejects ambiguous matches. When no reliable association is available, classifier labels are retained. This is a geometric consistency check, not a measured live recognition-accuracy improvement. The 1,000-sign input interpolates nearby observed points by timestamp and preserves missing-point sentinels rather than interpolating them into invented motion.

Sentence capture retains at most 400 native observations and resamples by elapsed time to 8 Hz, so a slow camera does not compress timing and a faster camera does not prematurely fill the buffer. The movement guard also uses elapsed time to avoid rejecting the same sign at a higher frame rate. Frames without required face/body context receive attention mask zero. During sentence recording, the main Stop action finishes capture and starts translation instead of stopping the camera and clearing the recording. Camera pause, stop and switching are disabled while translation runs; cancellation remains available. The sentence card shows recording/framing feedback, a processing spinner, decoder token progress, capture errors and the reviewable draft. These changes are covered by synthetic input and screen-interaction regressions; labeled live signing is still needed to measure word and sentence accuracy.

The 250-sign fallback captures 0.5–5 seconds of face and hand movement. A 550 ms hands-out pause or Finish sign submits one clip. Its bounded buffer now permits 160 samples to accommodate denser native observations. The app resamples by timestamp to 32 frames, packs 543 landmarks per frame in the original Holistic order (468 face, 21 left hand, 33 pose, 21 right hand), and marks missing points as NaN. The model contains normalization and returns 250 logits. Softmax scores must have a top probability of at least 0.65 and a margin of at least 0.20 to insert a word automatically.

The transcript preserves sign order. Words are editable and undoable. Text editing pauses automatic insertion; paused, stopped, switched, and interrupted sessions cannot insert stale inference results. Held gestures cannot repeatedly commit without a hands-out reset. Short, overlong, and interrupted clips are discarded.

## Limits

This is a closed-vocabulary classifier, not a general ASL interpreter. Unsupported signs and ordinary movements can resemble known classes even at high confidence. Softmax scores are not measured accuracy estimates. No mobile signer-independent accuracy, per-class recall, or unknown-sign rejection rate has been established. Face and hand landmarks come from newer independent MediaPipe Tasks models, whereas training used MediaPipe Holistic; this distribution difference needs device evaluation. The iris points beyond face index 467 are omitted.

The isolated word models do not recognize continuous signing or translate ASL grammar; sentence mode has the separate experimental limitations above. Signs need boundaries and a visible face plus signing hand. Lighting, occlusion, signing speed, camera orientation, and signer differences can affect results. The original alphabet classifier and personal matcher remain in the repository but are not the active transcription path.

## Evaluation needed

Evaluate supported signs, unknown signs, ordinary movements, two-handed signs, mirrored preview alignment, missed landmarks, deliberate repeated words, and interruptions across signers and devices. Report per-class precision/recall/F1, rejection rates, and end-to-end latency before making accuracy claims.

