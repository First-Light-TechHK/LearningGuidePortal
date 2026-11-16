import { rename, rm } from "node:fs/promises";

export async function replaceLocalFile(temporary: string, destination: string) {
  try {
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, destination); return; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Windows readers can briefly hold the destination open during replacement.
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code || "") || attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
