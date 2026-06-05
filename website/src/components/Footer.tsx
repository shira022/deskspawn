import { ExternalLink } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
        <p className="text-sm font-medium text-foreground">DeskSpawn</p>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <a
            href="https://github.com/shira022/deskspawn"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            GitHub
            <ExternalLink className="h-3 w-3" />
          </a>
          <span className="text-border">|</span>
          <span>MIT License</span>
          <span className="text-border">|</span>
          <span>Built with Tauri</span>
        </div>
      </div>
    </footer>
  );
}
