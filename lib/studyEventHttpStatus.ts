export function studyEventHttpStatus(error: unknown) {
  return error instanceof Error && ["Course access is required.", "Preview lessons cannot be completed."].includes(error.message) ? 403 : 400;
}
