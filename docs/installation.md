# Installation

DeskSpawn runs entirely in your browser. **There is nothing to install.**

## Using the Hosted Version

Visit **[deskspawn.pages.dev](https://deskspawn.pages.dev)** to start using DeskSpawn immediately.

### Browser Requirements

| Browser | Status |
|---------|--------|
| **Chrome 105+** | ✅ Fully supported (recommended) |
| **Edge 105+** | ✅ Fully supported |
| **Opera 91+** | ✅ Fully supported |
| **Firefox** | ⚠️ Limited — preview system (WebContainer) not supported |
| **Safari** | ⚠️ Limited — preview system (WebContainer) not supported |

> WebContainer requires cross-origin isolation (COOP/COEP headers) and
> SharedArrayBuffer support, which are only available in Chromium-based browsers.

## Self-Hosting

DeskSpawn is a static site that can be deployed to any static hosting provider
that supports custom HTTP headers.

### Cloudflare Pages (Recommended)

1. Fork the [GitHub repository](https://github.com/shira022/deskspawn)
2. Go to [Cloudflare Pages dashboard](https://dash.cloudflare.com/?to=/:account/pages)
3. Click **Create a project** → **Connect to Git**
4. Select your fork and configure:
   - **Project name**: `deskspawn`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
5. Deploy

The included `public/_headers` file automatically configures the required
COOP/COEP headers, CSP, and other security headers.

### Other Hosting Options

| Platform | COOP/COEP | Setup |
|----------|-----------|-------|
| **Vercel** | ✅ via `vercel.json` | Requires Pro plan ($20/mo) for commercial use |
| **Netlify** | ✅ via `netlify.toml` | 100 GB bandwidth cap on free tier |
| **GitHub Pages** | ❌ | WebContainer preview will not work |

See the [README](https://github.com/shira022/deskspawn#readme) for more details.

## System Requirements

| Component | Minimum |
|-----------|---------|
| Browser | Chrome 105+ / Edge 105+ |
| RAM | 4 GB (8 GB recommended) |
| Network | Broadband (for AI API calls) |
| Storage | 50 MB free (for IndexedDB/OPFS project data) |
