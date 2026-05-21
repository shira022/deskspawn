import { useAppStore } from "@/store/useAppStore";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  Bot,
  CheckCircle2,
  AlertCircle,
  Wifi,
  WifiOff,
} from "lucide-react";

export function StatusBar() {
  const { agentStatus, agentStepCount, agentMaxSteps, errors, vitePort } =
    useAppStore();

  const statusConfig = {
    idle: { label: "待機中", icon: <Bot className="h-3 w-3" />, variant: "outline" as const },
    running: { label: "生成中", icon: <Loader2 className="h-3 w-3 animate-spin" />, variant: "secondary" as const },
    error: { label: "エラー", icon: <AlertCircle className="h-3 w-3" />, variant: "destructive" as const },
    complete: { label: "完了", icon: <CheckCircle2 className="h-3 w-3" />, variant: "success" as const },
  };

  const s = statusConfig[agentStatus];

  return (
    <div className="flex h-7 items-center justify-between border-t bg-muted/20 px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Badge variant={s.variant} className="h-5 gap-1 text-[10px]">
            {s.icon}
            {s.label}
          </Badge>
          {agentStatus === "running" && (
            <span>
              ステップ {agentStepCount}/{agentMaxSteps}
            </span>
          )}
        </div>
        {errors.length > 0 && (
          <Badge variant="destructive" className="h-5 text-[10px]">
            <AlertCircle className="h-3 w-3 mr-1" />
            {errors.length} 件のエラー
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full bg-success" />
          <span>Vite :{vitePort}</span>
        </div>
        <Separator orientation="vertical" className="h-3" />
        <span>{new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
