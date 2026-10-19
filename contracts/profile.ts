export type ProfileErrorCode = "CURRENT_PASSWORD_INCORRECT" | "NEW_PASSWORD_TOO_SHORT";

export class ProfileError extends Error {
  constructor(public readonly code: ProfileErrorCode, message: string) {
    super(message);
    this.name = "ProfileError";
  }
}
