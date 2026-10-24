require 'fileutils'
require 'open3'
require 'tmpdir'

# MediaPipe 0.10.35 embeds a newer TFLite runtime. TensorFlowLiteC 2.17.0
# provides a single merged Mach-O object per architecture. Localizing its
# overlapping internal exports binds its own references to its own runtime;
# the public model/interpreter/tensor I/O API remains global for NitroTflite.
# Do not strip objects from MediaPipe or allow duplicate definitions: those
# approaches can mix incompatible runtime implementations at link time.
module SignBridgeTfliteIsolation
  REQUIRED_API = %w[
    _TfLiteModelCreate _TfLiteModelDelete
    _TfLiteInterpreterOptionsCreate _TfLiteInterpreterOptionsDelete
    _TfLiteInterpreterOptionsAddDelegate
    _TfLiteInterpreterCreate _TfLiteInterpreterDelete
    _TfLiteInterpreterAllocateTensors _TfLiteInterpreterInvoke
    _TfLiteInterpreterGetInputTensor _TfLiteInterpreterGetInputTensorCount
    _TfLiteInterpreterGetOutputTensor _TfLiteInterpreterGetOutputTensorCount
    _TfLiteTensorCopyFromBuffer _TfLiteTensorData _TfLiteTensorDim
    _TfLiteTensorName _TfLiteTensorNumDims _TfLiteTensorType
  ].freeze

  def self.run(*args)
    output, error, status = Open3.capture3(*args)
    raise "TFLite isolation failed (#{args.first}): #{error}" unless status.success?
    output
  end

  def self.exports(binary, arch)
    run('xcrun', 'nm', '-arch', arch, '-gjU', binary.to_s).lines.map(&:strip)
      .select { |name| name.start_with?('_TfLite') }.uniq
  end

  def self.apply(installer)
    versions = installer.pod_targets.to_h { |target| [target.root_spec.name, target.root_spec.version.to_s] }
    return unless versions.key?('TensorFlowLiteC') && versions.key?('MediaPipeTasksCommon')
    unless versions['TensorFlowLiteC'] == '2.17.0' && versions['MediaPipeTasksCommon'] == '0.10.35'
      raise 'Revalidate TFLite symbol isolation before changing TensorFlowLiteC 2.17.0 or MediaPipeTasksCommon 0.10.35.'
    end
    selected_specs = installer.pod_targets.select { |target| target.root_spec.name == 'TensorFlowLiteC' }
      .flat_map { |target| target.specs.map(&:name) }.uniq
    unless (selected_specs - %w[TensorFlowLiteC TensorFlowLiteC/Core]).empty?
      raise 'Revalidate TFLite symbol isolation before enabling additional iOS delegate subspecs; this integration uses the CPU Core runtime.'
    end
    pods = installer.sandbox.root
    binaries = Dir.glob(File.join(pods, 'TensorFlowLiteC/Frameworks/TensorFlowLiteC.xcframework/*/TensorFlowLiteC.framework/TensorFlowLiteC'))
    raise 'TensorFlowLiteC framework binaries were not found during pod installation.' if binaries.empty?
    allowed = File.readlines(File.join(__dir__, 'ios-tflite-internal-symbols.txt'), chomp: true)
    binaries.each do |binary|
      # This operation is safe only on the single merged object distributed by
      # this pinned pod, where internal references share the same symbol table.
      headers = run('xcrun', 'otool', '-hv', binary)
      raise "Expected a merged Mach-O object: #{binary}" unless headers.include?('OBJECT') && !headers.include?('DYLIB')
      simulator = binary.include?('-simulator/')
      graph = File.join(pods, 'MediaPipeTasksCommon/frameworks/graph_libraries',
        simulator ? 'libMediaPipeTasksCommon_simulator_graph.a' : 'libMediaPipeTasksCommon_device_graph.a')
      arches = run('xcrun', 'lipo', '-archs', binary).split
      original = arches.to_h { |arch| [arch, exports(binary, arch)] }
      arches.each do |arch|
        raise "TFLite public API is missing for #{arch}." unless (REQUIRED_API - original[arch]).empty?
      end
      overlaps = arches.flat_map { |arch| original[arch] & exports(graph, arch) }.uniq
      next if overlaps.empty? # Already isolated by a previous pod install.
      unexpected = overlaps - allowed
      raise "Unreviewed overlapping TFLite symbols: #{unexpected.join(', ')}" unless unexpected.empty?
      raise 'TFLite isolation would hide an API required by the recognizer.' unless (overlaps & REQUIRED_API).empty?
      Dir.mktmpdir('signbridge-tflite-') do |temporary|
        private_list = File.join(temporary, 'internal-symbols.txt')
        File.write(private_list, overlaps.sort.join("\n") + "\n")
        candidate = File.join(temporary, 'TensorFlowLiteC')
        FileUtils.cp(binary, candidate)
        File.chmod(0o644, candidate)
        # nmedit operates on every slice of a universal object, including both
        # arm64 and x86_64 simulators; no simulator architecture is excluded.
        run('xcrun', 'nmedit', '-R', private_list, candidate)
        arches.each do |arch|
          updated = exports(candidate, arch)
          raise "TFLite public API was lost for #{arch}." unless (REQUIRED_API - updated).empty?
          raise "TFLite symbol isolation was incomplete for #{arch}." unless (updated & exports(graph, arch)).empty?
          raise "Unrelated TFLite exports changed for #{arch}." unless (original[arch] - updated).sort == (original[arch] & overlaps).sort
        end
        replacement = "#{binary}.signbridge-isolated"
        begin
          FileUtils.cp(candidate, replacement)
          File.rename(replacement, binary)
        ensure
          FileUtils.rm_f(replacement)
        end
      end
      Pod::UI.puts "[SignBridge] Isolated #{overlaps.length} TFLite internal symbols (#{simulator ? 'simulator' : 'device'}: #{arches.join(', ')})."
    end
  end
end 

