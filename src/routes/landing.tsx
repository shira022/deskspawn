/**
 * ランディングページ — DeskSpawn Web
 *
 * i18n 対応の製品紹介ページ。
 * ユーザーの言語設定に応じて日本語/英語を表示する。
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SETTINGS_KEY } from "@/lib/constants";
import {
  Sparkles,
  ArrowRight,
  Bot,
  Globe,
  Cpu,
  Shield,

  Terminal,
  Play,
  Monitor,
  Github,
  Sun,
  Moon,
} from "lucide-react";

// ── 言語切替 ──────────────────────────────────────────────────────────────────

function saveLanguage(code: string) {
  localStorage.setItem("deskspawn_language", code);
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const settings = raw ? JSON.parse(raw) : {};
    settings.language = code;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // non-critical
  }
}

/** 小さな言語切替ボタン（ヘッダー右上に表示） */
function LanguageToggle({ i18n }: { i18n: any }) {
  const langs = [
    { code: "ja", label: "日本語" },
    { code: "en", label: "English" },
  ];
  const current = i18n.language?.startsWith("ja") ? "ja" : "en";

  const switchLang = (code: string) => {
    i18n.changeLanguage(code);
    saveLanguage(code);
  };

  // 現在の言語を先頭に並べ替え
  const sorted = [...langs].sort((a) => (a.code === current ? -1 : 1));

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card/50 p-0.5 shadow-sm">
      {sorted.map((lang) => (
        <button
          key={lang.code}
          onClick={() => switchLang(lang.code)}
          className={`
            flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium
            transition-all duration-200
            ${
              lang.code === current
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }
          `}
        >
          <Globe className="h-3 w-3" />
          {lang.label}
        </button>
      ))}
    </div>
  );
}

// ── テーマ切替 ────────────────────────────────────────────────────────────────

function getTheme(): "light" | "dark" {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.theme === "dark") return "dark";
      if (s.theme === "light") return "light";
      if (s.theme === "system") {
        return window.matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light";
      }
    }
  } catch {}
  // 未設定または system で OS が light → light
  return window.matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light";
}

