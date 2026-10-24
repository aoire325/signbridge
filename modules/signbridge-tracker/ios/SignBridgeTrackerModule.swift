import ExpoModulesCore

public final class SignBridgeTrackerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SignBridgeTracker")
    View(SignBridgeTrackerView.self) {
      Events("onLandmarks", "onReady", "onPreviewReady", "onError")
      Prop("facing") { (view: SignBridgeTrackerView, facing: String) in
        view.facing = facing
      }
    }
  }
} 

