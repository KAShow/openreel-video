import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import { ArrowRight, Clock, Plus } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { SOCIAL_MEDIA_PRESETS } from "@openreel/core";
import { useRouter } from "../../hooks/use-router";
import { useEditorPreload } from "../../hooks/useEditorPreload";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import { useHawshStore } from "../../hawsh/session";

const TemplateGallery = lazy(() =>
  import("./TemplateGallery").then((module) => ({ default: module.TemplateGallery })),
);
const RecentProjects = lazy(() =>
  import("./RecentProjects").then((module) => ({ default: module.RecentProjects })),
);

const LoadingView = () => <div role="status" className="p-6 text-center text-text-secondary">جاري التحميل…</div>;
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const OpenReelLogo: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg
    viewBox="0 0 490 490"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path
      d="M245 24.5C123.223 24.5 24.5 123.223 24.5 245s98.723 220.5 220.5 220.5 220.5-98.723 220.5-220.5S366.777 24.5 245 24.5Z"
      stroke="currentColor"
      strokeWidth="30.625"
    />
    <g>
      <path
        d="M245 98v73.5"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="M392 245h-73.5"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="M245 392v-73.5"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="M98 245h73.5"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="m348.941 141.059-51.965 51.965"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="m348.941 348.941-51.965-51.965"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="m141.059 348.941 51.965-51.965"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
      <path
        d="m141.059 141.059 51.965 51.965"
        stroke="currentColor"
        strokeWidth="24.5"
        strokeLinecap="round"
      />
    </g>
    <path
      d="M294 245a49 49 0 0 1-49 49 49 49 0 0 1-49-49 49 49 0 0 1 98 0"
      fill="currentColor"
    />
  </svg>
);

type ViewMode = "home" | "templates" | "recent";

interface WelcomeScreenProps {
  initialTab?: "templates" | "recent";
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ initialTab }) => {
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const email = useHawshStore((state) => state.email);
  const { navigate } = useRouter();
  const { track } = useAnalytics();

  const [viewMode, setViewMode] = useState<ViewMode>(initialTab ?? "home");
  const displayName = email?.split("@")[0];

  useEditorPreload(true);

  const handleCreateProject = useCallback(() => {
    const preset = SOCIAL_MEDIA_PRESETS.tiktok;
    createNewProject("مشروع جديد", {
      width: preset.width,
      height: preset.height,
      frameRate: preset.frameRate,
    });
    track(AnalyticsEvents.PROJECT_CREATED, {
      preset: "tiktok",
      width: preset.width,
      height: preset.height,
      frameRate: preset.frameRate ?? 30,
      source: "quick_start",
    });
    navigate("editor");
  }, [createNewProject, navigate, track]);

  const handleTemplateApplied = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  const handleProjectSelected = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewMode !== "home") {
          setViewMode("home");
        } else {
          navigate("editor");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, viewMode]);

  if (viewMode === "templates") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <Button
            label="Back"
            variant="ghost"
            size="sm"
            icon={<ArrowRight className="rotate-180" size={16} aria-hidden />}
            onClick={() => setViewMode("home")}
          />
          <Text type="label" color="primary" weight="medium" className="text-sm text-text-primary">Templates</Text>
          <div className="w-16" />
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <Suspense fallback={<LoadingView />}>
            <TemplateGallery onTemplateApplied={handleTemplateApplied} />
          </Suspense>
        </div>
      </div>
    );
  }

  if (viewMode === "recent") {
    return (
      <div dir="rtl" data-ar className="fixed inset-0 z-50 flex flex-col bg-background">
        <header className="relative z-10 border-b border-border bg-background/95 backdrop-blur-xl">
          <div className="mx-auto flex h-[72px] w-full max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-9 w-9 shrink-0 text-primary">
                <OpenReelLogo className="h-full w-full" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-text-primary">Director's Eyes</div>
                <div className="mt-0.5 text-[11px] text-text-muted">مشاريعك تبدأ من هنا</div>
              </div>
            </div>
            <Button
              label="مشروع جديد"
              variant="primary"
              icon={<Plus size={17} aria-hidden />}
              onClick={handleCreateProject}
              className="shrink-0 rounded-xl shadow-glow"
            />
          </div>
        </header>
        <main className="relative flex-1 overflow-y-auto">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_65%)] opacity-30" />
          <div className="relative mx-auto w-full max-w-[1440px] px-4 py-7 sm:px-6 sm:py-10 lg:px-10">
            <Suspense fallback={<LoadingView />}>
              <RecentProjects
                onProjectSelected={handleProjectSelected}
                onCreateProject={handleCreateProject}
              />
            </Suspense>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div dir="rtl" data-ar className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <header className="mx-auto flex h-20 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 text-primary">
            <OpenReelLogo className="h-full w-full" />
          </div>
          <div>
            <div className="text-sm font-semibold text-text-primary">محرر عيون المخرج</div>
            {/* MIT attribution: this editor is a modified OpenReel (see /LICENSE.txt). */}
            <a
              href="/LICENSE.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block text-[11px] text-text-muted hover:text-text-secondary"
            >
              مبني على OpenReel
            </a>
          </div>
        </div>
        {displayName && (
          <div className="flex items-center gap-2 text-xs text-text-secondary" title={email ?? undefined}>
            <span className="hidden max-w-32 truncate sm:block">{displayName}</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background-secondary text-xs font-semibold text-primary">
              {Array.from(displayName)[0]?.toUpperCase()}
            </span>
          </div>
        )}
      </header>

      <main className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-md flex-col justify-center px-5 py-10 sm:px-8 sm:py-14">
        <div className="text-center">
          <p className="text-sm font-medium text-primary">
            مرحبًا{displayName ? `، ${displayName}` : " بك"}
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-text-primary sm:text-4xl">
            ماذا تريد أن تصنع اليوم؟
          </h1>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            ابدأ من جديد أو تابع مشروعًا سابقًا.
          </p>
        </div>

        <div className="mt-10 space-y-3">
          <button
            type="button"
            onClick={handleCreateProject}
            className={`flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary-hover ${focusRing}`}
          >
            <Plus size={20} aria-hidden />
            مشروع جديد
          </button>
          <button
            type="button"
            onClick={() => setViewMode("recent")}
            className={`flex h-14 w-full items-center justify-center gap-3 rounded-xl border border-border bg-background-secondary text-base font-medium text-text-primary transition-colors hover:border-primary/40 hover:bg-background-tertiary ${focusRing}`}
          >
            <Clock size={19} className="text-primary" aria-hidden />
            المشاريع السابقة
          </button>
        </div>
      </main>
    </div>
  );
};

export default WelcomeScreen;
