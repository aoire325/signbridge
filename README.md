# SignBridge

SignBridge is an iOS and Android isolated ASL word recognition prototype built with Expo SDK 58, React Native, and TypeScript.

## Current milestone

A native live camera pipeline tracks hands, face, and body using MediaPipe. The default **2,917-entry offline vocabulary** combines the trained ASL Citizen 2,731-class and WLASL 2,000-class models after deduplicating variants and overlaps. Entries include words and lexicalized phrases; this is not a frequency-ranked list of 2,917 common English words. Expanded suggestions require user review before insertion. Capture now preserves body context before/after the sign and supports denser native observations. On a separate 48-example public-pose check, Citizen top-1 results improved from 19/48 to 31/48 at the old sampling rate, and 33/48 at a 33 ms minimum interval. The correct word appeared among the current suggestions in 40/48 cases. This convenience sample is not a live-phone or general ASL accuracy benchmark; see [evaluation notes](docs/evaluation/word-capture-accuracy.md).

Begin with hands lowered and shoulders visible, sign one word for 0.5–5 seconds, then lower your hands and wait for suggestions. **Finish sign** remains available when your hands stay in view. Select a match only if it is correct; otherwise repeat the sign or type the word. **Show supported words** lists the selected vocabulary. The original experimental **1,000-sign** and **250-sign** options remain available; their confident predictions enter the editable transcript automatically. Edit or Undo incorrect words. Processing stays on-device; no user video is recorded or uploaded. **Rebuild the installed development app for continuous hand, face and body tracking; a JavaScript reload alone is insufficient.**

