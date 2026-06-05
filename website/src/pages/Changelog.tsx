import { ExternalLink, Github } from "lucide-react";

export default function Changelog() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-bold tracking-tight">Changelog</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        See what's new in each release of DeskSpawn.
      </p>

      <div className="mt-10 rounded-xl border border-border bg-card p-8">
        <div className="flex items-center gap-3 mb-4">
          <Github className="h-6 w-6 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Auto-Generated Releases</h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          The full changelog is auto-generated and published with each release on GitHub.
          Each release includes a detailed list of new features, bug fixes, breaking changes,
          and improvements.
        </p>

        <a
          href="https://github.com/shira022/deskspawn/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
        >
          <ExternalLink className="h-4 w-4" />
          View Releases on GitHub
        </a>
      </div>

      <div className="mt-8 space-y-6">
        <h3 className="text-lg font-semibold">Recent Releases</h3>
        <p className="text-sm text-muted-foreground">
          Visit the GitHub releases page to browse all versions and download the latest release.
        </p>
      </div>
    </div>
  );
}
