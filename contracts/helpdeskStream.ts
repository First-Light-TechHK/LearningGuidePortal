// Helpdesk contract v7: the streamed assistant answer (the chat's Thinking card). No server-only imports, so the
// browser bundle can use it too (contracts/helpdesk.ts pulls in Node modules).

/**
 * The steps Admin's assist workflow announces while it works (contract v7, Accept: text/event-stream): only the step
 * name, never model text. The chat shows a fixed line per step (the "thinking" card); an unknown name is ignored.
 */
export const ASSISTANT_STEPS = ["retrieve", "pick", "explain", "route", "smalltalk", "ground"] as const;
export type AssistantStep = (typeof ASSISTANT_STEPS)[number];
export const isAssistantStep = (value: unknown): value is AssistantStep => typeof value === "string" && (ASSISTANT_STEPS as readonly string[]).includes(value);

/** One server-sent event of a streamed answer: its name and the raw data line(s). */
export type ServerSentEvent = { event: string; data: string };

/**
 * Incremental text/event-stream parser (WHATWG rules we need: event and data fields, blank line ends an event,
 * comments ignored). push() takes the next chunk and returns the events it completed.
 */
export function createEventStreamParser() {
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  return {
    push(chunk: string): ServerSentEvent[] {
      buffer += chunk;
      const done: ServerSentEvent[] = [];
      let newline: number;
      while ((newline = buffer.search(/\r\n|\n|\r/)) >= 0) {
        // a lone \r at the end may be the first half of \r\n: wait for the next chunk
        if (buffer[newline] === "\r" && newline === buffer.length - 1) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
        if (line === "") {
          if (data.length) done.push({ event, data: data.join("\n") });
          event = "message";
          data = [];
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      return done;
    }
  };
}
