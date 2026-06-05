# Managing Projects

Projects are the core unit of work in DeskSpawn. Each project contains all the
source files, configuration, and assets for an app you're building.

---

## Creating a New Project

1. On the **Dashboard**, click the **+ New Project** button.
2. Enter a **name** and optional **description** for your project.
3. Describe the app you want to build in the chat interface:
   - Be specific about features and layout.
   - Specify a tech stack within the supported set (Vite + React + TypeScript,
     Tailwind CSS v4, etc.).
4. Click **Generate** — DeskSpawn will stream the project files into place and
   open a live preview.

> You can iterate on the same project by continuing the conversation. Each
> message can refine the generated code.

---

## Opening Existing Projects

All your projects are listed on the **Dashboard**. Click any project card to
open it. Projects are stored locally in a SQLite database managed by DeskSpawn.

To open a project exported as a regular folder:
- Use **File → Open Folder** and select the project directory.
- The project will be re-imported into DeskSpawn's database.

---

## Project Structure

When DeskSpawn generates a project, it creates a standard web-app layout:

```
my-project/
├── public/            # Static assets
│   └── index.html
├── src/
│   ├── components/    # React components
│   ├── lib/
│   │   └── storage/   # IndexedDB storage wrapper (auto-generated)
│   ├── App.tsx        # Root component
│   ├── main.tsx       # Entry point
│   └── index.css      # Tailwind CSS entry
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
├── tailwind.config.js # Tailwind CSS configuration
└── vite.config.ts     # Vite configuration
```

> This structure follows the **fixed tech stack** (Vite + React + TypeScript +
> Tailwind CSS v4) to maximise AI generation accuracy and minimise hallucinations.

---

## Project Settings

Each project has a settings panel accessible from the project view:

- **Name & Description** — update the project metadata.
- **Export** — download the project as a `.zip` archive or copy it to a local
  folder for manual editing.
- **Delete** — remove the project from DeskSpawn (with confirmation).

---

## Tips for Organising Projects

- **Use descriptive names** — this makes it easier to find projects later.
- **Iterate in one project** — rather than creating many small projects, use
  the chat to incrementally build features within a single project.
- **Export backups** — regularly export important projects to your file system
  as an additional backup alongside DeskSpawn's automatic sidecar backups.
- **Clean up old projects** — delete projects you no longer need to keep the
  dashboard tidy.

---

## See Also

- [AI Features](./ai-features.md) — using the AI assistant to build your app
- [Sidecar Architecture](./sidecar.md) — how projects are backed up and managed
