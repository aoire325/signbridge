Pod::Spec.new do |s|
  s.name = 'SignBridgeTracker'
  s.version = '1.0.0'
  s.summary = 'On-device live signing landmarks for SignBridge'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'SignBridge'
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'MediaPipeTasksVision', '0.10.35'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'SignBridgeModels' => ['models/*.task'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end

