import { notFound, redirect } from "next/navigation";
import { currentBackofficeAuthor, currentOperatorUser, isCurrentAdminHost } from "@/services/productAuth";

export async function KnowledgeAdminBoundary({ children }: { children: React.ReactNode }) {
  if (await isCurrentAdminHost() && !await currentOperatorUser()) {
    if (await currentBackofficeAuthor()) notFound();
    redirect("/en-GB/backoffice/sign-in");
  }
  return <>{children}</>;
}
