import { useEffect, useState } from "react";
import { Sparkles, Monitor, Folder, Server, ArrowDown } from "lucide-react";
import { Link } from "react-router-dom";

interface DownloadUrls {
  windows: string;
  linux: string;
}

const FALLBACK_URL = "https://github.com/shira022/deskspawn/releases/latest";

function detectOS(): string {
  if (typeof window === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (ua.includes("Win")) return "Windows";
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Linux")) return "Linux";
  return "unknown";
}

// Fetch actual release assets from GitHub API and find the right installer
// for each OS. This is robust against changes in naming conventions.
async function fetchDownloadUrls(): Promise<DownloadUrls> {
  const res = await fetch(
    "https://api.github.com/repos/shira022/deskspawn/releases/latest"
  );
  if (!res.ok) throw new Error("GitHub API error");
  const release = await res.json();
  const assets: { name: string; browser_download_url: string }[] =
    release.assets;

  // Windows: prefer .msi installer
  const msi = assets.find((a) => a.name.endsWith(".msi"));
  // Linux: prefer .deb, fallback to .AppImage
  const deb =
    assets.find((a) => a.name.endsWith(".deb")) ??
    assets.find((a) => a.name.endsWith(".AppImage"));

  return {
    windows: msi?.browser_download_url ?? FALLBACK_URL,
    linux: deb?.browser_download_url ?? FALLBACK_URL,
  };
}

const features = [
  {
    icon: Sparkles,
    title: "AI-Powered Development",
    description:
      "Leverage AI to generate, refactor, and optimize your desktop applications. Built-in AI assistance streamlines your workflow.",
  },
  {
    icon: Monitor,
    title: "Cross-Platform",
    description:
      "Build once, deploy everywhere. DeskSpawn apps run natively on Windows, macOS, and Linux with a single codebase.",
  },
  {
    icon: Folder,
    title: "Project Management",
    description:
      "Organize your projects with ease. Built-in project templates, configuration management, and scaffolding tools.",
  },
  {
    icon: Server,
    title: "Sidecar Architecture",
    description:
      "Extend your app's capabilities with sidecar processes. Run Node.js, Python, or any binary alongside your Tauri app.",
  },
];

export default function Home() {
  const [detectedOS, setDetectedOS] = useState("");
  const [downloads, setDownloads] = useState<DownloadUrls | null>(null);

  useEffect(() => {
    setDetectedOS(detectOS());

    fetchDownloadUrls()
      .then(setDownloads)
      .catch(() => setDownloads(null));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* Hero */}
      <section className="flex flex-col items-center py-20 text-center md:py-28">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl">
          DeskSpawn
        </h1>
        <p className="mt-4 max-w-2xl text-xl text-muted-foreground sm:text-2xl">
          AI-powered desktop app development platform
        </p>
        <p className="mt-6 max-w-xl text-base text-muted-foreground">
          Build, manage, and deploy modern desktop applications with the power of AI.
          Leverage Tauri v2 for lightweight, secure, and cross-platform native apps.
        </p>

        {/* Download buttons */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href={downloads?.windows ?? FALLBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
          >
            <ArrowDown className="h-4 w-4" />
            Download for Windows
          </a>
          <span
            className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border/50 px-6 py-3 text-sm font-medium text-muted-foreground/60 cursor-not-allowed"
            title="macOS distribution is temporarily paused"
          >
            <ArrowDown className="h-4 w-4 opacity-40" />
            macOS — Currently Unavailable
          </span>
          <a
            href={downloads?.linux ?? FALLBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ArrowDown className="h-4 w-4" />
            Download for Linux
          </a>
        </div>

        {/* OS and arch detection */}
        {detectedOS && (
          <p className="mt-4 text-sm text-muted-foreground">
            Detected: <span className="font-medium text-foreground">{detectedOS}</span>
            {detectedOS === "macOS" && (
              <span className="ml-2 text-xs text-muted-foreground/60">
                (macOS distribution is temporarily paused — see Install page for details)
              </span>
            )}
            {!downloads && detectedOS !== "macOS" && (
              <span className="ml-2 text-xs text-muted-foreground/60">
                (browsing latest release)
              </span>
            )}
          </p>
        )}

        {/* GitHub stars */}
        <a
          href="https://github.com/shira022/deskspawn"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <span className="text-yellow-500">⭐</span> Star on GitHub
        </a>
      </section>

      {/* Screenshot placeholder */}
      <section className="pb-16">
        <div className="aspect-video w-full rounded-2xl border border-border bg-gradient-to-br from-muted via-card to-muted flex items-center justify-center">
          <div className="text-center">
            <Monitor className="mx-auto h-12 w-12 text-muted-foreground/40" />
            <p className="mt-4 text-lg font-medium text-muted-foreground">
              Screenshot coming soon
            </p>
            <p className="mt-1 text-sm text-muted-foreground/60">
              A visual preview of DeskSpawn in action
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="pb-24">
        <h2 className="mb-12 text-center text-3xl font-bold tracking-tight">
          Key Features
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-card p-6 transition-colors hover:bg-accent/50"
              >
                <div className="mb-4 inline-flex rounded-lg bg-muted p-2.5">
                  <Icon className="h-5 w-5 text-foreground" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24 text-center">
        <div className="rounded-2xl border border-border bg-card p-12">
          <h2 className="text-3xl font-bold tracking-tight">
            Ready to get started?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Download DeskSpawn and start building AI-powered desktop apps today.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              to="/install"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
            >
              Install Now
            </Link>
            <Link
              to="/docs"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              Read the Docs
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
