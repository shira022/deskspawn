/**
 * Screenshot utility for visual verification of generated apps.
 *
 * Returns a 3-layer result:
 *   Layer 1 — base64 screenshot image (for multimodal models)
 *   Layer 2 — structured DOM metadata (for any model)
 *   Layer 3 — natural-language summary (for lightweight models)
 *
 * Features:
 *   - Browser mode: headless Chrome via Puppeteer → Vite Dev Server
 *   - Responsive: takes screenshots at multiple viewport sizes in one call
 *   - Diff: pixel-level comparison with previous screenshot via sharp + pixelmatch
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import pixelmatch from 'pixelmatch';

// sharp is a native (libvips) addon that cannot be bundled into standalone binaries.
// We lazy-load it so the sidecar works without it; screenshot diff gracefully degrades.
let sharpModule: typeof import('sharp') | null = null;
async function getSharp(): Promise<typeof import('sharp') | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = (await import('sharp')).default;
  } catch {
    console.warn('[screenshot] sharp not available — screenshot diff disabled');
    sharpModule = null;
  }
  return sharpModule;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type ScreenshotMode = 'browser';

export interface ViewportConfig {
  width: number;
  height: number;
  /** Optional label e.g. "mobile", "tablet", "desktop" */
  label?: string;
}

export interface ScreenshotOptions {
  /** Target URL for the Vite Dev Server. */
  target?: string;
  /** Screenshot mode. */
  mode?: ScreenshotMode;
  /** Capture full-page scroll (browser mode only). */
  fullPage?: boolean;
  /** Viewport width (ignored if viewports is set). */
  width?: number;
  /** Viewport height (ignored if viewports is set). */
  height?: number;
  /** Multiple viewports for responsive test. */
  viewports?: ViewportConfig[];
  /** Compare with previous screenshot to detect changes. */
  compareWithPrevious?: boolean;
  /** ms to wait after page load for async rendering. */
  waitAfterLoad?: number;
}

export interface ScreenshotResult {
  /** Base64-encoded JPEG screenshot (Layer 1). */
  layer1: string;
  /** Structured DOM metadata (Layer 2). */
  layer2: DOMSnapshot;
  /** Human-readable summary (Layer 3). */
  layer3: string;
  /** Pixel diff against previous screenshot (if compareWithPrevious). */
  diff?: DiffInfo;
  /** Array of per-viewport results (if viewports was set). */
  responsive?: PerViewportResult[];
}

export interface PerViewportResult {
  viewport: { width: number; height: number; label?: string };
  result: ScreenshotResult;
}

export interface DiffInfo {
  hasChanges: boolean;
  /** Percentage of pixels that changed (0–100). */
  changedPercent: number;
  /** Total number of changed pixels. */
  changedPixels: number;
  /** Bounding boxes of changed regions. */
  regions: Array<{ x: number; y: number; width: number; height: number }>;
  /** Base64-encoded diff overlay image (red = changed). */
  diffImage: string;
}

export interface DOMSnapshot {
  viewport: { width: number; height: number };
  elements: DOMElementInfo[];
  consoleErrors: ConsoleErrorInfo[];
  timestamp: string;
}

export interface DOMElementInfo {
  tag: string;
  text: string | null;
  rect: { x: number; y: number; width: number; height: number };
  visible: boolean;
  role: string | null;
  ariaLabel: string | null;
}

export interface ConsoleErrorInfo {
  type: 'network' | 'runtime' | 'other';
  message: string;
  count: number;
}

// ─── Previous screenshot store (for diff comparison) ──────────────────────

interface StoredScreenshot {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  timestamp: string;
}

let previousScreenshot: StoredScreenshot | null = null;

// ─── Chrome discovery ───────────────────────────────────────────────────────

const COMMON_CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

function findChromeExecutable(): string | null {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  try {
    const which = os.platform() === 'win32' ? 'where' : 'which';
    const result = execSync(
      `${which} google-chrome chromium chromium-browser chrome google-chrome-stable 2>/dev/null`,
      { encoding: 'utf-8', timeout: 5000 },
    );
    const first = result.split('\n')[0]?.trim();
    if (first && fs.existsSync(first)) return first;
  } catch { /* ignore */ }

  const platform = os.platform() as keyof typeof COMMON_CHROME_PATHS;
  const candidates = COMMON_CHROME_PATHS[platform] ?? [];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  if (platform === 'darwin') {
    try {
      const result = execSync(
        `mdfind "kMDItemKind == 'Application' && (kMDItemDisplayName == 'Google Chrome' || kMDItemDisplayName == 'Chromium' || kMDItemDisplayName == 'Microsoft Edge')" 2>/dev/null | head -1`,
        { encoding: 'utf-8', timeout: 5000 },
      );
      const app = result.trim();
      if (app) {
        const executable = path.join(app, 'Contents', 'MacOS', path.basename(app).replace('.app', ''));
        if (fs.existsSync(executable)) return executable;
      }
    } catch { /* ignore */ }
  }
  return null;
}

