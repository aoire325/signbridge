import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('react-native-fast-tflite/package.json'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (pkg.version !== '3.0.1') throw new Error(`Recheck the large-model loader patch for fast-tflite ${pkg.version}.`);
const android = join(root, 'android/src/main/java/com/margelo/nitro/tflite/HybridAssetLoader.kt');
const ios = join(root, 'ios/HybridAssetLoader.swift');
const kotlin = await readFile(android, 'utf8');
if (!kotlin.includes('SignBridge: map large local models')) {
  const before = 'val bytes = URL(path).readBytes()\n      return@async ArrayBuffer.copy(bytes)';
  if (!kotlin.includes(before)) throw new Error('Unexpected Android asset loader; patch not applied.');
  const after = `// SignBridge: map large local models without a model-sized Java heap copy.
      val url = URL(path)
      val temporary = url.protocol != "file"
      val file = if (temporary) java.io.File.createTempFile("tflite-", ".bin") else java.io.File(url.toURI())
      try {
        if (temporary) url.openStream().use { input -> file.outputStream().use { output -> input.copyTo(output, 65536) } }
        val mapped = java.io.RandomAccessFile(file, "r").use { handle ->
          require(handle.length() > 0 && handle.length() <= Int.MAX_VALUE) { "Invalid model file size." }
          handle.channel.map(java.nio.channels.FileChannel.MapMode.READ_ONLY, 0, handle.length())
        }
        return@async ArrayBuffer.wrap(mapped)
      } finally { if (temporary) file.delete() }`;
  await writeFile(android, kotlin.replace(before, after));
}
const swift = await readFile(ios, 'utf8');
if (!swift.includes('SignBridge: bounded local-file loading')) {
  const before = 'let data = try Data(contentsOf: url)\n      return try ArrayBuffer.copy(data: data)';
  if (!swift.includes(before)) throw new Error('Unexpected iOS asset loader; patch not applied.');
  const after = `// SignBridge: bounded local-file loading avoids a second model-sized Data copy.
      if url.isFileURL {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let size = try handle.seekToEnd()
        guard size > 0, size <= UInt64(Int.max) else {
          throw NSError(domain: "AssetLoader", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid model file size."])
        }
        try handle.seek(toOffset: 0)
        let buffer = ArrayBuffer.allocate(size: Int(size))
        var offset = 0
        while offset < Int(size) {
          let chunk = try handle.read(upToCount: min(65536, Int(size) - offset)) ?? Data()
          guard !chunk.isEmpty else {
            throw NSError(domain: "AssetLoader", code: 3, userInfo: [NSLocalizedDescriptionKey: "Incomplete model file."])
          }
          chunk.withUnsafeBytes { bytes in
            if let address = bytes.baseAddress { memcpy(buffer.data.advanced(by: offset), address, chunk.count) }
          }
          offset += chunk.count
        }
        return buffer
      }
      let data = try Data(contentsOf: url)
      return try ArrayBuffer.copy(data: data)`;
  await writeFile(ios, swift.replace(before, after));
} 

