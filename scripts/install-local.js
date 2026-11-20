// Installs the packaged .vsix into the local VS Code.
// NODE_OPTIONS=--no-deprecation hides a DEP0169 (url.parse) warning printed by
// the VS Code CLI itself, not by this extension.
const { spawnSync } = require("child_process");
const { name, version } = require("../package.json");

const vsix = `${name}-${version}.vsix`;
const result = spawnSync("code", ["--install-extension", vsix, "--force"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_OPTIONS: "--no-deprecation" },
});
process.exit(result.status ?? 1);