The preview now draws pink facial contours, blue shoulders/arms, and green/yellow hands. Face, Upper body and Hands indicators explain what is visible; framing guidance helps recover a clipped face, hidden elbows or fingertips outside the image. Face and body detection continue when hands leave view, preserving that context during sentence pauses. The sentence and 250-sign models receive facial landmarks; the larger word models retain their trained body/hand inputs. Tracking improvements do not establish higher live recognition accuracy; see [tracking and model inputs](docs/model-limitations.md#continuous-face-upper-body-and-hand-tracking).

Expanded recognition now checks each sign in its original and anatomically mirrored form, averaging probabilities from the same Citizen model. Suggestions must survive both views; weak WLASL-only alternatives are withheld. Hand identity can also be corrected from one visible wrist when the other wrist is hidden. In the same 48-example pose replay, first displayed suggestions improved from 33 to 35 correct and incorrect alternatives fell from 50 to 21. Correct suggestions remained available for 37/48 examples, versus 40/48 previously: the stricter check trades some coverage for fewer wrong alternatives. These results do not establish accuracy on phone recordings. See [two-pass evaluation](docs/evaluation/two-pass-word-recognition.md). This recognition update uses the existing native models and needs only a JavaScript reload in an installed development build.

## Offline sentence mode

Choose **Sentences**, start the camera, then tap **Record sentence**. Sign one short utterance continuously (up to 12 seconds), then tap **Stop & translate**. A trained pose-to-English T5 encoder/decoder produces an editable draft entirely on the phone. The camera stays on while the sentence card shows processing progress or explains why capture was rejected. Review the draft and tap **Add sentence to transcript**. **Cancel sentence** discards the pending result. No per-word hands-out pauses or translation server are required in this mode.

The encoder and decoder are bundled assets totaling about 496 MB; install a standalone build to use them without Metro or a network. Models load only when sentence recording is requested. Android model files are memory-mapped, avoiding a second model-sized Java byte array. Release asset loading refuses remote-server fallback.

**Experimental research integration:** conversion parity has been checked against the trained model, but labeled live ASL sentence accuracy and the checkpoint author's undocumented normalization have not been validated. The 104-point adapter follows the associated public reference pipeline. Drafts may omit or change meaning. Do not treat an unreviewed draft as an accurate translation. See [model limitations](docs/model-limitations.md) and [attribution](assets/models/ATTRIBUTION.md).

## Run on a phone or simulator

Requirements: Node.js LTS and npm. The app uses native TensorFlow Lite and image-manipulation modules, so use an Expo development build or release build; Expo Go is not supported. Local iOS builds use Xcode 27 for this SDK 58 project; Android builds use the Android SDK and JDK 17.

Model binaries are stored with **Git LFS**. After cloning, run `git lfs install` and `git lfs pull` before installing dependencies. `npm run models:prepare` restores model files from the local LFS cache when available and checks their sizes and TFLite headers. Both postinstall and Metro run this check, so a missing LFS download cannot silently become a broken app build. A `.tflite` file containing `version https://git-lfs.github.com/spec/v1` is a pointer, not a model; bundling it causes `Failed to create TFLite model from data`.

```bash
git lfs pull
npm install
npm run ios
```

`npm run ios` and `npm run android` create/install native development builds and start Metro. Use a simulator/emulator or connected device. This SDK 58 app needs a development build with its native camera module; it is not configured as an Expo Go demo.

The iOS config plugin isolates TensorFlow Lite's internal symbols from MediaPipe to prevent duplicate-symbol linker failures. After pulling this change, regenerate iOS and install pods as described in [mobile builds](docs/mobile-builds.md). Use `npm run ios -- --device` for a connected iPhone; select your Apple signing team if prompted. `npm start` uses the app's explicit `signbridge` URL scheme.

To build and start Android:

```bash
npm run android
```

To restart Metro after a development build is installed, run `npm start`, then open the installed SignBridge development client and select the current server shown by Metro.

After installing `expo-dev-client` or another native module, rebuild the development app with `npm run android`. For a physical Android phone, keep the phone and computer on the same Wi-Fi network and open the server URL shown by Metro's QR code. That URL points to the computer's LAN address instead of the phone's own `localhost:8081`.

The project is configured for iOS and Android only. Camera hardware is unavailable in simulators without a configured virtual camera; use a physical device to verify preview and lifecycle behavior.

## Checks

```bash
npm run test
npm run typecheck
npm run lint
npx expo-doctor
```

Tests cover camera session transitions, isolated-word boundaries, exact landmark packing, temporal resampling, prediction filtering, vocabulary indices, transcript insertion, undo, framing feedback, and mirrored face/body/hand overlay alignment. Model accuracy still requires signer-diverse device evaluation.

On macOS with pods installed and an iOS simulator booted, `npm run test:ios-runtime` checks MediaPipe and TensorFlow Lite in one native process. To additionally exercise real face/body/hand detection and continued face/body detection with hands outside the image, download MediaPipe's public test fixture and pass its path:

```bash
curl -fLsS https://storage.googleapis.com/mediapipe-assets/portrait.jpg -o /tmp/signbridge-portrait.jpg
SIGNBRIDGE_LANDMARK_FIXTURE=/tmp/signbridge-portrait.jpg npm run test:ios-runtime
```

This optional fixture stays outside the app bundle. It checks landmark detection and runtime compatibility, not ASL recognition accuracy.

## Structure

- `src/app/` — Expo Router home and settings screens.
- `src/camera/` — permission, camera session, app lifecycle, and camera selection.
- `src/state/` — accessibility preferences and editable transcript with undo.
- `src/recognition/` — landmark preprocessing, isolated-sign segmentation, pretrained word inference, and retained experimental matchers.
- `assets/models/` — pretrained isolated-word model, label map, license, attribution, and retained alphabet assets.
- `src/services/model-status.ts` — packaged model version and supported vocabulary.
- `docs/` — architecture, privacy, and model limitations.

## Next engineering milestone

Evaluate isolated-word precision, recall, rejection of unknown signs, signer generalization, and device latency with ASL users. Continuous signing and grammatical translation need separate models and evaluation. See [model limitations](docs/model-limitations.md).

