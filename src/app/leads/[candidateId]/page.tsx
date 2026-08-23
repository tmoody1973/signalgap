import { AppHeader } from "@/components/shell/app-header";
import { EvidenceViewPanel } from "@/components/evidence/evidence-view";
import type { Id } from "../../../../convex/_generated/dataModel";

export default async function LeadPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <EvidenceViewPanel candidateId={candidateId as Id<"candidates">} />
      </main>
    </>
  );
}
