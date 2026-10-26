// Read-only projection for refreshing public navigation after authentication.
export type PortalSessionIdentity = { id: string; nickname: string; avatarUrl: string | null };
export type PortalSessionResponse = { ok: boolean; user: PortalSessionIdentity | null };
