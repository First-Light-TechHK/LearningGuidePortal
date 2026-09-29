export type ShellViewerModel = { name: string; role: string };

/** Name and role already on the signed-in user. An empty name is not a person. */
export function shellViewerFromUser(user: { nickname?: string | null; role?: string | null } | null | undefined): ShellViewerModel | null {
  const name = typeof user?.nickname === "string" ? user.nickname.trim() : "";
  if (!name) return null;
  const role = typeof user?.role === "string" ? user.role.trim() : "";
  return { name, role };
}
