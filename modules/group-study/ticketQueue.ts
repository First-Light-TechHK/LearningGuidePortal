// Work that must run one at a time in the order it was received, where each piece
// first needs slow preparation that nobody else should have to wait inside.
//
// The ticket is taken when enter() is called, before anything asynchronous, so the
// order cannot depend on whose preparation finishes first. Preparations run side by
// side; the work runs strictly in turn. A preparation that outlasts maxPrepareMs
// gives up its place, not its request: it rejoins at the back once it finishes, and
// nobody behind it waits for it any longer. Per process: instances do not share it.
export type TicketQueue = {
  enter<P, T>(key: string, prepare: () => Promise<P>, run: (prepared: P) => Promise<T>): Promise<T>;
  /** Keys with work outstanding. Back to 0 once everything has settled. */
  size(): number;
};

export type QueueTimer = { elapsed: Promise<void>; cancel: () => void };

function realTimer(ms: number): QueueTimer {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
    handle.unref?.();
  });
  return { elapsed, cancel: () => clearTimeout(handle) };
}

export function createTicketQueue(options: { maxPrepareMs: number; timer?: (ms: number) => QueueTimer }): TicketQueue {
  const tails = new Map<string, Promise<void>>();
  const startTimer = options.timer ?? realTimer;

  // Steps never reject: each one reports to its own caller.
  function inTurn(key: string, step: () => Promise<void>) {
    const tail = (tails.get(key) ?? Promise.resolve()).then(step);
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  }

  return {
    size: () => tails.size,
    enter<P, T>(key: string, prepare: () => Promise<P>, run: (prepared: P) => Promise<T>) {
      return new Promise<T>((resolve, reject) => {
        const work = (prepared: P) => async () => {
          try { resolve(await run(prepared)); } catch (error) { reject(error); }
        };
        const prepared = prepare();
        const timer = startTimer(options.maxPrepareMs);
        const ready = Promise.race([
          prepared.then((value) => ({ state: "ready" as const, value }), () => ({ state: "failed" as const })),
          timer.elapsed.then(() => ({ state: "late" as const })),
        ]);
        void ready.then(timer.cancel);
        inTurn(key, async () => {
          const outcome = await ready;
          if (outcome.state === "ready") await work(outcome.value)();
          else if (outcome.state === "failed") prepared.catch(reject);
          else void prepared.then((value) => inTurn(key, work(value)), reject);
        });
      });
    },
  };
}
