#import <Foundation/Foundation.h>
#import <CoreVideo/CoreVideo.h>

NS_ASSUME_NONNULL_BEGIN
// Keep WebRTC's Objective-C headers behind this small adapter. The tracker
// consumes the existing call capture; it never opens a second camera.
@interface SBCallFrameProcessor : NSObject
+ (void)installHandler:(void (^)(CVPixelBufferRef buffer, NSInteger rotation))handler NS_SWIFT_NAME(install(handler:));
+ (void)uninstall;
+ (void)prepareCallAudio;
+ (void)restoreCallAudio;
@end
NS_ASSUME_NONNULL_END
