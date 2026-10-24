import Foundation
import UIKit
import MediaPipeTasksVision
import TensorFlowLiteC

struct SmokeError: Error { let message: String }
func check(_ value: Bool, _ message: String) throws { if !value { throw SmokeError(message: message) } }
let root = CommandLine.arguments[1]

func bytes<T>(_ values: [T]) -> Data { values.withUnsafeBytes { Data($0) } }

func invokeSentenceModel(_ name: String, inputs: [String: Data]) throws -> Data {
  guard let model = TfLiteModelCreateFromFile(root + "/assets/models/" + name + ".tflite") else { throw SmokeError(message: "Sentence model creation failed: \(name)") }
  defer { TfLiteModelDelete(model) }
  guard let interpreter = TfLiteInterpreterCreate(model, nil) else { throw SmokeError(message: "Sentence interpreter creation failed: \(name)") }
  defer { TfLiteInterpreterDelete(interpreter) }
  try check(TfLiteInterpreterAllocateTensors(interpreter) == kTfLiteOk, "Sentence tensors did not allocate")
  for index in 0..<TfLiteInterpreterGetInputTensorCount(interpreter) {
    guard let tensor = TfLiteInterpreterGetInputTensor(interpreter, index), let tensorName = TfLiteTensorName(tensor) else { throw SmokeError(message: "Sentence input missing") }
    let key = String(cString: tensorName).split(separator: ":")[0].split(separator: "/").last.map(String.init)!
    guard let data = inputs[key] else { throw SmokeError(message: "Unexpected input: \(key)") }
    try check(data.count == TfLiteTensorByteSize(tensor), "Sentence input size mismatch")
    let copied = data.withUnsafeBytes { TfLiteTensorCopyFromBuffer(tensor, $0.baseAddress, $0.count) }
    try check(copied == kTfLiteOk, "Sentence input copy failed")
  }
  try check(TfLiteInterpreterInvoke(interpreter) == kTfLiteOk, "Sentence inference failed")
  guard let output = TfLiteInterpreterGetOutputTensor(interpreter, 0) else { throw SmokeError(message: "Sentence output missing") }
  var data = Data(count: Int(TfLiteTensorByteSize(output)))
  let copied = data.withUnsafeMutableBytes { TfLiteTensorCopyToBuffer(output, $0.baseAddress, $0.count) }
  let finite = data.withUnsafeBytes { pointer in
    stride(from: 0, to: data.count, by: 4).allSatisfy { pointer.loadUnaligned(fromByteOffset: $0, as: Float.self).isFinite }
  }
  try check(copied == kTfLiteOk && finite, "Invalid sentence output")
  return data
}

func checkWordRuntime(_ name: String, classes: Int) throws {
  guard let model = TfLiteModelCreateFromFile(root + "/assets/models/" + name + ".tflite") else { throw SmokeError(message: "Word model creation failed: \(name)") }
  defer { TfLiteModelDelete(model) }
  guard let interpreter = TfLiteInterpreterCreate(model, nil) else { throw SmokeError(message: "Word interpreter creation failed") }
  defer { TfLiteInterpreterDelete(interpreter) }
  try check(TfLiteInterpreterAllocateTensors(interpreter) == kTfLiteOk, "Word tensors did not allocate")
  guard let input = TfLiteInterpreterGetInputTensor(interpreter, 0) else { throw SmokeError(message: "Input missing") }
  let values = [Float](repeating: 0, count: Int(TfLiteTensorByteSize(input)) / MemoryLayout<Float>.size)
  let copied = values.withUnsafeBytes { TfLiteTensorCopyFromBuffer(input, $0.baseAddress, $0.count) }
  try check(copied == kTfLiteOk, "Input copy failed")
  try check(TfLiteInterpreterInvoke(interpreter) == kTfLiteOk, "Word inference failed")
  guard let output = TfLiteInterpreterGetOutputTensor(interpreter, 0) else { throw SmokeError(message: "Output missing") }
  var scores = [Float](repeating: 0, count: Int(TfLiteTensorByteSize(output)) / MemoryLayout<Float>.size)
  let read = scores.withUnsafeMutableBytes { TfLiteTensorCopyToBuffer(output, $0.baseAddress, $0.count) }
  try check(read == kTfLiteOk && scores.count == classes && scores.allSatisfy(\.isFinite), "Invalid word output: \(name)")
  print("\(name): \(classes) finite outputs")
}

