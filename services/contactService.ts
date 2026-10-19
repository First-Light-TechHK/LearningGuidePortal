import { createHash, randomUUID } from "node:crypto";
import { ContactError, parseContactInput } from "@/contracts/contact";
import { insertContactRequest } from "@/repositories/contactRequestRepository";

export async function submitContactRequest(value: unknown, userId: string | null) {
  const input = parseContactInput(value);
  const payloadHash = createHash("sha256").update(JSON.stringify({ ...input, userId })).digest("hex");
  try {
    return await insertContactRequest({ ...input, id: randomUUID(), userId, payloadHash, status: "new", createdAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ContactError) throw error;
    throw new ContactError("CONTACT_UNAVAILABLE", 503);
  }
}
