export function studyEventHttpStatus(error: unknown) {
  return error instanceof Error && error.message === "Course access is required." ? 403 : 400;
}
