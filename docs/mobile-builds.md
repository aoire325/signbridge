# Mobile builds

## Local development

The project uses Expo SDK 58 Continuous Native Generation. Generated native projects are created by Expo; configure native behavior in `app.json` and regenerate after changing plugins.

```bash
npm install
npm run ios
npm run android
```

`npm run ios` runs `expo run:ios`; `npm run android` runs `expo run:android`. Each command generates the native project if needed, compiles a development build, installs it on a selected simulator/device, and starts Metro. To start Metro for an already-installed build, use `npm start`.

This app bundles an int8 TensorFlow Lite fingerspelling model and uses `react-native-fast-tflite`, Expo ImageManipulator, and Expo FileSystem. These native modules are included in the generated iOS/Android projects, so rebuild the development binary after installing dependencies or changing native packages. Expo Go cannot run the recognizer. Captured frames stay as native image references through preprocessing; only a 64×64 temporary image is saved for pixel decoding and deleted after inference.

Run `npm install` before building. This checkout includes a version-checked postinstall compatibility patch for the Expo Modules JSI Swift sources when using Swift 6.2 in Xcode 26.1.1. Use the toolchain recommended for your Expo SDK in CI; the installed local toolchain is also checked through native builds.

For camera preview verification, use a physical device. Simulators may have no usable camera input. The `expo-camera` configuration supplies camera permission messaging and disables Android audio recording permission; see the [SDK 58 camera reference](https://docs.expo.dev/versions/v58.0.0/sdk/camera/).

## macOS folder access during iOS builds

If the checkout is inside `Documents`, macOS privacy controls can prevent Xcode's helper processes from reading it. Symptoms include a workspace failing to load, `actool` reporting permission denied for `Contents.json`, or `ibtool` reporting that it cannot determine a storyboard's type. The last message alone does not prove an SDK is missing.

In System Settings → Privacy & Security → Files & Folders, enable Documents Folder access for Xcode and the application launching the build (Terminal or Visual Studio Code). Quit and reopen those applications after changing access, then retry `npm run ios -- --device`. See [Apple's folder-access instructions](https://support.apple.com/guide/mac-help/control-access-to-files-and-folders-on-mac-mchld5a35146/mac).

Interface Builder's `ibtoold` helper can survive an application restart and retain the old access context. If the denial continues after granting access, stop all builds and restart the Mac before retrying. During diagnosis here, terminating the two idle `ibtoold` processes and rerunning the compiler resolved the storyboard error without changing its contents.

To distinguish a source problem from a location-access problem, compile an unchanged copy of the storyboard in a temporary folder using the same `ibtool`. In this checkout, the original in Documents failed while a temporary copy, including its original provenance metadata, compiled without warnings. Removing provenance metadata is therefore not a demonstrated fix for this failure. Do not regenerate the project or change signing settings to repair a folder-access denial.

## Earlier prototype checks

- Android: `./gradlew assembleDebug` succeeded with the TensorFlow Lite and Nitro native modules linked, including after the native-image capture changes. No emulator or Android device was attached, so the APK was not installed and camera inference was not exercised.
- iOS: CocoaPods installation succeeded, including the TensorFlow Lite pods. A generic iOS Simulator build failed because the installed Xcode 26.1.1 toolchain rejects `weak let` in ExpoModulesJSI; SDK 58's supported build image uses Xcode 27.
- The model was inspected directly and its `[1,64,64,1]` int8 input and `[1,27]` int8 output match the app's preprocessing and labels. Android and iOS JavaScript bundles exported successfully.
- Camera permission prompts, camera preview, inference on physical devices, lifecycle handling, and transcript controls still need device-level testing.
- The lower-resolution capture and mirrored-view majority decoder are intended to reduce latency and false commits. Their actual speed and accuracy impact requires measurement on representative devices and signers.

## Standalone offline sentence builds

Fetch Git LFS assets before building: `git lfs pull`, then `npm run models:prepare`. Model sizes and SHA-256 identities are recorded in `assets/models/bundled-models.json`. The preparation script restores pointer files only from checksum-verified local LFS objects; it never modifies Git's object store. Postinstall and Metro enforce preparation, blocking a build if a model remains missing, truncated, or a Git LFS text pointer. The runtime also checks a small model header and the expected file size before entering native TFLite code, without reading the full model into JavaScript memory.

Sentence translation requires the bundled encoder, decoder and tokenizer, approximately 496 MB in total. Expo Go is unsupported. The development client depends on Metro for JavaScript; use a standalone release/preview build for airplane-mode operation. `expo-asset` resolves bundled resources into local model files, and the version-checked TFLite loader patch avoids a model-sized Java-heap copy. Run the postinstall script before native builds.

For reproduction and validation, see `scripts/convert-sentence-model.py`, `scripts/verify-sentence-model.py`, and `assets/models/asl_sentence_manifest.json`. No cloud translation service or credentials are needed at runtime.

## iOS TensorFlow Lite linker compatibility

MediaPipeTasksCommon 0.10.35 embeds a TensorFlow Lite runtime. The recognizer separately depends on TensorFlowLiteC 2.17.0 through react-native-fast-tflite. Without isolation, their 54 overlapping internal C symbols cause `duplicate symbol '_TfLite…'` errors during iOS linking. The duplicate `-lc++` warning is separate from those fatal errors.

The Expo config plugin `plugins/with-ios-tflite-isolation.js` installs a CocoaPods post-install hook from `scripts/ios-isolate-tflite.rb`. It uses Apple's `nmedit` to make the reviewed internal symbols local in the standalone runtime's merged object, preserving its public model/interpreter/tensor I/O exports and its internal references. It handles the iPhone arm64 slice and both arm64 and x86_64 simulator slices. It neither removes MediaPipe graph objects nor suppresses linker duplicate-symbol errors, and it refuses unreviewed dependency versions or symbol changes. Repeated pod installation is idempotent. Revalidate this integration before upgrading either native runtime.

This integration uses TensorFlowLiteC's CPU Core subspec. The hook also refuses additional iOS delegate subspecs until their symbol bindings have been reviewed.

To regenerate and run after pulling this change:

```bash
npm install
npx expo prebuild --platform ios --no-install
npx pod-install
npm run ios
# For a connected iPhone, use npm run ios -- --device and select your device.
```

Run the generated `.xcworkspace` if opening the project in Xcode. A physical iPhone also requires a signing team and Developer Mode. A simulator can verify linking and model initialization; real camera signing requires a physical device.

For a Keychain prompt asking to let `codesign` use your Apple Development private key, enter the login keychain password in the macOS dialog. `Allow` authorizes one use; `Always Allow` authorizes subsequent signing operations with that key too. A build signs multiple embedded frameworks, so a single-use approval can result in another prompt. If signing fails with `errSecInternalComponent`, retry from Terminal in your logged-in Mac session and follow [Apple's signing diagnostics](https://developer.apple.com/forums/thread/712005). Do not put keychain passwords in project files or build commands.

If installation fails with `ApplicationVerificationFailed`, read the nested device error. Here it identified an unsigned `ExpoFileSystem.framework` left in the output of an interrupted framework-signing phase. After resolving Keychain access, completing a normal signed build and verifying each embedded framework's signature resolved installation. Do not reuse an unsigned or partially built `.app` for device installation. A signed Debug build was subsequently installed successfully on the connected iPhone; this verifies installation, not camera or translation accuracy.

### Linker fix validation

- Xcode 26.1.1: the complete arm64 iOS 26.1 simulator Debug build succeeded, and the app launched and initialized its word model.
- The complete iPhone arm64 Debug build succeeded with code signing disabled. No signing team was configured; this unsigned build was not installed on a physical iPhone.
- `npm run test:ios-runtime` passed in the booted simulator. It ran word inference before and after MediaPipe graph execution, initialized and ran the hand/body/face graphs on a synthetic black image, and ran a synthetic sentence encoder/decoder step with finite outputs. This verifies native compatibility, not ASL accuracy or real camera behavior.
- All 52 unit tests, lint, and type checking passed. The native symbol test verifies that two runtimes retain their own internal implementations after localization. Reapplying the CocoaPods isolation hook leaves the binaries unchanged.

To repeat the native compatibility check, run `npm run test:ios-runtime` after CocoaPods installation with an iOS simulator booted. The check reads bundled models locally and uses synthetic inputs only.

