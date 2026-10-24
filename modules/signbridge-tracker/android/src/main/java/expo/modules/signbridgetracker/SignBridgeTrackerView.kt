package expo.modules.signbridgetracker

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** Camera buffers stay on a single native worker. Only landmarks cross into JS. */
class SignBridgeTrackerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // PreviewView creates its TextureView after binding; honor its layout requests.
  override val shouldUseAndroidLayout = true
  private val onLandmarks by EventDispatcher()
  private val onReady by EventDispatcher()
  private val onPreviewReady by EventDispatcher()
  private val onError by EventDispatcher()
  var facing = "front"
  private val worker = TrackerModels.worker
  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FIT_CENTER
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
  }
  private var provider: ProcessCameraProvider? = null
  private var preview: Preview? = null
  private var analysis: ImageAnalysis? = null
  private var owner: LifecycleOwner? = null
  @Volatile private var closed = false
  private var hands: HandLandmarker? = null
  private var pose: PoseLandmarker? = null
  private var face: FaceLandmarker? = null
  private var modelLease = false
  private val previewObserver = Observer<PreviewView.StreamState> { state ->
    if (!closed && state == PreviewView.StreamState.STREAMING) {
      onPreviewReady(emptyMap<String, Any>())
    }
  }
  private var lastTimestamp = -100L
  private var ready = false
  private val lifecycleObserver = object : DefaultLifecycleObserver {
    override fun onStop(owner: LifecycleOwner) { close() }
  }

  init { addView(previewView) }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    previewView.layout(0, 0, right - left, bottom - top)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (closed) return
    owner = appContext.currentActivity as? LifecycleOwner
    val lifecycleOwner = owner ?: return fail("No camera lifecycle is available.")
    lifecycleOwner.lifecycle.addObserver(lifecycleObserver)
    previewView.previewStreamState.observe(lifecycleOwner, previewObserver)
    // Preview startup must not wait for MediaPipe initialization.
    bindCamera(lifecycleOwner)
    worker.execute {
      if (closed) return@execute
      try {
        val models = TrackerModels.acquire(context.applicationContext)
        modelLease = true
        hands = models.hands
        pose = models.pose
        face = models.face
      } catch (error: Exception) {
        Log.e("SignBridgeTracker", "Landmark initialization failed", error)
        fail(error.message ?: "Landmark models could not load.")
      } catch (error: LinkageError) {
        Log.e("SignBridgeTracker", "Native landmark initialization failed", error)
        fail(error.cause?.message ?: error.message ?: "The native landmark runtime could not load.")
      }
    }
  }

  private fun bindCamera(lifecycleOwner: LifecycleOwner) {
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (closed) return@addListener
      try {
        val cameraProvider = future.get()
        provider = cameraProvider
        val resolution = ResolutionSelector.Builder().setResolutionStrategy(
          ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)
        ).build()
        val rotation = display?.rotation ?: 0
        val previewUseCase = Preview.Builder().setResolutionSelector(resolution)
          .setTargetRotation(rotation).build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
        val analysisUseCase = ImageAnalysis.Builder().setResolutionSelector(resolution)
          .setTargetRotation(rotation)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build().also { it.setAnalyzer(worker, ::analyze) }
        preview = previewUseCase
        analysis = analysisUseCase
        cameraProvider.bindToLifecycle(lifecycleOwner,
          if (facing == "front") CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA,
          previewUseCase, analysisUseCase)
      } catch (error: Exception) { fail(error.message ?: "Camera could not start.") }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun points(landmarks: List<NormalizedLandmark>) = landmarks.map {
    mapOf("x" to it.x(), "y" to it.y(), "z" to it.z(), "visibility" to it.visibility().orElse(1f))
  }

  private fun analyze(image: ImageProxy) {
    var bitmap: Bitmap? = null
    var upright: Bitmap? = null
    try {
      val timestamp = SystemClock.uptimeMillis()
      // Preserve motion when the phone can process it. KEEP_ONLY_LATEST and
      // the serial worker still bound work on slower devices.
      if (closed || hands == null || pose == null || face == null || timestamp - lastTimestamp < 33) return
      lastTimestamp = timestamp
      bitmap = image.toBitmap()
      upright = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height,
        Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }, true)
      val input = BitmapImageBuilder(upright).build()
      val payload: Map<String, Any>
      try {
        val handResult = hands!!.detectForVideo(input, timestamp)
        // Run every detector on the same image/timestamp, also during hands-out
        // pauses, so facial and upper-body movement remains available.
        val poseResult = pose!!.detectForVideo(input, timestamp)
        val faceResult = face!!.detectForVideo(input, timestamp)
        val handData = handResult.landmarks().mapIndexed { index, landmarks ->
          val category = handResult.handedness()[index].first()
          mapOf("side" to category.categoryName(), "score" to category.score(), "landmarks" to points(landmarks))
        }
        val blendshapes = faceResult.faceBlendshapes().orElse(emptyList()).firstOrNull()
          ?.associate { it.categoryName() to it.score() } ?: emptyMap()
        payload = mapOf(
          "timestampMs" to timestamp.toDouble(), "width" to upright.width, "height" to upright.height,
          "hands" to handData, "pose" to points(poseResult.landmarks().firstOrNull() ?: emptyList()),
          "face" to points(faceResult.faceLandmarks().firstOrNull() ?: emptyList()),
          "blendshapes" to blendshapes, "inferenceMs" to (SystemClock.uptimeMillis() - timestamp).toDouble())
      } finally { input.close() }
      post {
        if (!closed) {
          if (!ready) { ready = true; onReady(emptyMap<String, Any>()) }
          onLandmarks(payload)
        }
      }
    } catch (error: Exception) {
      fail(error.message ?: "Live tracking failed.")
    } finally {
      if (upright !== bitmap) upright?.recycle()
      bitmap?.recycle()
      image.close()
    }
  }

  private fun fail(message: String) {
    post {
      if (!closed) {
        onError(mapOf("message" to message))
        close()
      }
    }
  }

  private fun close() {
    if (closed) return
    closed = true
    owner?.lifecycle?.removeObserver(lifecycleObserver)
    previewView.previewStreamState.removeObserver(previewObserver)
    analysis?.clearAnalyzer()
    val useCases = listOfNotNull(preview, analysis)
    if (useCases.isNotEmpty()) provider?.unbind(*useCases.toTypedArray())
    // Release after any in-flight inference, on the worker that owns the models.
    worker.execute {
      hands = null; pose = null; face = null
      if (modelLease) { modelLease = false; TrackerModels.release() }
    }
  }

  override fun onDetachedFromWindow() {
    close()
    super.onDetachedFromWindow()
  }
} 