function saveTheme(theme: "light" | "dark") {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const settings = raw ? JSON.parse(raw) : {};
    settings.theme = theme;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
  // HTML クラスを直接書き換えて瞬時に反映
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** 小さなテーマ切替ボタン（ヘッダーに表示） */
function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(getTheme);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    saveTheme(next);
  };

  return (
    <button
      onClick={toggle}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ── アプリUIを模したデモ ─────────────────────────────────────────────────────
// 実際の DeskSpawn の2ペインレイアウトを再現し、生成プロセスを見せる。

type AppDemoStage =
  | "init"
  | "user-typing"
  | "generating"
  | "preview"
  | "complete";

function AppDemo() {
  const { i18n } = useTranslation();

  const isJa = i18n.language?.startsWith("ja");

  // ── ステージ進行 ──────────────────────────────────────────
  const [stage, setStage] = useState<AppDemoStage>("init");
  useEffect(() => {
    const seq: { stage: AppDemoStage; delay: number }[] = [
      { stage: "user-typing", delay: 700 },
      { stage: "generating", delay: 3000 },
      { stage: "preview", delay: 4000 },
      { stage: "complete", delay: 3000 },
    ];
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (idx >= seq.length) {
        // Loop: 一旦リセットして2秒後に再開
        idx = 0;
        timer = setTimeout(() => {
          setStage("init");
          timer = setTimeout(tick, 400);
        }, 2000);
        return;
      }
      const { stage: s, delay } = seq[idx];
      timer = setTimeout(() => { setStage(s); idx++; tick(); }, delay);
    };
    const init = setTimeout(tick, 900);
    return () => { clearTimeout(init); clearTimeout(timer); };
  }, [isJa]);

  // ── タイプライター ────────────────────────────────────────
  const userMsg = isJa ? "タスク管理アプリを作って" : "Create a task management app";
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (stage !== "user-typing") return;
    setTyped("");
    let i = 0;
    const iv = setInterval(() => {
      if (i <= userMsg.length) { setTyped(userMsg.substring(0, i)); i++; }
      else clearInterval(iv);
    }, 22);
    return () => clearInterval(iv);
  }, [stage, userMsg]);

  // ── コード生成ステップ進行 ──────────────────────────────
  const [genStep, setGenStep] = useState(0);
  const genSteps = isJa
    ? ["要件を分析中...", "プロジェクトを作成中...", "コードを生成中...", "エラーをチェック中...", "アプリを起動中..."]
    : ["Analyzing requirements...", "Creating project...", "Generating code...", "Checking for errors...", "Starting app..."];
  useEffect(() => {
    if (stage !== "generating") return;
    setGenStep(0);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i < genSteps.length) setGenStep(i);
      else clearInterval(iv);
    }, 1000);
    return () => clearInterval(iv);
  }, [stage, isJa]);

  return (
    <div className="rounded-xl border bg-card shadow-lg overflow-hidden">
      {/* ── ツールバー ── */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
          </div>
          <span className="ml-1.5 text-xs font-semibold">DeskSpawn</span>
          <span className="text-[10px] text-muted-foreground ml-1 hidden sm:inline">
            / {isJa ? "タスク管理" : "task-manager"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-5 w-16 rounded bg-muted-foreground/10" />
          <div className="h-5 w-5 rounded bg-muted-foreground/10" />
        </div>
      </div>

      {/* ── メインエリア: 2ペイン ── */}
      <div className="flex h-[340px] sm:h-[380px]">
        {/* ── 左: チャットパネル ── */}
        <div className="flex w-[45%] flex-col border-r">
          <div className="border-b bg-muted/20 px-3 py-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {isJa ? "チャット" : "Chat"}
            </span>
          </div>
          <div className="flex-1 space-y-2 overflow-hidden p-3">
            {/* ユーザーメッセージ */}
            {(stage === "user-typing" || stage === "generating" || stage === "preview" || stage === "complete") && (
              <div className="flex justify-end">
                <div className="max-w-[90%] rounded-xl rounded-br-sm bg-primary px-3 py-2 text-xs text-primary-foreground">
                  {stage === "user-typing" ? (
                    <span>{typed}<span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-primary-foreground/70" /></span>
                  ) : userMsg}
                </div>
              </div>
            )}

            {/* 生成ステップ */}
            {stage === "generating" && (
              <div className="space-y-2">
                {/* AIアイコン */}
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                    <Bot className="h-3 w-3 text-foreground" />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground">AI</span>
                </div>
                {/* ステップリスト */}
                <div className="ml-7 space-y-1.5">
                  {genSteps.slice(0, genStep + 1).map((stepText, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground animate-in fade-in slide-in-from-left-1 duration-300"
                    >
                      {i < genSteps.length - 1 ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      ) : genStep < genSteps.length - 1 ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      )}
                      {stepText}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* プレビュー表示: チャットに完了メッセージ */}
            {(stage === "preview" || stage === "complete") && (
              <div className="space-y-2 animate-in fade-in slide-in-from-bottom-1 duration-500">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                    <Bot className="h-3 w-3 text-foreground" />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground">AI</span>
                </div>
                <div className="ml-7 space-y-1">
                  {genSteps.map((stepText, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      <span className="line-through opacity-60">{stepText}</span>
                      <span className="ml-auto text-[10px] text-green-600 dark:text-green-400">✓</span>
                    </div>
                  ))}
                </div>
                <div className="ml-7 rounded-lg border border-green-500/20 bg-green-500/5 px-2.5 py-2 text-[11px] font-medium text-green-600 dark:text-green-400">
                  {isJa ? "✅ アプリの生成が完了しました" : "✅ App generation complete"}
                </div>
              </div>
            )}

            {/* 初期状態: ヒント */}
            {stage === "init" && (
              <div className="flex h-full items-center justify-center">
                <div className="space-y-2 text-center">
                  <div className="flex justify-center gap-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground/50">
                    {isJa ? "アプリの説明を入力..." : "Describe your app..."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 右: プレビューパネル ── */}
        <div className="flex flex-1 flex-col">
          <div className="border-b bg-muted/20 px-3 py-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {isJa ? "プレビュー" : "Preview"}
            </span>
          </div>
          <div className="flex flex-1 items-center justify-center bg-[#f8f8f8] dark:bg-[#1a1a1a] p-3">
            {stage === "complete" || stage === "preview" ? (
              /* ── 生成されたアプリのモックアップ ── */
              <div className="h-full w-full animate-in fade-in zoom-in-95 duration-700 rounded-lg border bg-white p-3 shadow-sm dark:bg-[#0d0d0d] dark:border-zinc-800">
                <div className="flex h-full flex-col gap-2 text-xs">
                  {/* アプリヘッダー */}
                  <div className="flex items-center justify-between border-b pb-1.5 dark:border-zinc-800">
                    <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
                      {isJa ? "📋 タスク管理" : "📋 Task Manager"}
                    </h3>
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      v1.0
                    </span>
                  </div>
                  {/* 入力エリア */}
                  <div className="flex gap-1">
                    <div className="h-6 flex-1 rounded border border-zinc-200 bg-zinc-50 px-2 text-[10px] leading-6 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
                      {isJa ? "新しいタスクを入力..." : "Add a new task..."}
                    </div>
                    <div className="flex h-6 w-12 items-center justify-center rounded bg-zinc-800 text-[10px] text-white dark:bg-zinc-200 dark:text-zinc-800">
                      + {isJa ? "追加" : "Add"}
                    </div>
                  </div>
                  {/* タスクリスト */}
                  <div className="flex-1 space-y-1">
                    {[
                      { label: isJa ? "牛乳を買う" : "Buy groceries", done: false },
                      { label: isJa ? "レポートを提出" : "Finish report", done: true },
                      { label: isJa ? "歯医者を予約" : "Call dentist", done: false },
                    ].map((task, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded border border-zinc-100 px-2 py-1.5 dark:border-zinc-800"
                        style={{ animationDelay: `${i * 150}ms` }}
                      >
                        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border text-[8px] ${
                          task.done
                            ? "border-green-500 bg-green-500 text-white"
                            : "border-zinc-300 dark:border-zinc-600"
                        }`}>
                          {task.done ? "✓" : ""}
                        </span>
                        <span className={`flex-1 ${task.done ? "text-zinc-400 line-through" : "text-zinc-700 dark:text-zinc-300"}`}>
                          {task.label}
                        </span>
                        <span className="text-zinc-300 dark:text-zinc-600">✕</span>
                      </div>
                    ))}
                  </div>
                  {/* フッター */}
                  <div className="border-t pt-1.5 text-[10px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                    {isJa ? "3件のタスク • 1件完了" : "3 tasks • 1 done"}
                  </div>
                </div>
              </div>
            ) : (
              /* ── プレビュー未準備 ── */
              <div className="flex flex-col items-center gap-2 text-center">
                <Monitor className={`h-8 w-8 text-muted-foreground/20 transition-all duration-700 ${
                  stage === "generating" ? "animate-pulse text-primary/30" : ""
                }`} />
                <p className="text-[11px] text-muted-foreground/40">
                  {stage === "generating"
                    ? (isJa ? "アプリを準備中..." : "Preparing preview...")
                    : (isJa ? "アプリがここに表示されます" : "Your app will appear here")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── ステータスバー ── */}
      <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-1">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${
            stage === "complete" ? "bg-green-500" : stage === "generating" ? "bg-amber-400 animate-pulse" : "bg-zinc-300"
          }`} />
          <span className="text-[10px] text-muted-foreground">
            {stage === "init" && (isJa ? "準備完了" : "Ready")}
            {stage === "user-typing" && (isJa ? "入力を検出..." : "Input detected...")}
            {stage === "generating" && (isJa ? "生成中..." : "Generating...")}
            {stage === "preview" && (isJa ? "プレビュー準備完了" : "Preview ready")}
            {stage === "complete" && (isJa ? "✅ 完了" : "✅ Complete")}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/40">
          {isJa ? "データはブラウザ内に留まります" : "Data stays in your browser"}
        </span>
      </div>
    </div>
  );
}

// ── 機能カード ────────────────────────────────────────────────────────────────

interface FeatureCardProps {
  icon: React.ReactNode;
  titleKey: string;
  descKey: string;
}

function FeatureCard({ icon, titleKey, descKey }: FeatureCardProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border bg-card p-5 space-y-2 hover:border-primary/50 transition-colors">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="font-semibold text-sm">{t(titleKey)}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{t(descKey)}</p>
    </div>
  );
}

// ── メインページ ──────────────────────────────────────────────────────────────

export function LandingPage() {
  const { t, i18n } = useTranslation();

  const handleGetStarted = useCallback(() => {
    localStorage.setItem("deskspawn_route", "/app");
    window.location.reload();
  }, []);

  return (
    <div className="min-h-screen bg-background">

      {/* ── ナビゲーションバー (固定) ──────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="flex items-center justify-between px-6 py-3 max-w-5xl mx-auto">
          <span className="text-lg font-bold tracking-tight">DeskSpawn</span>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/shira022/deskspawn"
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
            <ThemeToggle />
            <LanguageToggle i18n={i18n} />
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10 pointer-events-none" />
        <div className="max-w-5xl mx-auto px-6 py-12 sm:py-24 relative">
          <div className="text-center space-y-6 max-w-2xl mx-auto">
            <Badge variant="secondary" className="gap-1 text-xs">
              <Sparkles className="h-3 w-3" />
              {t("landing.badge")}
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
              {t("landing.hero.title1")}
              <span className="text-primary"> {t("landing.hero.title2")}</span>
            </h1>
            <p className="text-muted-foreground text-lg leading-relaxed">
              {t("landing.hero.subtitle")}
            </p>
            <div className="flex items-center justify-center pt-4">
              <Button size="lg" onClick={handleGetStarted}>
                <Play className="h-4 w-4 mr-2" />
                {t("landing.hero.tryButton")}
              </Button>
            </div>
          </div>

          {/* Demo */}
          <div className="mt-12 max-w-[720px] mx-auto px-2 sm:px-0">
            <AppDemo />
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold tracking-tight">{t("landing.features.title")}</h2>
          <p className="text-muted-foreground mt-2">{t("landing.features.subtitle")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<Sparkles className="h-5 w-5" />}
            titleKey="landing.features.item1Title"
            descKey="landing.features.item1Desc"
          />
          <FeatureCard
            icon={<Shield className="h-5 w-5" />}
            titleKey="landing.features.item2Title"
            descKey="landing.features.item2Desc"
          />
          <FeatureCard
            icon={<Globe className="h-5 w-5" />}
            titleKey="landing.features.item3Title"
            descKey="landing.features.item3Desc"
          />
          <FeatureCard
            icon={<Bot className="h-5 w-5" />}
            titleKey="landing.features.item4Title"
            descKey="landing.features.item4Desc"
          />
          <FeatureCard
            icon={<Terminal className="h-5 w-5" />}
            titleKey="landing.features.item5Title"
            descKey="landing.features.item5Desc"
          />
          <FeatureCard
            icon={<Cpu className="h-5 w-5" />}
            titleKey="landing.features.item6Title"
            descKey="landing.features.item6Desc"
          />
        </div>
      </section>

      <Separator />

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20 text-center">
        <h2 className="text-2xl font-bold tracking-tight">{t("landing.cta.title")}</h2>
        <p className="text-muted-foreground mt-2 mb-6">{t("landing.cta.subtitle")}</p>
        <Button size="lg" onClick={handleGetStarted}>
          {t("landing.cta.button")}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t bg-muted/20">
        <div className="max-w-5xl mx-auto px-6 py-8 text-center text-xs text-muted-foreground">
          <p>{t("landing.footer")}</p>
          <p className="mt-1">
            <a href="https://github.com/shira022/deskspawn" className="hover:text-foreground transition-colors">
              GitHub
            </a>
            {" · "}
            <span>MIT License</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
