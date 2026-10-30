# SignBridge

SignBridge is an iOS and Android communication app built with Expo SDK 58, React Native, and TypeScript. It combines its experimental local ASL translator with private one-to-one video calls and captions below each caller's video.

## Video calls with sign captions

The home screen now offers **Start or join a call** and **Open translator**. Calls use private invitation codes, optional microphone audio, local AI sign recognition, reviewed or explicitly enabled automatic word captions, short sentence drafts, and typed captions. Each participant controls their own caption sharing. The call and recognizer share one camera stream through native WebRTC frame processors.

Calling requires a new native build and a running signaling service. The repository includes the service, Docker deployment, temporary TURN credentials, integration tests, and setup instructions in [docs/calling.md](docs/calling.md). Set `EXPO_PUBLIC_CALL_SIGNAL_URL` before building. A public service and relay have not been provisioned. The existing ASL models retain their experimental accuracy limitations.

```bash
npm run calls:server
npm run test:calls-server
```

## Current milestone

A native live camera pipeline tracks hands, face and body with MediaPipe. Word recognition has **one 500-entry Dictionary**, selected strictly by ASL-LEX subjective frequency ratings among matched existing trained words, with no exceptions. This is a top-500 subset of supported words, not a universal ASL frequency ranking. The 250-sign, 1,000-word and expanded word modes are no longer selectable.

The existing Citizen original/mirrored passes and WLASL secondary model remain underneath the restricted vocabulary. Their class mappings and weights are unchanged. Every completed valid recognition offers three distinct alternatives from the supported vocabulary, even when scores are low or a model’s leading prediction is outside that vocabulary. Low-score alternatives are possibilities for review, not confirmed matches. A strong full-vocabulary secondary prediction can take a review slot even for words shared with Citizen. Nothing is automatically added to the transcript. This keeps the established capture pipeline instead of reverting to the legacy 1,000-class adapter, which performed poorly in an earlier small replay.

Begin with shoulders visible, sign one word for 0.5–5 seconds, then lower both hands below your elbows and pause, or move them out of view. **Finish sign** remains available. Select a match only if it is correct; otherwise sign again or edit the text. **Dictionary** lists the supported words. Camera tracking, editable text, Copy/Clear, tutorials and the separate sentence feature are preserved. Processing stays on-device; no user footage is uploaded.

**Dictionary → select a word → Teach my version** adds a gesture pattern linked to that same word. **Options → Personal signs → Add new word** handles words outside Dictionary. Record three examples and tap **Save & use this version**. Your chosen meaning is saved regardless of the pretrained guesses, including when predictions are unavailable. Earlier versions are retained; eight versions total are supported. Enabled personal signs are restored on reopening the camera screen. Recognition Lab provides diagnostics, testing, export and delete tools. This learns local templates without changing neural-model weights. See the [collection and evaluation workflow](docs/recognition-lab.md).

**High live accuracy has not been established.** Vocabulary restriction and synthetic regression tests do not prove recognition accuracy. See [current limitations and historical evaluations](docs/model-limitations.md). This update uses existing native models; an installed development build can receive the JavaScript update, while a standalone app needs an updated packaged build.

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

If the phone reports **There was a problem loading the project** with a
`java.net.ConnectException`, it could not reach Metro. With the installed
development build and Metro running, connect an unlocked Android phone by a USB
data cable, accept USB debugging if prompted, and run:

```bash
npm run android:connect
```

This restores USB port forwarding and opens SignBridge using the computer's
Metro server through USB. Keep the cable connected and rerun the command after
reconnecting it. No rebuild is required for this connection repair. Use
`SIGNBRIDGE_METRO_PORT=8082 npm run android:connect` if your Metro uses another port.

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

