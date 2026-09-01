import { access, copyFile } from "node:fs/promises";
import { constants } from "node:fs";

try {
  await access(".env.local", constants.F_OK);
  console.log(".env.local already exists; no file was changed.");
} catch {
  await copyFile(".env.example", ".env.local");
  console.log("Created .env.local from .env.example. Add secrets locally before starting Next.js.");
}
