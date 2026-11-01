import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpLeft,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  Film,
  HardDrive,
  LayoutGrid,
  List,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "@/icons/lucide-compat";
import { autoSaveManager, checkForRecovery } from "../../services/auto-save";
import { useProjectStore } from "../../stores/project-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";

interface RecentProject {
  id: string;
  saveId: string;
  name: string;
  lastModified: number;
}

interface RecentProjectsProps {
  onProjectSelected?: () => void;
  onCreateProject?: () => void;
}

type DateFilter = "all" | "week" | "month";
type SortOrder = "recent" | "oldest" | "name";
type ViewMode = "grid" | "list";

const relativeDateFormatter = new Intl.RelativeTimeFormat("ar", {
  numeric: "auto",
});
const fullDateFormatter = new Intl.DateTimeFormat("ar", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatRelativeDate(timestamp: number): string {
  const difference = timestamp - Date.now();
  const days = Math.round(difference / 86_400_000);

  if (Math.abs(difference) < 60 * 60 * 1000) return "منذ لحظات";
  if (Math.abs(difference) < 24 * 60 * 60 * 1000) {
    return relativeDateFormatter.format(Math.round(difference / 3_600_000), "hour");
  }
  if (Math.abs(days) < 30) return relativeDateFormatter.format(days, "day");
  return new Intl.DateTimeFormat("ar", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}

function getProjectInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "ف";
}

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function RecentProjects({
  onProjectSelected,
  onCreateProject,
}: RecentProjectsProps) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [pendingDelete, setPendingDelete] = useState<RecentProject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  const recoverFromAutoSave = useProjectStore(
    (state) => state.recoverFromAutoSave,
  );
  const { track } = useAnalytics();

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const saves = await checkForRecovery();
      const projectMap = new Map<string, RecentProject>();

      for (const save of saves) {
        if (!projectMap.has(save.projectId)) {
          projectMap.set(save.projectId, {
            id: save.projectId,
            saveId: save.id,
            name: save.projectName,
            lastModified: save.timestamp,
          });
        }
      }

      setRecentProjects(
        Array.from(projectMap.values()).sort(
          (a, b) => b.lastModified - a.lastModified,
        ),
      );
    } catch (error) {
      console.error("Failed to load recent projects:", error);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!pendingDelete) return;
    cancelDeleteRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isDeleting) setPendingDelete(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [pendingDelete, isDeleting]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase("ar");
    const now = Date.now();

    return recentProjects
      .filter((project) => {
        const matchesSearch =
          !normalizedQuery ||
          project.name.toLocaleLowerCase("ar").includes(normalizedQuery);
        const matchesDate =
          dateFilter === "all" ||
          project.lastModified >=
            now - (dateFilter === "week" ? 7 : 30) * 86_400_000;
        return matchesSearch && matchesDate;
      })
      .sort((a, b) => {
        if (sortOrder === "name") return a.name.localeCompare(b.name, "ar");
        return sortOrder === "recent"
          ? b.lastModified - a.lastModified
          : a.lastModified - b.lastModified;
      });
  }, [recentProjects, searchQuery, dateFilter, sortOrder]);

  const hasActiveFilters = searchQuery.trim() !== "" || dateFilter !== "all";

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setDateFilter("all");
    searchRef.current?.focus();
  }, []);

  const handleSelectProject = useCallback(
    async (project: RecentProject) => {
      setLoadingProjectId(project.id);
      setActionError("");
      try {
        const success = await recoverFromAutoSave(project.saveId);
        if (success) {
          track(AnalyticsEvents.PROJECT_OPENED, {
            source: "recent_projects",
          });
          onProjectSelected?.();
        } else {
          setActionError("تعذّر فتح المشروع. جرّب مرة أخرى.");
        }
      } catch (error) {
        console.error("Failed to load project:", error);
        setActionError("تعذّر فتح المشروع. جرّب مرة أخرى.");
      } finally {
        setLoadingProjectId(null);
      }
    },
    [recoverFromAutoSave, onProjectSelected, track],
  );

  const handleDeleteProject = useCallback(async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    setActionError("");
    try {
      await autoSaveManager.clearProjectSaves(pendingDelete.id);
      setRecentProjects((projects) =>
        projects.filter((project) => project.id !== pendingDelete.id),
      );
      setPendingDelete(null);
    } catch (error) {
      console.error("Failed to delete project:", error);
      setActionError("تعذّر حذف المشروع. لم تُحذف أي بيانات، جرّب مرة أخرى.");
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  }, [pendingDelete]);

  return (
    <section dir="rtl" data-ar className="w-full" aria-labelledby="projects-title">
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-primary">
            <HardDrive size={15} aria-hidden />
            <span>مساحة العمل المحلية</span>
          </div>
          <h1
            id="projects-title"
            className="text-3xl font-semibold tracking-normal text-text-primary sm:text-4xl"
          >
            مشاريعك
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-text-secondary sm:text-base">
            كل ما بدأته، جاهز لتكمله. افتح مشروعًا أو ابدأ فكرة جديدة.
          </p>
        </div>
        {!isLoading && recentProjects.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span className="font-medium text-text-primary">{recentProjects.length}</span>
            <span>{recentProjects.length === 1 ? "مشروع محفوظ" : "مشاريع محفوظة"}</span>
          </div>
        )}
      </div>

      {actionError && (
        <div
          role="alert"
          className="mb-5 flex items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          <AlertCircle size={18} className="shrink-0" aria-hidden />
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError("")}
            aria-label="إغلاق رسالة الخطأ"
            className={`rounded-lg p-1 hover:bg-red-500/10 ${focusRing}`}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      )}

      {!isLoading && !loadError && recentProjects.length > 0 && (
        <div className="mb-7 rounded-2xl border border-border bg-background-secondary p-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                size={18}
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-text-muted"
                aria-hidden
              />
              <label htmlFor="projects-search" className="sr-only">
                ابحث في مشاريعك
              </label>
              <input
                ref={searchRef}
                id="projects-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="ابحث باسم المشروع…"
                className={`h-11 w-full rounded-xl border border-transparent bg-background-tertiary pr-11 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted hover:border-border focus:border-primary/50 ${searchQuery ? "pl-11" : "pl-4"}`}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    searchRef.current?.focus();
                  }}
                  aria-label="مسح البحث"
                  className={`absolute left-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-text-muted hover:bg-background-elevated hover:text-text-primary ${focusRing}`}
                >
                  <X size={15} aria-hidden />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <div className="relative">
                <label htmlFor="projects-date-filter" className="sr-only">
                  تصفية حسب تاريخ التعديل
                </label>
                <CalendarDays
                  size={15}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
                  aria-hidden
                />
                <select
                  id="projects-date-filter"
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value as DateFilter)}
                  className={`h-10 w-full appearance-none rounded-xl border border-border bg-background-tertiary py-0 pl-8 pr-9 text-xs text-text-secondary hover:border-border-hover sm:w-auto ${focusRing}`}
                >
                  <option value="all">كل التواريخ</option>
                  <option value="week">آخر 7 أيام</option>
                  <option value="month">آخر 30 يومًا</option>
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                  aria-hidden
                />
              </div>

              <div className="relative">
                <label htmlFor="projects-sort" className="sr-only">
                  ترتيب المشاريع
                </label>
                <select
                  id="projects-sort"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                  className={`h-10 w-full appearance-none rounded-xl border border-border bg-background-tertiary py-0 pl-8 pr-3 text-xs text-text-secondary hover:border-border-hover sm:w-auto ${focusRing}`}
                >
                  <option value="recent">الأحدث أولًا</option>
                  <option value="oldest">الأقدم أولًا</option>
                  <option value="name">حسب الاسم</option>
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                  aria-hidden
                />
              </div>

              <div className="col-span-2 flex h-10 items-center justify-center gap-1 rounded-xl border border-border bg-background-tertiary p-1 sm:col-span-1">
                <button
                  type="button"
                  aria-label="عرض شبكي"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                  className={`flex h-7 w-8 items-center justify-center rounded-lg transition-colors ${focusRing} ${
                    viewMode === "grid"
                      ? "bg-background-elevated text-primary shadow-sm"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  <LayoutGrid size={15} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="عرض قائمة"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                  className={`flex h-7 w-8 items-center justify-center rounded-lg transition-colors ${focusRing} ${
                    viewMode === "list"
                      ? "bg-background-elevated text-primary shadow-sm"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  <List size={16} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">جاري تحميل مشاريعك…</span>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="overflow-hidden rounded-2xl border border-border bg-background-secondary"
              >
                <div className="aspect-video animate-pulse bg-background-tertiary" />
                <div className="space-y-3 p-4">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-background-tertiary" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-background-tertiary" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : loadError ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-border bg-background-secondary px-6 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-background-tertiary text-text-muted">
            <AlertCircle size={26} aria-hidden />
          </div>
          <h2 className="text-lg font-semibold text-text-primary">لم نتمكن من تحميل مشاريعك</h2>
          <p className="mt-2 text-sm text-text-secondary">تحقق من المتصفح ثم أعد المحاولة.</p>
          <button
            type="button"
            onClick={() => void loadProjects()}
            className={`mt-6 flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover ${focusRing}`}
          >
            <RotateCcw size={16} aria-hidden />
            إعادة المحاولة
          </button>
        </div>
      ) : recentProjects.length === 0 ? (
        <div className="relative flex min-h-[430px] flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed border-border bg-background-secondary px-6 text-center">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,var(--accent-soft),transparent_50%)] opacity-60" />
          <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-border bg-background-tertiary text-primary shadow-md">
            <Clapperboard size={34} strokeWidth={1.5} aria-hidden />
          </div>
          <h2 className="relative text-xl font-semibold text-text-primary">ابدأ أول مشروع لك</h2>
          <p className="relative mt-3 max-w-sm text-sm leading-6 text-text-secondary">
            حوّل لقطاتك إلى قصة تستحق المشاهدة. ستظهر مشاريعك المحفوظة هنا لتعود إليها في أي وقت.
          </p>
          {onCreateProject && (
            <button
              type="button"
              onClick={onCreateProject}
              className={`relative mt-7 flex h-11 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-glow transition-all hover:-translate-y-0.5 hover:bg-primary-hover ${focusRing}`}
            >
              <Plus size={18} aria-hidden />
              إنشاء مشروع جديد
            </button>
          )}
          <p className="relative mt-5 text-xs text-text-muted">يُحفظ عملك محليًا على هذا الجهاز</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="flex min-h-[330px] flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-background-tertiary text-text-muted">
            <Search size={22} aria-hidden />
          </div>
          <h2 className="text-base font-semibold text-text-primary">لا توجد نتائج مطابقة</h2>
          <p className="mt-2 text-sm text-text-secondary">جرّب اسمًا آخر أو غيّر تصفية التاريخ.</p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className={`mt-5 rounded-xl border border-border bg-background-secondary px-4 py-2 text-sm text-text-primary hover:bg-background-tertiary ${focusRing}`}
            >
              مسح البحث والتصفية
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-4 text-xs text-text-muted" aria-live="polite">
            <span>
              عرض {filteredProjects.length} من {recentProjects.length}
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className={`rounded-md text-primary hover:underline ${focusRing}`}
              >
                مسح التصفية
              </button>
            )}
          </div>
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3"
                : "flex flex-col gap-3"
            }
          >
            {filteredProjects.map((project) => {
              const isOpening = loadingProjectId === project.id;
              const isList = viewMode === "list";

              return (
                <article
                  key={project.id}
                  className={`group relative overflow-hidden rounded-2xl border border-border bg-background-secondary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md ${
                    isList ? "grid sm:grid-cols-[190px_minmax(0,1fr)]" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleSelectProject(project)}
                    disabled={isOpening}
                    aria-label={`فتح مشروع ${project.name}`}
                    className={`relative block w-full overflow-hidden text-right disabled:cursor-wait ${focusRing} ${
                      isList ? "aspect-video sm:aspect-auto sm:h-full sm:min-h-[126px]" : "aspect-video"
                    }`}
                  >
                    <div
                      className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.03]"
                      style={{
                        background:
                          "radial-gradient(circle at 28% 20%, var(--accent-soft), transparent 48%), linear-gradient(135deg, var(--bg-2), var(--bg))",
                      }}
                      aria-hidden
                    />
                    <div
                      className="absolute inset-0 opacity-40"
                      style={{
                        backgroundImage:
                          "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
                        backgroundSize: "28px 28px",
                        maskImage: "linear-gradient(to bottom left, black, transparent 70%)",
                      }}
                      aria-hidden
                    />
                    <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
                      {isOpening ? (
                        <Loader2 size={30} className="animate-spin text-primary" />
                      ) : (
                        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-background/60 text-primary shadow-md backdrop-blur-sm transition-transform duration-200 group-hover:scale-105">
                          <span className="text-2xl font-semibold">{getProjectInitial(project.name)}</span>
                          <Film size={13} className="absolute -bottom-2 -left-2 rounded-full bg-primary p-0.5 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] text-white/85 backdrop-blur-md">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                      محفوظ محليًا
                    </div>
                    {!isOpening && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100" aria-hidden>
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow">
                          <Play size={18} fill="currentColor" className="-translate-x-0.5" />
                        </span>
                      </div>
                    )}
                  </button>

                  <div className={`flex min-w-0 items-center gap-2 p-4 ${isList ? "sm:p-5" : ""}`}>
                    <button
                      type="button"
                      onClick={() => void handleSelectProject(project)}
                      disabled={isOpening}
                      className={`min-w-0 flex-1 rounded-lg text-right disabled:cursor-wait ${focusRing}`}
                    >
                      <h2 className="truncate text-sm font-semibold text-text-primary transition-colors group-hover:text-primary sm:text-base">
                        {project.name}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                        <span title={fullDateFormatter.format(project.lastModified)}>
                          {formatRelativeDate(project.lastModified)}
                        </span>
                        <span className="h-1 w-1 rounded-full bg-border-hover" aria-hidden />
                        <span className="flex items-center gap-1">
                          {isOpening ? "جاري الفتح…" : "متابعة التحرير"}
                          {!isOpening && <ArrowUpLeft size={12} aria-hidden />}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(project)}
                      disabled={isOpening}
                      aria-label={`حذف مشروع ${project.name}`}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-muted opacity-100 transition-all hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 ${focusRing}`}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="mt-8 flex items-center justify-center gap-2 border-t border-border pt-5 text-center text-xs text-text-muted">
            <HardDrive size={13} aria-hidden />
            <span>مشاريعك محفوظة محليًا في هذا المتصفح</span>
          </div>
        </>
      )}

      {pendingDelete && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeleting) setPendingDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            aria-describedby="delete-project-description"
            className="w-full max-w-md rounded-2xl border border-border bg-background-elevated p-6 shadow-lg"
          >
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
              <Trash2 size={21} aria-hidden />
            </div>
            <h2 id="delete-project-title" className="text-lg font-semibold text-text-primary">
              حذف «{pendingDelete.name}»؟
            </h2>
            <p id="delete-project-description" className="mt-2 text-sm leading-6 text-text-secondary">
              سيتم حذف النسخ المحفوظة لهذا المشروع من هذا المتصفح. لا يمكن التراجع عن هذا الإجراء.
            </p>
            <div className="mt-7 flex gap-3">
              <button
                ref={cancelDeleteRef}
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={isDeleting}
                className={`h-10 flex-1 rounded-xl border border-border bg-background-tertiary text-sm font-medium text-text-primary hover:bg-background-secondary disabled:opacity-50 ${focusRing}`}
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteProject()}
                disabled={isDeleting}
                className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 ${focusRing}`}
              >
                {isDeleting && <Loader2 size={15} className="animate-spin" aria-hidden />}
                {isDeleting ? "جاري الحذف…" : "حذف المشروع"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default RecentProjects;
