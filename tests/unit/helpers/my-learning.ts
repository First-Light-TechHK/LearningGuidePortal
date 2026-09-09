import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const PLAN_ID = "epicureanism-pc-6";
export const COURSE_ID = "epicureanism";
export const PREVIEW_LP = "pleasure-and-the-good-life";
export const PRIVATE_LP = "death-is-nothing-to-us";

export type ProductStore = typeof import("../../../services/productStore");

export async function verifiedUser(
  store: ProductStore,
  email: string,
  nickname = "ML Student",
) {
  const user = await store.registerUser({ email, password: "password1", nickname });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  return user;
}

export async function purchaseCourse(store: ProductStore, userId: string) {
  const { quote } = await store.createQuote(userId, PLAN_ID);
  const pending = await store.createPendingDemoOrder(userId, quote.id);
  await store.completeDemoOrder(userId, pending.order.id);
}

export async function activateThreeDayTrial(store: ProductStore, userId: string) {
  const pending = await store.createPendingDemoTrialOrder(userId, PLAN_ID);
  await store.completeDemoTrialOrder(userId, pending.order.id);
}

export async function openLearningPoint(
  store: ProductStore,
  userId: string,
  lessonId: string,
  clientEventId: string,
  access: "paid" | "preview" = "paid",
) {
  return store.recordStudyEvent({
    userId,
    courseId: COURSE_ID,
    lessonId,
    event: "open",
    seconds: 0,
    clientEventId,
  }, access);
}

export function productFile() {
  return path.join(process.cwd(), "data", "knowledge_system", "learning_guide", "product.json");
}

export async function readProductData() {
  return JSON.parse(await readFile(productFile(), "utf8"));
}

export async function writeProductData(data: unknown) {
  await writeFile(productFile(), `${JSON.stringify(data, null, 2)}\n`);
}
