# MediaPipe's protobuf lite messages look up generated fields by their original names.
# https://github.com/protocolbuffers/protobuf/blob/main/java/lite/proguard.pgcfg
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite {
  <fields>;
}

# The Tasks JNI bridge and graph options also resolve MediaPipe types at runtime.
-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }

# Flogger discovers its caller on the stack; R8 inlining breaks Graph's initializer.
# https://github.com/google-ai-edge/mediapipe/issues/6138
-keep class com.google.common.flogger.** { *; }

# Optional graph profiling/template APIs are not shipped by tasks-core or used here.
-dontwarn com.google.mediapipe.proto.CalculatorProfileProto$CalculatorProfile
-dontwarn com.google.mediapipe.proto.GraphTemplateProto$CalculatorGraphTemplate

