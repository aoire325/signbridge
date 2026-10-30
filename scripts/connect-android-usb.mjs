import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Reconnecting USB removes reverse mappings. Restore them and reopen the
// installed development client without rebuilding or depending on Wi-Fi.
async function main() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library/Android/sdk'), join(homedir(), 'Android/Sdk'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android/Sdk')].filter(Boolean);
  const adb = sdkRoots.map((root) => join(root, 'platform-tools', executable)).find(existsSync) ?? executable;
  const run = (args) => execFileSync(adb, args, { encoding: 'utf8', timeout: 10000 }).trim();
  const entries = run(['devices']).split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/)).filter(([id]) => id);
  const ready = entries.filter(([, state]) => state === 'device').map(([id]) => id);
  const device = process.env.ANDROID_SERIAL || (ready.length === 1 ? ready[0] : null);
  if (!device || !ready.includes(device)) {
    throw new Error(entries.some(([, state]) => state === 'unauthorized')
      ? 'Unlock your Android phone and accept Allow USB debugging, then run this command again.'
      : ready.length > 1 ? 'More than one Android device is connected. Set ANDROID_SERIAL to the phone you want.'
        : 'No Android phone is connected for USB debugging. Connect a data cable, unlock the phone, and run this command again.');
  }
  const port = Number(process.env.SIGNBRIDGE_METRO_PORT || 8081);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SIGNBRIDGE_METRO_PORT must be a valid port.');
  const origin = `http://127.0.0.1:${port}`;
  let status;
  try { status = await fetch(`${origin}/status`, { signal: AbortSignal.timeout(5000) }); }
  catch { throw new Error(`The development server is not running on port ${port}. Run npm start first, then run npm run android:connect.`); }
  if (!status.ok || !(await status.text()).includes('packager-status:running')) throw new Error(`Port ${port} is not serving Metro. Start SignBridge with npm start.`);
  for (const forwarded of new Set([port, 8787])) run(['-s', device, 'reverse', `tcp:${forwarded}`, `tcp:${forwarded}`]);
  const url = `signbridge://?__expo_url=${encodeURIComponent(origin)}`;
  console.log(run(['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url, 'com.signbridge.asl']));
  console.log(`SignBridge opened through USB on ${origin}. Keep the data cable connected.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
