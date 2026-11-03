export type EmailBindingRequest = { email: string; locale?: "en-GB" | "zh-CN"; returnTo?: string };
export type EmailBindingConfirmation = { token: string; confirmed?: boolean; returnTo?: string; locale?: "en-GB" | "zh-CN" };

/** Server-pinned identities; none of these IDs are accepted from the browser. */
export type EmailBindingIdentity = {
  accountId?: string;
  targetUserId?: string | null;
  completedUserId?: string;
};

export type EmailBindingResult = {
  userId: string;
  alreadyBound: boolean;
  merged: boolean;
  sameUser: boolean;
  sessionToken?: string;
};
