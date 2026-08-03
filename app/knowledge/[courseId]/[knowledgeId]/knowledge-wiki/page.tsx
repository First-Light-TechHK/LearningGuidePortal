import KnowledgeWikiPage from "@/app/knowledge-wiki/[pageId]/page";

export default function KnowledgeWikiKnowledgeRoute({ params }: { params: Promise<{ knowledgeId: string }> }) {
  return <KnowledgeWikiPage params={params.then(({ knowledgeId }) => ({ pageId: knowledgeId }))} />;
}
