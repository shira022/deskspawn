import { useState, useEffect } from "react";
import { ArrowDown, Terminal, AlertTriangle, Info } from "lucide-react";

const FALLBACK_URL = "https://github.com/shira022/deskspawn/releases/latest";

function isFallback(url: string | null | undefined): boolean {
  return !url || url === FALLBACK_URL;
}

// Fetch actual release assets from GitHub API.
async function fetchOsDownloadUrl(tab: string): Promise<string | null> {
  if (tab === "macos") return null; // macOS distribution is paused

  const res = await fetch(
    "https://api.github.com/repos/shira022/deskspawn/releases/latest"
  );
  if (!res.ok) throw new Error("GitHub API error");
  const release = await res.json();
  const assets: { name: string; browser_download_url: string }[] =
    release.assets;

  switch (tab) {
    case "windows": {
      const msi = assets.find((a) => a.name.endsWith(".msi"));
      return msi?.browser_download_url ?? FALLBACK_URL;
    }
    case "linux": {
      const deb =
        assets.find((a) => a.name.endsWith(".deb")) ??
        assets.find((a) => a.name.endsWith(".AppImage"));
      return deb?.browser_download_url ?? FALLBACK_URL;
    }
    default:
      return FALLBACK_URL;
  }
}

const tabs = [
  { id: "windows", label: "Windows" },
  { id: "macos", label: "macOS" },
  { id: "linux", label: "Linux" },
] as const;

type OSTab = (typeof tabs)[number]["id"];

type OSContent = {

  id: OSTab;
  title: string;
  available: boolean;
  message?: string;
  downloadLabel?: string;
  steps?: string[];
  notes?: { type: "warning" | "info"; text: string }[];
  requirements?: string[];
};

const osContent: Record<OSTab, OSContent> = {
  windows: {
    id: "windows",
    title: "Windows",
    available: true,
    downloadLabel: "Download DeskSpawn for Windows (.msi)",
    steps: [
      "Download the latest DeskSpawn installer (.msi) from the releases page.",
      'Double-click the downloaded file to launch the installer.',
      "Follow the installation wizard instructions.",
      "Once installed, launch DeskSpawn from the Start Menu or desktop shortcut.",
      "Optional: Add DeskSpawn to your PATH during installation for CLI access.",
    ],
    notes: [
      {
        type: "warning",
        text: "Windows SmartScreen may show a warning since the app is not yet code-signed. Click 'More info' → 'Run anyway' to proceed.",
      },
    ],
    requirements: [
      "Windows 10 or later (64-bit)",
      "4GB RAM minimum (8GB recommended)",
      "500MB free disk space",
      "Internet connection for initial setup",
    ],
  },
  macos: {
    id: "macos",
    title: "macOS",
    available: false,
    message:
      "macOS 版は現在準備中です。Apple のコード署名証明書のコストのため、現時点では配布を一時停止しています。" +
      "ソースコードからビルドしてご利用いただくか、今後のアップデートをお待ちください。" +
      "\n\n" +
      "The macOS build is currently unavailable. Due to the cost of Apple's code signing certificate, " +
      "distribution is paused for now. In the meantime, you can build from source or wait for a future update.",
  },
  linux: {
    id: "linux",
    title: "Linux",
    available: true,
    downloadLabel: "Download DeskSpawn for Linux (.AppImage)",
    steps: [
      "Download the latest DeskSpawn AppImage from the releases page.",
      "Open a terminal in the download directory.",
      "Make the AppImage executable: chmod +x deskspawn-*.AppImage",
      "Run DeskSpawn: ./deskspawn-*.AppImage",
      "Optional: Move the AppImage to ~/.local/bin/ and create a desktop entry for app menu integration.",
    ],
    notes: [
      {
        type: "info",
        text: "DeskSpawn is also available as a .deb package for Debian/Ubuntu-based distributions. Check the releases page for alternative formats.",
      },
    ],
    requirements: [
      "Linux kernel 5.0 or later",
      "GTK 3.20+ and WebKit2GTK 4.1+",
      "4GB RAM minimum (8GB recommended)",
      "500MB free disk space",
      "FUSE 2.x for AppImage support",
      "Internet connection for initial setup",
    ],
  },
};

