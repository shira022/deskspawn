# AI Features

DeskSpawn's core capability is generating and refining applications through
natural language conversations with an AI model.

---

## Overview of AI Capabilities

| Feature                | Description                                          |
|------------------------|------------------------------------------------------|
| **App Generation**     | Describe an app and get a working app instantly  |
| **Iterative Refinement** | Keep chatting to add features or fix issues        |
| **Code Editing**       | Ask for specific changes to generated files          |
| **Multi-file Aware**   | The AI understands the full app context          |
| **Local Models**       | Works with Ollama for fully offline use              |

---

## Configuring AI Providers

DeskSpawn supports multiple AI providers. You can configure them from the
**model button in the toolbar** → **APIキー設定** (API key settings) dialog.

### Cloud Providers

| Provider              | API Key Required | Notes                                        |
|-----------------------|------------------|----------------------------------------------|
| OpenAI                | Yes              | Any model you have access to (e.g. GPT-4o family) |
| Anthropic             | Yes              | Any Claude model                             |
| Google Gemini         | Yes              | Google AI / Gemini API key                   |
| AWS Bedrock           | Yes              | AWS region required; Claude, Llama, Nova     |
| Azure OpenAI          | Yes              | Endpoint URL required; GPT, o-series         |
| GCP Vertex AI         | Yes              | Express mode; Gemini, Claude, Imagen         |
| Ollama                | No               | Local LLM — fully offline                    |
| Custom (OpenAI-compatible) | Optional   | Any OpenAI-compatible endpoint               |

To add a cloud provider:
1. Click the **model button** in the toolbar (next to the app selector).
2. Click **APIキー設定** (or "設定する" when unconfigured) to open the full dialog.
3. Select the provider from the dropdown.
4. Paste your API key (desktop: saved to the OS keychain).
5. Click **保存** (**Save**).

> Your API key is stored in the **OS keychain** (desktop) or in browser
> storage — IndexedDB — (web demo, evaluation only), and is never sent
> anywhere except to the provider you configured (via the local sidecar
> proxy on desktop).

### Local Provider (Ollama)

DeskSpawn can run entirely offline using [Ollama](https://ollama.ai).

1. Install Ollama from [ollama.ai](https://ollama.ai).
2. Pull a supported model, for example:
   ```bash
   ollama pull codellama
   ```
3. In DeskSpawn, click the **model button** in the toolbar → **APIキー設定**.
4. Select **Ollama** as the provider.
5. Set the endpoint to `http://localhost:11434` (the default).
6. Select (or enter) the model you pulled.
7. Click **保存** (**Save**).

> Using a local model means no data leaves your machine. Ideal for sensitive
> work or when you don't have an internet connection.

---

## Using the AI Assistant

### Starting a Conversation

1. Create or open an app.
2. The chat panel opens on the left side of the app view.
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

- [Managing Apps](./apps.md) — creating and organising apps
- [Getting Started](../getting-started.md) — how to get started with DeskSpawn