do {
  try checkWordRuntime("asl_words_citizen", classes: 2731)
  try checkWordRuntime("asl_words_2000", classes: 2000)
  let mask = bytes([Float](repeating: 1, count: 96))
  let hidden = try invokeSentenceModel("asl_sentence_encoder", inputs: [
    "features": bytes([Float](repeating: 0, count: 96 * 208)), "mask": mask,
  ])
  try check(hidden.count == 96 * 768 * 4, "Sentence encoder shape mismatch")
  let logits = try invokeSentenceModel("asl_sentence_decoder", inputs: [
    "hidden": hidden, "mask": mask,
    "tokens": bytes([Int32](repeating: 0, count: 64)), "position": bytes([Int32(0)]),
  ])
  try check(logits.count == 32128 * 4, "Sentence decoder shape mismatch")
  print("Sentence encoder and decoder: finite outputs from one synthetic decoding step")
  let handOptions = HandLandmarkerOptions()
  handOptions.baseOptions.modelAssetPath = root + "/modules/signbridge-tracker/models/hand_landmarker.task"
  handOptions.runningMode = .video
  let hands = try HandLandmarker(options: handOptions)
  let poseOptions = PoseLandmarkerOptions()
  poseOptions.baseOptions.modelAssetPath = root + "/modules/signbridge-tracker/models/pose_landmarker_lite.task"
  poseOptions.runningMode = .video
  let pose = try PoseLandmarker(options: poseOptions)
  let faceOptions = FaceLandmarkerOptions()
  faceOptions.baseOptions.modelAssetPath = root + "/modules/signbridge-tracker/models/face_landmarker.task"
  faceOptions.runningMode = .video
  faceOptions.outputFaceBlendshapes = true
  let face = try FaceLandmarker(options: faceOptions)
  let image = UIGraphicsImageRenderer(size: CGSize(width: 256, height: 256)).image { context in
    UIColor.black.setFill(); context.fill(CGRect(x: 0, y: 0, width: 256, height: 256))
  }
  let frame = try MPImage(uiImage: image)
  _ = try hands.detect(videoFrame: frame, timestampInMilliseconds: 1)
  _ = try pose.detect(videoFrame: frame, timestampInMilliseconds: 1)
  _ = try face.detect(videoFrame: frame, timestampInMilliseconds: 1)
  print("MediaPipe: hand, pose and face graphs initialized and ran")
  if CommandLine.arguments.count > 2 && !CommandLine.arguments[2].isEmpty {
    guard let portrait = UIImage(contentsOfFile: CommandLine.arguments[2]), let pixels = portrait.cgImage else {
      throw SmokeError(message: "Cannot read the optional public portrait fixture")
    }
    let portraitFrame = try MPImage(uiImage: portrait)
    let portraitHands = try hands.detect(videoFrame: portraitFrame, timestampInMilliseconds: 34)
    let portraitPose = try pose.detect(videoFrame: portraitFrame, timestampInMilliseconds: 34)
    let portraitFace = try face.detect(videoFrame: portraitFrame, timestampInMilliseconds: 34)
    try check(!(portraitHands.landmarks.isEmpty), "Portrait fixture should contain a visible hand")
    try check(portraitPose.landmarks.first?.count == 33, "Portrait fixture body landmarks missing")
    try check((portraitFace.faceLandmarks.first?.count ?? 0) >= 468, "Portrait fixture face landmarks missing")
    try check(!(portraitFace.faceBlendshapes.first?.categories.isEmpty ?? true), "Expression coefficients missing")
    print("Public portrait fixture: hands, 33 body points, face mesh and expression coefficients detected together")
    // Exercise a hands-out view of the SAME public test image in memory. No
    // processed image or user recording is stored by this test.
    guard let upperCrop = pixels.cropping(to: CGRect(x: 0, y: 0, width: CGFloat(pixels.width), height: CGFloat(pixels.height) * 0.55)) else {
      throw SmokeError(message: "Could not construct the hands-out fixture")
    }
    let handsOutFrame = try MPImage(uiImage: UIImage(cgImage: upperCrop))
    for timestamp in [67, 100, 133] {
      let noHands = try hands.detect(videoFrame: handsOutFrame, timestampInMilliseconds: timestamp)
      let body = try pose.detect(videoFrame: handsOutFrame, timestampInMilliseconds: timestamp)
      let facial = try face.detect(videoFrame: handsOutFrame, timestampInMilliseconds: timestamp)
      try check(noHands.landmarks.isEmpty, "Hands-out fixture unexpectedly has a hand")
      try check(body.landmarks.first?.count == 33, "Body tracking stopped without hands")
      try check((facial.faceLandmarks.first?.count ?? 0) >= 468, "Face tracking stopped without hands")
    }
    print("Hands-out fixture: face and body detected on three consecutive frames with zero hands")
  }
  try withExtendedLifetime((hands, pose, face)) {
    try checkWordRuntime("asl_words_citizen", classes: 2731)
    try checkWordRuntime("asl_words_2000", classes: 2000)
  }
  print("PASS: both ML runtimes work in one iOS simulator process")
} catch {
  print("FAIL: \(error)")
  exit(1)
} 

