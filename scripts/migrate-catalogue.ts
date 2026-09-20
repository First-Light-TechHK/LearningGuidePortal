import { spawn } from "node:child_process";
import path from "node:path";

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--require", path.join(__dirname, "register-tsconfig-paths.cjs"), path.join(__dirname, "migrate-data.ts"), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
