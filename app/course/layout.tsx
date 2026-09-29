import { KnowledgeAdminBoundary } from "@/components/portal/KnowledgeAdminBoundary";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <KnowledgeAdminBoundary>{children}</KnowledgeAdminBoundary>;
}
