# Managing Apps

Apps are the core unit of work in DeskSpawn. Each app you build contains its
source files, configuration, and chat history.

---

## Creating a New App

1. Click **+ New App** in the toolbar.
2. Enter a **name** for your app.
3. Describe the app you want to build in the chat panel:
   - Be specific about features and layout.
   - The supported stack is **Vite + React + TypeScript + Tailwind CSS v4**
     (the desktop app can additionally generate full-stack apps with
     **Hono + SQLite**).
4. DeskSpawn's AI pipeline plans, writes, verifies, and previews the app.

> You can iterate on the same app by continuing the conversation. Each
> message can refine the generated code.

---

## Switching Between Apps

Use the **app switcher** in the toolbar to open a previously created app.
Each app keeps its own chat history, so you can resume exactly where you
left off.

---

## Deleting an App

You can delete an app from the app switcher. The currently open app cannot
be deleted — switch to another app first.

---

## Where App Data Lives

### Desktop app (recommended)

Everything lives under `~/deskspawn/` on your machine:

```
~/deskspawn/
├── apps/                 # your generated apps (real files on disk)
│   ├── <app-id>/
│   │   ├── src/          # editable source files
│   │   └── .deskspawn/
│   │       └── chat.db   # per-app chat history (SQLite)
│   └── apps.json         # app registry (id, name, timestamps)
├── config/               # app settings
└── templates/            # bundled templates
```

- App source is **real files** — open them in any editor, or back up by
  copying the folder.
- API keys are stored in the **OS keychain**, never in the app files.

### Web version (evaluation only)

In the browser demo, app data and API keys are stored in the browser's
**IndexedDB/OPFS**. This is convenient for a quick try, but less secure than
the desktop app — use the desktop app for real work.
