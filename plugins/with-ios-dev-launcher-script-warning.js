const fs = require("fs");
const path = require("path");
const xcode = require("xcode");
const { withFinalizedMod } = require("expo/config-plugins");

const PHASE_NAME = "[Expo Dev Launcher] Strip Local Network Keys for Release";

module.exports = function withDevLauncherScriptWarningFix(config) {
  return withFinalizedMod(config, [
    "ios",
    async (config) => {
      const projectName = config.modRequest.projectName;
      if (!projectName) {
        throw new Error("Could not determine the iOS Xcode project name.");
      }

      const projectPath = path.join(
        config.modRequest.platformProjectRoot,
        `${projectName}.xcodeproj`,
        "project.pbxproj"
      );
      const project = xcode.project(projectPath);
      project.parseSync();

      const phases =
        project.hash.project.objects.PBXShellScriptBuildPhase || {};
      const phase = Object.values(phases).find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          String(candidate.name || "").includes(PHASE_NAME)
      );

      if (!phase) {
        throw new Error(`Could not find Xcode build phase: ${PHASE_NAME}`);
      }

      // This plist cleanup is intentionally run on every build.
      // Mark that behavior explicitly to silence Xcode's ambiguous-dependencies warning.
      phase.alwaysOutOfDate = "1";
      fs.writeFileSync(projectPath, project.writeSync());

      return config;
    },
  ]);
}; 

