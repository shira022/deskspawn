import { BookOpen, Zap, Cpu, ArrowUpRight } from "lucide-react";

const guides = [
  {
    icon: BookOpen,
    title: "Projects",
    description:
      "Learn how to create, configure, and manage DeskSpawn projects. Covers project structure, templates, and settings.",
    href: "https://github.com/shira022/deskspawn/tree/main/docs/usage/projects",
  },
  {
    icon: Zap,
    title: "AI Features",
    description:
      "Explore DeskSpawn's AI capabilities — code generation, refactoring, optimization, and intelligent suggestions.",
    href: "https://github.com/shira022/deskspawn/tree/main/docs/usage/ai-features",
  },
  {
    icon: Cpu,
    title: "Sidecar Architecture",
    description:
      "Understand how sidecar processes work, how to configure them, and how to extend your app with custom binaries.",
    href: "https://github.com/shira022/deskspawn/tree/main/docs/usage/sidecar",
  },
];

export default function Usage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-bold tracking-tight">Usage Guides</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Detailed guides to help you make the most of DeskSpawn's features.
      </p>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {guides.map((guide) => {
          const Icon = guide.icon;
          return (
            <a
              key={guide.title}
              href={guide.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-border bg-card p-6 transition-colors hover:bg-accent/50"
            >
              <div className="mb-4 inline-flex rounded-lg bg-muted p-2.5">
                <Icon className="h-5 w-5 text-foreground" />
              </div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-lg font-semibold text-foreground">
                  {guide.title}
                </h3>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {guide.description}
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
