package expo.modules.signbridgetracker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SignBridgeTrackerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SignBridgeTracker")
    View(SignBridgeTrackerView::class) {
      Events("onLandmarks", "onReady", "onPreviewReady", "onError")
      Prop("facing") { view: SignBridgeTrackerView, facing: String ->
        view.facing = facing
      }
    }
  }
} 