// ─── Console error classification ──────────────────────────────────────────

function classifyConsoleError(text: string): ConsoleErrorInfo['type'] {
  if (
    text.includes('Failed to load') || text.includes('net::ERR_') ||
    text.includes('NetworkError') || (text.includes('fetch') && text.includes('fail'))
  ) {
    return 'network';
  }
  if (
    text.includes('Error:') || text.includes('TypeError:') ||
    text.includes('ReferenceError:') || text.includes('SyntaxError:') ||
    text.includes('Uncaught') || text.includes('React') ||
    (text.includes('minified') && text.includes('react'))
  ) {
    return 'runtime';
  }
  return 'other';
}

// ─── DOM metadata extraction ──────────────────────────────────────────────

async function extractDomElements(page: Page): Promise<DOMElementInfo[]> {
  return page.evaluate(() => {
    const elements: DOMElementInfo[] = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const text = el.textContent?.trim().substring(0, 120) || null;
        const role = el.getAttribute('role');
        const ariaLabel = el.getAttribute('aria-label');
        elements.push({
          tag: el.tagName.toLowerCase(),
          text: text && text.length > 0 ? text : null,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          visible: rect.width > 0 && rect.height > 0,
          role: role || null,
          ariaLabel: ariaLabel || null,
        });
      }
    }
    return elements;
  });
}

// ─── Image diff (sharp + pixelmatch) ───────────────────────────────────────

/**
 * Compare two images and return diff info.
 */
