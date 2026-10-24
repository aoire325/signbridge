#!/usr/bin/env bash
set -euo pipefail

# Requires macOS, installed CocoaPods dependencies, and a booted iOS simulator.
# Synthetic inputs by default. SIGNBRIDGE_LANDMARK_FIXTURE optionally supplies
# MediaPipe's public portrait.jpg for face/body/hands and hands-out checks.
# This checks native runtime coexistence and detection, not ASL accuracy.
signbridge_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
signbridge_temporary="$(mktemp -d "${TMPDIR:-/tmp}/signbridge-ios-ml.XXXXXX")"
trap 'rm -rf "$signbridge_temporary"' EXIT
signbridge_pods="$signbridge_root/ios/Pods"
signbridge_sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
signbridge_arch="$(uname -m)"

node "$signbridge_root/scripts/prepare-model-assets.cjs"
xcrun --sdk iphonesimulator swiftc \
  -target "${signbridge_arch}-apple-ios16.4-simulator" \
  -sdk "$signbridge_sdk" \
  -module-cache-path "$signbridge_temporary/modules" \
  -F "$signbridge_pods/MediaPipeTasksCommon/frameworks/MediaPipeTasksCommon.xcframework/ios-arm64_x86_64-simulator" \
  -F "$signbridge_pods/MediaPipeTasksVision/frameworks/MediaPipeTasksVision.xcframework/ios-arm64_x86_64-simulator" \
  -F "$signbridge_pods/TensorFlowLiteC/Frameworks/TensorFlowLiteC.xcframework/ios-arm64_x86_64-simulator" \
  "$signbridge_root/tests/native/ios-ml-runtime-smoke.swift" \
  -framework MediaPipeTasksCommon -framework MediaPipeTasksVision -framework TensorFlowLiteC \
  -framework Foundation -framework UIKit -framework AVFoundation -framework CoreVideo \
  -framework CoreMedia -framework CoreGraphics -framework Accelerate -framework Metal \
  -framework QuartzCore -framework AudioToolbox -framework CoreML -framework CoreImage \
  -framework Security -framework OpenGLES -lc++ -lz \
  -Xlinker -ObjC -Xlinker -force_load \
  -Xlinker "$signbridge_pods/MediaPipeTasksCommon/frameworks/graph_libraries/libMediaPipeTasksCommon_simulator_graph.a" \
  -o "$signbridge_temporary/runtime-smoke"
xcrun simctl spawn "${1:-booted}" "$signbridge_temporary/runtime-smoke" "$signbridge_root" "${SIGNBRIDGE_LANDMARK_FIXTURE:-}" 