export default function Install() {
  const [activeTab, setActiveTab] = useState<OSTab>("windows");
  const [downloadUrl, setDownloadUrl] = useState<string | undefined>(undefined);


  const content = osContent[activeTab];

  useEffect(() => {
    setDownloadUrl(undefined);
    if (!content.available) return;
    fetchOsDownloadUrl(activeTab)
      .then((url) => {
        if (url) setDownloadUrl(url);
      })
      .catch(() => setDownloadUrl(FALLBACK_URL));
  }, [activeTab, content.available]);


  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-bold tracking-tight">Installation</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Choose your operating system for detailed installation instructions.
      </p>

      {/* Tabs */}
      <div className="mt-10 flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
              activeTab === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="mt-8">
        {content.available ? (
          <>
            {/* Download button */}
            <a
              href={downloadUrl ?? FALLBACK_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium shadow-sm transition-opacity ${
                isFallback(downloadUrl)
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
              title={
                isFallback(downloadUrl)
                  ? "No installer found for this release — browsing releases page"
                  : "Download installer"
              }
            >
              <ArrowDown className="h-4 w-4" />
              {content.downloadLabel}
            </a>
            {isFallback(downloadUrl) && (
              <p className="mt-2 text-xs text-muted-foreground/60">
                No installer available for this release yet. You'll be taken to the releases page instead.
              </p>
            )}

            {/* Steps */}
            <h2 className="mt-10 mb-4 text-xl font-semibold">Installation Steps</h2>
            <ol className="space-y-4">
              {content.steps?.map((step, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                    {i + 1}
                  </span>
                  <p className="pt-0.5 text-foreground">{step}</p>
                </li>
              ))}
            </ol>

            {/* Notes */}
            <div className="mt-10 space-y-4">
              {content.notes?.map((note, i) => (
                <div
                  key={i}
                  className={`flex gap-3 rounded-lg border p-4 ${
                    note.type === "warning"
                      ? "border-warning/30 bg-warning/5"
                      : "border-border bg-card"
                  }`}
                >
                  {note.type === "warning" ? (
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  ) : (
                    <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <p className={`text-sm ${
                    note.type === "warning" ? "text-warning-foreground" : "text-muted-foreground"
                  }`}>
                    {note.text}
                  </p>
                </div>
              ))}
            </div>

            {/* System requirements */}
            <h2 className="mt-12 mb-4 text-xl font-semibold">System Requirements</h2>
            <ul className="space-y-2">
              {content.requirements?.map((req, i) => (
                <li key={i} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                  {req}
                </li>
              ))}
            </ul>
          </>
        ) : (
          /* Unavailable platform message */
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <Info className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <h2 className="mt-4 text-xl font-semibold text-foreground">
              macOS Version — Currently Unavailable
            </h2>
            <div className="mt-4 mx-auto max-w-lg space-y-4 text-sm text-muted-foreground whitespace-pre-line">
              {content.message}
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              In the meantime, check the{" "}
              <a
                href="https://github.com/shira022/deskspawn"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                GitHub repository
              </a>{" "}
              for updates and building from source.
            </p>
          </div>
        )}

        {/* Terminal hint (available only for non-macOS) */}
        {content.available && (
          <div className="mt-12 rounded-lg border border-border bg-card p-4">
            <div className="flex gap-3">
              <Terminal className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  CLI Installation
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  If you prefer installing via the command line, check the{" "}
                  <a
                    href="https://github.com/shira022/deskspawn"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    GitHub repository
                  </a>{" "}
                  for advanced installation options.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
