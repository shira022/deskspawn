# AI Features

DeskSpawn's core capability is generating and refining applications through
natural language conversations with an AI model.

---

## Overview of AI Capabilities

| Feature                | Description                                          |
|------------------------|------------------------------------------------------|
| **App Generation**     | Describe an app and get a working project instantly  |
| **Iterative Refinement** | Keep chatting to add features or fix issues        |
| **Code Editing**       | Ask for specific changes to generated files          |
| **Multi-file Aware**   | The AI understands the full project context          |
| **Local Models**       | Works with Ollama for fully offline use              |

---

## Configuring AI Providers

DeskSpawn supports multiple AI providers. You can configure them in
**Settings → AI Provider**.

### Cloud Providers

| Provider  | API Key Required | Notes                            |
|-----------|-----------------|-----------------------------------|
| OpenAI    | Yes             | Uses GPT-4o / GPT-4o-mini       |
| Anthropic | Yes             | Uses Claude 3.5 Sonnet / Opus    |

To add a cloud provider:
1. Go to **Settings → AI Provider**.
2. Select the provider from the dropdown.
3. Paste your API key.
4. Click **Test Connection** to verify it works.
5. Click **Save**.

> Your API key is stored locally in the SQLite database and is never sent
> anywhere except to the provider you configured.

### Local Provider (Ollama)

DeskSpawn can run entirely offline using [Ollama](https://ollama.ai).

1. Install Ollama from [ollama.ai](https://ollama.ai).
2. Pull a supported model, for example:
   ```bash
   ollama pull codellama
   ```
3. In DeskSpawn, go to **Settings → AI Provider**.
4. Select **Ollama** as the provider.
5. Set the endpoint to `http://localhost:11434` (the default).
6. Select the model you pulled.
7. Click **Save**.

> Using a local model means no data leaves your machine. Ideal for sensitive
> work or when you don't have an internet connection.

---

## Using the AI Assistant

### Starting a Conversation

1. Create or open a project.
2. The chat panel opens on the right side of the project view.
3. Type your request — be as specific as possible for best results.

### Example Prompts

```
"Create a to-do list app with a clean design. Tasks should have
a title, due date, and a checkbox. Use Tailwind CSS for styling."
```

```
"Add a dark mode toggle to my app. Store the preference in localStorage."
```

```
"The sidebar doesn't close when I click outside it. Can you fix that?"
```

### Best Practices

- **Be specific** — include details about layout, behaviour, and styling.
- **One change at a time** — it's easier for the AI to handle focused requests.
- **Review generated code** — the AI is powerful but not infallible. Check
  the output before considering it final.
- **Use iteration** — if the first result isn't perfect, describe what
  needs to change rather than starting over.

---

## Tips for Better Results

1. **Provide context** — mention existing features when asking for changes.
2. **Mention the tech stack** — e.g. "using Tailwind CSS" or "with TypeScript".
3. **Be concise** — clear, direct prompts work better than long prose.
4. **Use the preview** — see your app update in real time as the AI makes changes.

---

## See Also

- [Managing Projects](./projects.md) — creating and organising projects
- [Sidecar Architecture](./sidecar.md) — how the AI runtime works
