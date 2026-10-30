#import "SBCallFrameProcessor.h"
#import <react-native-webrtc/ProcessorProvider.h>
#import <WebRTC/RTCCVPixelBuffer.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>

@interface SBCallFrameProcessor () <VideoFrameProcessorDelegate>
@property(nonatomic, copy) void (^handler)(CVPixelBufferRef, NSInteger);
@end

@implementation SBCallFrameProcessor
static SBCallFrameProcessor *sharedProcessor;
static BOOL audioPrepared = NO;
static AVAudioSessionCategoryOptions originalAudioOptions;
static NSString *originalAudioMode;
+ (void)prepareCallAudio {
  @synchronized(self) {
    if (audioPrepared) return;
    RTCAudioSessionConfiguration *configuration = [RTCAudioSessionConfiguration webRTCConfiguration];
    originalAudioOptions = configuration.categoryOptions;
    originalAudioMode = configuration.mode;
    configuration.categoryOptions |= AVAudioSessionCategoryOptionDefaultToSpeaker;
    configuration.mode = AVAudioSessionModeVideoChat;
    [RTCAudioSessionConfiguration setWebRTCConfiguration:configuration];
    audioPrepared = YES;
  }
}
+ (void)restoreCallAudio {
  @synchronized(self) {
    if (!audioPrepared) return;
    RTCAudioSessionConfiguration *configuration = [RTCAudioSessionConfiguration webRTCConfiguration];
    configuration.categoryOptions = originalAudioOptions;
    configuration.mode = originalAudioMode;
    [RTCAudioSessionConfiguration setWebRTCConfiguration:configuration];
    audioPrepared = NO;
  }
}
+ (void)installHandler:(void (^)(CVPixelBufferRef, NSInteger))handler {
  @synchronized(self) {
    if (!sharedProcessor) sharedProcessor = [SBCallFrameProcessor new];
    sharedProcessor.handler = handler;
    [ProcessorProvider addProcessor:sharedProcessor forName:@"signbridge-captions"];
  }
}
+ (void)uninstall {
  @synchronized(self) { sharedProcessor.handler = nil; }
}
- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
  void (^handler)(CVPixelBufferRef, NSInteger);
  @synchronized([SBCallFrameProcessor class]) { handler = self.handler; }
  if (handler && [frame.buffer isKindOfClass:[RTCCVPixelBuffer class]]) {
    handler(((RTCCVPixelBuffer *)frame.buffer).pixelBuffer, frame.rotation);
  }
  return frame;
}
@end
