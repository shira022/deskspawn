import { useState } from "react";
import { ArrowDown, Terminal, AlertTriangle, Info } from "lucide-react";

const tabs = [
  { id: "windows", label: "Windows" },
  { id: "macos", label: "macOS" },
  { id: "linux", label: "Linux" },
] as const;

type OSTab = (typeof tabs)[number]["id"];

const osContent: Record<OSTab, {
  title: string;
  downloadLabel: string;
  steps: string[];
  notes: { type: "warning" | "info"; text: string }[];
  requirements: string[];
}> = {
  windows: {
    title: "Windows",
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
    title: "macOS",
    downloadLabel: "Download DeskSpawn for macOS (.dmg)",
    steps: [
      "Download the latest DeskSpawn disk image (.dmg) from the releases page.",
      "Open the downloaded .dmg file.",
      "Drag DeskSpawn to your Applications folder.",
      'Right-click (or Ctrl-click) DeskSpawn in Applications and select "Open" to bypass the unsigned app warning.',
      'Click "Open" in the confirmation dialog.',
    ],
    notes: [
      {
        type: "warning",
        text: "DeskSpawn is not yet notarized by Apple. On first launch, right-click (or Ctrl-click) the app and select 'Open' from the context menu, then click 'Open' in the dialog. This is only required on the first launch.",
      },
    ],
    requirements: [
      "macOS 12 (Monterey) or later",
      "Apple Silicon or Intel processor",
      "4GB RAM minimum (8GB recommended)",
      "500MB free disk space",
      "Internet connection for initial setup",
    ],
  },
  linux: {
    title: "Linux",
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

  const content = osContent[activeTab];

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
        {/* Download button */}
        <a
          href="https://github.com/shira022/deskspawn/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
        >
          <ArrowDown className="h-4 w-4" />
          {content.downloadLabel}
        </a>

        {/* Steps */}
        <h2 className="mt-10 mb-4 text-xl font-semibold">Installation Steps</h2>
        <ol className="space-y-4">
          {content.steps.map((step, i) => (
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
          {content.notes.map((note, i) => (
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
          {content.requirements.map((req, i) => (
            <li key={i} className="flex items-center gap-3 text-sm text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              {req}
            </li>
          ))}
        </ul>

        {/* Terminal hint */}
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
      </div>
    </div>
  );
}
