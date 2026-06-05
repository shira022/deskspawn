import { Link } from "react-router-dom";
import { Rocket, Download, BookOpen, FileText, ArrowUpRight } from "lucide-react";

const docSections = [
  {
    icon: Rocket,
    title: "Getting Started",
    description:
      "Learn the basics of DeskSpawn — create your first project, understand the UI, and explore key concepts.",
    link: "/install",
    external: false,
  },
  {
    icon: Download,
    title: "Installation Guide",
    description:
      "Step-by-step instructions for installing DeskSpawn on Windows, macOS, and Linux.",
    link: "/install",
    external: false,
  },
  {
    icon: BookOpen,
    title: "Usage Guides",
    description:
      "Deep dives into projects, AI features, sidecar architecture, and advanced configuration.",
    link: "/docs/usage",
    external: false,
  },
  {
    icon: FileText,
    title: "Changelog",
    description:
      "See what's new in each release — features, bug fixes, and breaking changes.",
    link: "/changelog",
    external: false,
  },
];

export default function Docs() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-bold tracking-tight">Documentation</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Everything you need to get started with DeskSpawn.
      </p>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {docSections.map((section) => {
          const Icon = section.icon;
          const content = (
            <div className="rounded-xl border border-border bg-card p-6 transition-colors hover:bg-accent/50 h-full">
              <div className="mb-4 inline-flex rounded-lg bg-muted p-2.5">
                <Icon className="h-5 w-5 text-foreground" />
              </div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-lg font-semibold text-foreground">
                  {section.title}
                </h3>
                {section.external && (
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {section.description}
              </p>
            </div>
          );

          if (section.external) {
            return (
              <a
                key={section.title}
                href={section.link}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                {content}
              </a>
            );
          }

          return (
            <Link key={section.title} to={section.link} className="block">
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
