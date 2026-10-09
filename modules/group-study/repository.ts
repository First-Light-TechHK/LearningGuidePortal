import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyStore, type StudyGroupStore } from "./domain";

export type StudyGroupRepository = {
  read(): Promise<StudyGroupStore>;
  appendTokenLog(line: string): Promise<void>;
  update<T>(mutate: (store: StudyGroupStore) => T | Promise<T>): Promise<T>;
};

function withoutMinutes(session: StudyGroupStore["sessions"][number] & { durationMinutes?: number }) {
  const { durationMinutes: _minutes, ...rest } = session;
  return rest;
}

function normalise(value: Partial<StudyGroupStore> | null): StudyGroupStore {
  const base = emptyStore();
  if (!value) return base;
  return {
    groups: value.groups ?? [],
    memberships: value.memberships ?? [],
    sessions: (value.sessions ?? []).map((session) => withoutMinutes(session)),
    intents: value.intents ?? [],
    presences: value.presences ?? [],
    meetings: value.meetings ?? [],
    reminders: value.reminders ?? [],
    tutorRequests: value.tutorRequests ?? []
  };
}

export function createStudyGroupRepository(directory: string): StudyGroupRepository {
  const file = path.join(directory, "study-group.json");
  let chain: Promise<unknown> = Promise.resolve();

  async function read(): Promise<StudyGroupStore> {
    try {
      return normalise(JSON.parse(await readFile(file, "utf8")) as StudyGroupStore);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async function write(store: StudyGroupStore) {
    await mkdir(directory, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(store)}\n`, "utf8");
    await rename(tmp, file);
  }

  async function appendTokenLog(line: string) {
    await mkdir(directory, { recursive: true });
    const logFile = path.join(directory, "token-issuance.log");
    let previous = "";
    try {
      previous = await readFile(logFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(logFile, `${previous}${line}\n`, "utf8");
  }

  return {
    read,
    appendTokenLog,
    update<T>(mutate: (store: StudyGroupStore) => T | Promise<T>) {
      const run = chain.then(async () => {
        const store = await read();
        const result = await mutate(store);
        await write(store);
        return result;
      });
      chain = run.then(() => undefined, () => undefined);
      return run;
    }
  };
}
