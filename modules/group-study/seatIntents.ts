// The room page's seat intents, kept out of the component so their ordering
// is unit-testable (QA3 room review F1, F3, F5).
//
// The seat is the server's: the page only says what it wants (enter, renew,
// leave). Two rules make those intents arrive in an order the server can act
// on:
// - one at a time, in the order the page sent them: a Leave sent while an
//   entry is on its way goes out only once the entry has been answered, so the
//   server never takes the Leave first and then seats the page again (F5);
// - once the page has left (Leave Session, a breadcrumb, the page hidden for
//   good) it never enters or renews again; only another Leave still goes out
//   (F1, F5).
// Every intent gives up after `timeoutMs`, so a request stalled by a sleeping
// device answers as a network failure instead of holding every later renewal
// back (F3).

export type SeatIntent = "enter" | "heartbeat" | "leave";
export type SeatAnswer<T> = { ok: boolean; code: string; message: string; data: T };

// Well inside the 30 s seat lease and the 10 s heartbeat interval.
export const SEAT_INTENT_TIMEOUT_MS = 8_000;

// The answer an intent gets when the page left before it could go out.
export const SEAT_INTENT_LEFT = "left";

function failure<T>(code: string): SeatAnswer<T> {
  return { ok: false, code, message: "", data: null as T };
}

export function createSeatIntents(input: {
  send: (intent: SeatIntent, signal: AbortSignal) => Promise<SeatAnswer<unknown>>;
  hasLeft: () => boolean;
  timeoutMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? SEAT_INTENT_TIMEOUT_MS;
  let tail: Promise<unknown> = Promise.resolve();
  return function seatIntent<T>(intent: SeatIntent): Promise<SeatAnswer<T>> {
    const run = tail.then(async (): Promise<SeatAnswer<T>> => {
      if (intent !== "leave" && input.hasLeft()) return failure<T>(SEAT_INTENT_LEFT);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<SeatAnswer<T>>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(failure<T>("network"));
        }, timeoutMs);
      });
      try {
        return await Promise.race([input.send(intent, controller.signal) as Promise<SeatAnswer<T>>, expired]);
      } catch {
        return failure<T>("network");
      } finally {
        clearTimeout(timer);
      }
    });
    tail = run;
    return run;
  };
}

// A signal that aborts a request after `ms`, where the browser can (older
// Safari has no AbortSignal.timeout; the request then simply runs on).
export function deadlineSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}
