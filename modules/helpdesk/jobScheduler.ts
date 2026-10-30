// Helpdesk v5 Part G: the in-process loop that runs Portal's daily jobs
// (no new ops config, no external scheduler). Every instance runs the loop;
// the job itself decides whether there is anything to do (its lock and its
// run row for the day), so the loop only needs to tick now and then.
// - start returns at once: the first tick comes after a delay, so startup is
//   never blocked or slowed;
// - the next tick is scheduled only after the current one finished, so two
//   ticks of one job never overlap in a process;
// - a failing tick is logged (the error code only) and the loop goes on;
// - the timers are unref'd, so they never keep a process alive.

export type LoopTimers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };

const NODE_TIMERS: LoopTimers = {
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); }
};

export function startJobLoop(options: { name: string; tick: () => Promise<unknown>; firstDelayMs: number; intervalMs: number; timers?: LoopTimers; log?: (line: Record<string, unknown>) => void }): { stop(): void } {
  const timers = options.timers ?? NODE_TIMERS;
  const log = options.log ?? ((line: Record<string, unknown>) => console.info(JSON.stringify(line)));
  let handle: unknown = null;
  let stopped = false;

  const schedule = (ms: number) => {
    if (stopped) return;
    handle = timers.setTimeout(() => { handle = null; void run(); }, ms);
  };

  async function run() {
    try {
      await options.tick();
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      log({ type: "helpdesk", event: "job_tick_failed", job: options.name, error: typeof code === "string" && code.length <= 64 ? code : error instanceof Error ? error.name : "unknown" });
    }
    schedule(options.intervalMs);
  }

  schedule(options.firstDelayMs);
  return {
    stop() {
      stopped = true;
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
    }
  };
}