async function compareImages(
  img1Buffer: Buffer,
  img2Buffer: Buffer,
  _label: string,
): Promise<DiffInfo> {
  const sharp = await getSharp();
  if (!sharp) {
    // sharp not available — report diff as unknown
    return { hasChanges: true, changedPercent: 0, changedPixels: 0, regions: [], diffImage: '' };
  }

  // Decode both images to raw RGBA at the same dimensions
  const meta1 = await sharp(img1Buffer).metadata();
  const meta2 = await sharp(img2Buffer).metadata();

  const w = Math.min(meta1.width ?? 0, meta2.width ?? 0);
  const h = Math.min(meta1.height ?? 0, meta2.height ?? 0);

  if (w === 0 || h === 0) {
    return { hasChanges: true, changedPercent: 100, changedPixels: 0, regions: [], diffImage: '' };
  }

  const [raw1, raw2] = await Promise.all([
    sharp(img1Buffer).resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(img2Buffer).resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  // Allocate output buffer for diff
  const diffOutput = new Uint8Array(w * h * 4);

  const changedPixels = pixelmatch(raw1.data, raw2.data, diffOutput, w, h, {
    threshold: 0.1,
    includeAA: true,
    alpha: 0.3,
  });

  const totalPixels = w * h;
  const changedPercent = totalPixels > 0 ? (changedPixels / totalPixels) * 100 : 0;

  // Encode diff overlay as PNG
  const diffPng = await sharp(Buffer.from(diffOutput), {
    raw: { width: w, height: h, channels: 4 },
  }).png().toBuffer();

  // Extract changed regions (bounding boxes of non-black pixels)
  const regions = extractChangedRegions(diffOutput, w, h);

  return {
    hasChanges: changedPixels > 0,
    changedPercent: Math.round(changedPercent * 100) / 100,
    changedPixels,
    regions,
    diffImage: `data:image/png;base64,${diffPng.toString('base64')}`,
  };
}

/**
 * Extract bounding boxes of changed pixels from a diff image.
 * Uses a simple grid-based approach to find contiguous change regions.
 */
function extractChangedRegions(
  diffData: Uint8Array,
  width: number,
  height: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  // If too many changed pixels, return a single bounding box
  let changedCount = 0;
  for (let i = 0; i < diffData.length; i += 4) {
    if (diffData[i] > 0 || diffData[i + 1] > 0 || diffData[i + 2] > 0) {
      changedCount++;
    }
  }

  // For simplicity, return one bounding box around all changes
  if (changedCount === 0) return [];

  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (diffData[i] > 0 || diffData[i + 1] > 0 || diffData[i + 2] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) return [];

  return [{
    x: minX, y: minY,
    width: maxX - minX, height: maxY - minY,
  }];
}

// ─── Summary generation ────────────────────────────────────────────────────

function generateSummary(snapshot: DOMSnapshot, extras?: {
  diff?: DiffInfo;
  viewportLabel?: string;
}): string {
  const lines: string[] = [];
  const label = extras?.viewportLabel;
  const prefix = label ? `[${label}] ` : '';
  const separator = label ? `═══════════════════════════════════════` : '';

  if (separator) lines.push(separator);
  lines.push(`${prefix}📐 Viewport: ${snapshot.viewport.width}×${snapshot.viewport.height}`);
  lines.push(`${prefix}📦 Total visible elements: ${snapshot.elements.length}`);

  // Diff summary
  if (extras?.diff) {
    const d = extras.diff;
    if (d.hasChanges) {
      lines.push(`${prefix}🔄 Changed: ${d.changedPercent}% of pixels (${d.changedPixels}px)`);
      for (const r of d.regions) {
        lines.push(`   Region: (${r.x},${r.y}) ${r.width}×${r.height}`);
      }
    } else {
      lines.push(`${prefix}✅ No visual changes detected.`);
    }
  }

  lines.push('');

  // Headings
  const headings = snapshot.elements.filter(e => /^h[1-6]$/.test(e.tag));
  if (headings.length > 0) {
    lines.push(`${prefix}📝 Headings:`);
    for (const h of headings) {
      if (h.text) lines.push(`  • ${h.text.substring(0, 80)}`);
    }
    lines.push('');
  }

  // Interactive elements
  const buttons = snapshot.elements.filter(e => e.tag === 'button' || e.role === 'button');
  const inputs = snapshot.elements.filter(e => /input|select|textarea/.test(e.tag));
  const links = snapshot.elements.filter(e => e.tag === 'a');
  const images = snapshot.elements.filter(e => e.tag === 'img');

  if (buttons.length > 0) {
    lines.push(`${prefix}🔘 Buttons (${buttons.length}):`);
    for (const b of buttons.slice(0, 10)) {
      lines.push(`  • ${b.text?.substring(0, 60) || b.ariaLabel || '(icon)'}`);
    }
    if (buttons.length > 10) lines.push(`  … and ${buttons.length - 10} more`);
    lines.push('');
  }

  if (inputs.length > 0) lines.push(`${prefix}⌨️ Inputs (${inputs.length})\n`);
  if (links.length > 0) lines.push(`${prefix}🔗 Links (${links.length})\n`);
  if (images.length > 0) lines.push(`${prefix}🖼️ Images (${images.length})\n`);

  // Console errors
  if (snapshot.consoleErrors.length > 0) {
    lines.push(`${prefix}⚠️ Console issues:`);
    for (const err of snapshot.consoleErrors) {
      const icon = err.type === 'network' ? '🌐' : '🐛';
      lines.push(`  ${icon} [${err.type}] ${err.message.substring(0, 120)} (×${err.count})`);
    }
  } else {
    lines.push(`${prefix}✅ No console errors.`);
  }

  return lines.join('\n');
}

// ─── Puppeteer launch helper ───────────────────────────────────────────────

async function launchBrowser(width: number, height: number): Promise<Browser> {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error(
      'Chrome/Chromium not found. Install Google Chrome, Chromium, or Microsoft Edge. ' +
      'Set CHROME_PATH env var to point to your browser executable.',
    );
  }

  return puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--window-size=${width},${height}`,
    ],
  });
}

async function capturePage(
  browser: Browser,
  url: string,
  width: number,
  height: number,
  fullPage: boolean,
  waitAfterLoad: number,
  storeForDiff: boolean,
): Promise<{
  result: ScreenshotResult;
  rawBuffer: Buffer;
  rawMime: 'image/jpeg' | 'image/png';
}> {
  const page: Page = await browser.newPage();
  await page.setViewport({ width, height });

  const seenErrors = new Map<string, number>();

  page.on('console', (msg: any) => {
    const text = msg.text();
    if (msg.type() === 'error' || msg.type() === 'warning') {
      seenErrors.set(text, (seenErrors.get(text) ?? 0) + 1);
    }
  });
  page.on('pageerror', (err: any) => {
    seenErrors.set(err.message, (seenErrors.get(err.message) ?? 0) + 1);
  });

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  if (waitAfterLoad > 0) await new Promise((r) => setTimeout(r, waitAfterLoad));

  // Collect console errors
  const consoleErrors: ConsoleErrorInfo[] = [];
  for (const [message, count] of seenErrors) {
    consoleErrors.push({
      type: classifyConsoleError(message),
      message: message.length > 200 ? message.substring(0, 200) + '…' : message,
      count,
    });
  }

  // Screenshot as raw Buffer (store for diff + convert to base64)
  const rawScreenshot = await page.screenshot({
    type: 'jpeg',
    quality: 70,
    fullPage,
    encoding: 'binary',
  });
  const rawBuffer = Buffer.from(rawScreenshot);

  // DOM metadata
  const elements = await extractDomElements(page);
  const viewport = page.viewport()!;
  const snapshot: DOMSnapshot = {
    viewport: { width: viewport.width, height: viewport.height },
    elements,
    consoleErrors,
    timestamp: new Date().toISOString(),
  };

  const summary = generateSummary(snapshot);

  // Store for future diff
  if (storeForDiff) {
    previousScreenshot = {
      buffer: rawBuffer,
      mimeType: 'image/jpeg',
      width: viewport.width,
      height: viewport.height,
      timestamp: snapshot.timestamp,
    };
  }

  return {
    result: {
      layer1: `data:image/jpeg;base64,${rawBuffer.toString('base64')}`,
      layer2: snapshot,
      layer3: summary,
    },
    rawBuffer,
    rawMime: 'image/jpeg',
  };
}

// ─── Browser mode screenshot ───────────────────────────────────────────────

async function takeBrowserScreenshot(
  url: string,
  fullPage: boolean,
  width: number,
  height: number,
  waitAfterLoad: number,
  compareWithPrevious: boolean,
  viewports?: ViewportConfig[],
): Promise<ScreenshotResult> {
  // ── Responsive mode ──────────────────────────────────────────────────
  if (viewports && viewports.length > 0) {
    return takeResponsiveScreenshots(url, fullPage, viewports, waitAfterLoad, compareWithPrevious);
  }

  const browser = await launchBrowser(width, height);
  try {
    const { result, rawBuffer } = await capturePage(
      browser, url, width, height, fullPage, waitAfterLoad, compareWithPrevious,
    );

    // ── Diff comparison ────────────────────────────────────────────────
    if (compareWithPrevious && previousScreenshot) {
      try {
        // Make sure dimensions match for diff
        const diff = await compareImages(previousScreenshot.buffer, rawBuffer, '');
        if (diff.hasChanges) {
          result.diff = diff;
          result.layer3 += `\n\n🔄 Visual diff: ${diff.changedPercent}% of pixels changed (${diff.changedPixels}px)`;
          if (diff.regions.length > 0) {
            const r = diff.regions[0];
            result.layer3 += `\n   Main changed region: (${r.x},${r.y}) ${r.width}×${r.height}`;
          }
          result.layer3 += `\n   Use the diffImage in layer1 response for a visual overlay.`;
        } else {
          result.layer3 += `\n\n✅ No visual changes since last screenshot.`;
        }
      } catch (e: any) {
        result.layer3 += `\n\n⚠️ Diff comparison failed: ${e.message}`;
      }
    }

    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─── Responsive mode ──────────────────────────────────────────────────────

async function takeResponsiveScreenshots(
  url: string,
  fullPage: boolean,
  viewports: ViewportConfig[],
  waitAfterLoad: number,
  _compareWithPrevious: boolean,
): Promise<ScreenshotResult> {
  const perViewport: PerViewportResult[] = [];
  let accumulatedSummary = `📱 Responsive screenshot: ${viewports.length} viewports\n\n`;

  for (const vp of viewports) {
    const browser = await launchBrowser(vp.width, vp.height);
    try {
      const { result } = await capturePage(
        browser, url, vp.width, vp.height, fullPage, waitAfterLoad, false,
      );

      const label = vp.label || `${vp.width}×${vp.height}`;
      perViewport.push({
        viewport: { width: vp.width, height: vp.height, label: vp.label },
        result,
      });

      accumulatedSummary += `[${label}] ${result.layer3.split('\n').join('\n  ')}\n\n`;
    } finally {
      await browser.close().catch(() => {});
    }
  }

  // Use the last viewport's snapshot as the "primary" one
  const lastResult = perViewport[perViewport.length - 1].result;

  // Build combined DOM snapshot
  const combinedSnapshot: DOMSnapshot = {
    ...lastResult.layer2,
    viewport: { width: 0, height: 0 },
    timestamp: new Date().toISOString(),
  };

  return {
    layer1: lastResult.layer1,
    layer2: combinedSnapshot,
    layer3: accumulatedSummary.trim(),
    responsive: perViewport,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Take a screenshot of the generated app and return 3 layers of data.
 *
 * Features:
 *  - Browser mode: headless Chrome → Vite Dev Server (fast, layout-accurate)
 *  - Responsive: pass multiple viewports for a responsive test
 *  - Diff: compare with previous screenshot to detect pixel changes
 *
 * @param options  Screenshot configuration.
 * @returns        Multi-layer result with optional diff and responsive data.
 */
export async function takeScreenshot(
  options: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
  const {
    target = 'http://localhost:5174',
    fullPage = true,
    width = 1280,
    height = 720,
    viewports,
    compareWithPrevious = false,
    waitAfterLoad = 1500,
  } = options;

  return takeBrowserScreenshot(
    target, fullPage, width, height, waitAfterLoad, compareWithPrevious, viewports,
  );
}

/**
 * Clear the stored previous screenshot (e.g. at the start of a new session).
 */
export function clearScreenshotCache(): void {
  previousScreenshot = null;
}
