"use strict";

const { spawn, spawnSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const register = path.join(__dirname, "register-tsconfig-paths.cjs");
const migrate = path.join(__dirname, "migrate-data.ts");

function runMigrate() {
  const env = { ...process.env };
  const args = ["--require", register, migrate, "--apply", "--boot"];
  const viaTsx = spawnSync(process.execPath, ["--import", "tsx", ...args], { cwd: root, env, stdio: "inherit" });
  if (viaTsx.status === 0) return;
  const viaStrip = spawnSync(process.execPath, ["--experimental-strip-types", ...args], { cwd: root, env, stdio: "inherit" });
  if (viaStrip.status !== 0) process.exit(viaStrip.status || viaTsx.status || 1);
}

runMigrate();
const child = spawn(
  process.execPath,
  ["--dns-result-order=ipv4first", path.join(root, "node_modules/next/dist/bin/next"), "start", ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit" },
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
