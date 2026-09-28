import { AppShell } from "@/components/layout/AppShell";
import { SourceIntelligenceProvider } from "@/components/source-intelligence/SourceIntelligenceProvider";

export default function Home() {
  return (
    <SourceIntelligenceProvider>
      <AppShell />
    </SourceIntelligenceProvider>
  );
}
