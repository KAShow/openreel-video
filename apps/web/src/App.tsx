import { useEffect, useCallback, useRef, useState, lazy, Suspense } from "react";
import { MobileBlocker } from "./components/MobileBlocker";
import { SplashScreen } from "./components/SplashScreen";
// Hawsh: straight to the file, not the welcome index, which drags in three.js and the template engine.
import { WelcomeScreen } from "./components/welcome/WelcomeScreen";
import { useUIStore } from "./stores/ui-store";
import { useProjectAction, useProjectActionPending, useProjectValue } from "./hawsh/project-gateway";
import { useNotificationStore } from "./stores/notification-store";
import { useRouter } from "./hooks/use-router";
import { useLastProject } from "./hooks/useLastProject";
import { SKIP_WELCOME } from "./hawsh/simple";
import { DEFAULT_PROJECT_SETTINGS } from "./stores/project/project-helpers";
// Hawsh: the presets file alone; the @openreel/core index would load every engine before the start page.
import { SOCIAL_MEDIA_PRESETS, type SocialMediaCategory } from "@openreel/core/types/scriptable-template";

const EditorInterface = lazy(() =>
  import("./components/editor/EditorInterface").then((m) => ({
    default: m.EditorInterface,
  }))
);
const ScriptViewDialog = lazy(() =>
  import("./components/editor/ScriptViewDialog").then((m) => ({ default: m.ScriptViewDialog })),
);
const SearchModal = lazy(() =>
  import("./components/editor/SearchModal").then((m) => ({ default: m.SearchModal })),
);
// Hawsh: these pull in the project store and framer-motion, so they load only when needed.
const ToastContainer = lazy(() => import("./components/Toast").then((m) => ({ default: m.ToastContainer })));
const KieAIPoller = lazy(() => import("./hawsh/KieAIPoller"));
const SharePage = lazy(() =>
  import("./pages/SharePage").then((m) => ({ default: m.SharePage })),
);

const PRESET_DIMENSIONS: Record<string, SocialMediaCategory> = {
  "1080x1920": "tiktok",
  "1920x1080": "youtube-video",
  "1080x1080": "instagram-post",
  "720x1280": "instagram-stories",
  "1280x720": "youtube-video",
};

