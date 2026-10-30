// Next.js calls register() once when a server instance starts. Helpdesk's
// daily in-process jobs (v5 Part G: the 180-day raw-text retention) start
// here; startHelpdeskBackgroundJobs returns at once (the first tick comes a few
// minutes later), so startup is never blocked. Node.js runtime only.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startHelpdeskBackgroundJobs } = await import("./modules/helpdesk/runtime");
    startHelpdeskBackgroundJobs();
  }
}
