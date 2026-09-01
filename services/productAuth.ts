import { cookies } from "next/headers";
import { getUserBySessionToken, type ProductUser } from "./productStore";

export const SESSION_COOKIE = "learning_guide_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export async function currentProductUser(): Promise<ProductUser | null> {
  const cookieStore = await cookies();
  return getUserBySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}
