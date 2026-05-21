import { useAppStore } from "@/store/useAppStore";
import { AiConfigScreen } from "@/components/onboarding/AiConfigScreen";
import { EnvCheckScreen } from "@/components/onboarding/EnvCheckScreen";
import { MainLayout } from "@/components/layout/MainLayout";

export function App() {
  const phase = useAppStore((s) => s.phase);

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      {phase === "ai-config" && <AiConfigScreen />}
      {phase === "env-check" && <EnvCheckScreen />}
      {phase === "main" && <MainLayout />}
    </div>
  );
}