function App() {
  const activeModal = useUIStore((state) => state.activeModal);
  const closeModal = useUIStore((state) => state.closeModal);
  const skipWelcomeScreen = useUIStore((state) => state.skipWelcomeScreen);
  const openSearchModal = useUIStore((state) => state.openModal);
  const [hasOpenedScriptView, setHasOpenedScriptView] = useState(false);
  const [isOpeningLast, setIsOpeningLast] = useState(false);
  const triedLastProject = useRef(false);
  const createNewProject = useProjectAction("createNewProject");
  const recoverFromAutoSave = useProjectAction("recoverFromAutoSave");
  const hasOpenProject = useProjectValue((state) => state.hasOpenProject, false);
  const projectActionPending = useProjectActionPending(); // e.g. "new project" while the store downloads
  const hasToasts = useNotificationStore((state) => state.notifications.length > 0);
  const [toastsShown, setToastsShown] = useState(false);
  useEffect(() => {
    if (hasToasts) setToastsShown(true);
  }, [hasToasts]);
  const { isChecking, lastSaveId } = useLastProject();

  const { route, params, navigate, parsedDimensions, fps } = useRouter();
  const hasHandledInitialRoute = useRef(false);
  const showWelcome =
    !SKIP_WELCOME && ["welcome", "templates", "recent"].includes(route);
  const isSharePage = route === "share" && params.shareId;

  useEffect(() => {
    if (activeModal === "scriptView") setHasOpenedScriptView(true);
  }, [activeModal]);

  useEffect(() => {
    if (hasHandledInitialRoute.current || isChecking) return;

    if (route === "new") {
      hasHandledInitialRoute.current = true;

      let projectName = "مشروع جديد";
      let width = DEFAULT_PROJECT_SETTINGS.width;
      let height = DEFAULT_PROJECT_SETTINGS.height;
      let frameRate = fps;

      if (params.preset) {
        const presetKey = params.preset as SocialMediaCategory;
        const preset = SOCIAL_MEDIA_PRESETS[presetKey];
        if (preset) {
          width = preset.width;
          height = preset.height;
          frameRate = params.fps ? fps : (preset.frameRate || fps);
          projectName = "مشروع جديد";
        }
      } else if (parsedDimensions) {
        width = parsedDimensions.width;
        height = parsedDimensions.height;

        const dimensionKey = `${width}x${height}`;
        const matchingPreset = PRESET_DIMENSIONS[dimensionKey];
        if (matchingPreset) {
          const preset = SOCIAL_MEDIA_PRESETS[matchingPreset];
          frameRate = params.fps ? fps : (preset.frameRate || fps);
        }

        const aspectRatio = width / height;
        if (aspectRatio < 1) {
          projectName = "فيديو طولي جديد";
        } else if (aspectRatio > 1) {
          projectName = "فيديو عرضي جديد";
        } else {
          projectName = "فيديو مربع جديد";
        }
      }

      void createNewProject(projectName, { width, height, frameRate });
      navigate("editor");
    } else if (route === "editor" && (skipWelcomeScreen || SKIP_WELCOME)) {
      hasHandledInitialRoute.current = true;
    } else if (["welcome", "templates", "recent"].includes(route)) {
      hasHandledInitialRoute.current = true;
    }
  }, [
    route,
    params,
    parsedDimensions,
    fps,
    createNewProject,
    navigate,
    skipWelcomeScreen,
    isChecking,
  ]);

  useEffect(() => {
    // A bare editor URL, such as a reload, continues the last project. It still needs
    // a real project for autosave and preview-proxy lifecycle subscriptions.
    if (showWelcome || isSharePage || route === "new" || isChecking || isOpeningLast || hasOpenProject || projectActionPending) return;
    if (lastSaveId && !triedLastProject.current) {
      triedLastProject.current = true;
      setIsOpeningLast(true);
      void recoverFromAutoSave(lastSaveId)
        .catch((error) => console.warn("[App] Failed to open the last project:", error))
        .finally(() => setIsOpeningLast(false));
      return;
    }
    void createNewProject("مشروع جديد");
  }, [showWelcome, isSharePage, route, isChecking, isOpeningLast, hasOpenProject, projectActionPending, lastSaveId, recoverFromAutoSave, createNewProject]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && route !== "editor") {
        navigate("editor");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openSearchModal("search");
      }
    },
    [route, navigate, openSearchModal],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const initialTab =
    route === "templates"
      ? "templates"
      : route === "recent"
        ? "recent"
        : undefined;

  return (
    <div className="h-screen h-[100dvh] w-screen bg-background text-text-primary overflow-hidden" style={{ height: "var(--app-height, 100dvh)" }}>
      <MobileBlocker />
      {isSharePage ? (
        <Suspense fallback={<SplashScreen status="نفتح الفيديو…" />}>
          <SharePage shareId={params.shareId!} />
        </Suspense>
      ) : showWelcome ? (
        <WelcomeScreen initialTab={initialTab} />
      ) : !hasOpenProject || route === "new" ? (
        <SplashScreen status={isChecking ? "نبحث عن مشاريعك المحفوظة…" : "نفتح المشروع…"} />
      ) : (
        <Suspense fallback={<SplashScreen status="نفتح المحرر…" />}>
          <EditorInterface />
        </Suspense>
      )}
      <Suspense fallback={null}>
        {(hasToasts || toastsShown) && <ToastContainer />}
        {hasOpenProject && <KieAIPoller />}
        {(hasOpenedScriptView || activeModal === "scriptView") && <ScriptViewDialog isOpen={activeModal === "scriptView"} onClose={closeModal} />}
        {activeModal === "search" && <SearchModal isOpen onClose={closeModal} />}
      </Suspense>
    </div>
  );
}

export default App;
