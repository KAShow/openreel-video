import "./test/install-local-storage-mock";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useProjectStore } from "./stores/project-store";
import { useUIStore } from "./stores/ui-store";
import { createEmptyProject } from "./stores/project/project-helpers";

const lastProject = vi.hoisted(() => ({ isChecking: false, lastSaveId: null as string | null }));

vi.mock("./hooks/useLastProject", () => ({
  useLastProject: () => lastProject,
}));
vi.mock("./hooks/useKieAIPoller", () => ({ useKieAIPoller: () => undefined }));
vi.mock("./components/MobileBlocker", () => ({ MobileBlocker: () => null }));
vi.mock("./components/Toast", () => ({ ToastContainer: () => null }));
vi.mock("./components/editor/EditorInterface", () => ({ EditorInterface: () => <p>Editor</p> }));
vi.mock("./components/welcome", () => ({ WelcomeScreen: () => <p>Welcome</p> }));
vi.mock("./pages/SharePage", () => ({ SharePage: () => <p>Shared video</p> }));

describe("new-project links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastProject.isChecking = false; lastProject.lastSaveId = null;
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Unopened placeholder") });
    useUIStore.setState({ skipWelcomeScreen: false, activeModal: null });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = ""; });

  it.each([
    ["#/new?dimensions=1920x1080&fps=24", 1920, 1080, 24],
    ["#/new?preset=youtube-video&fps=60", 1920, 1080, 60],
    ["#/new?preset=youtube-video", 1920, 1080, 30],
  ])("honors explicit frame rates in %s", async (hash, width, height, frameRate) => {
    window.location.hash = String(hash);
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    render(<App />);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(expect.any(String), { width, height, frameRate });
    expect(useProjectStore.getState().hasOpenProject).toBe(true);
  });

  it("opens a real fresh project for a bare editor URL once the saved-project check settles", async () => {
    window.location.hash = "#/editor"; lastProject.isChecking = true;
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(create).not.toHaveBeenCalled(); expect(view.queryByText("Editor")).toBeNull();
    lastProject.isChecking = false; view.rerender(<App />);
    await waitFor(() => expect(useProjectStore.getState().hasOpenProject).toBe(true));
    expect(create).toHaveBeenCalledOnce();
    expect(await view.findByText("Editor")).toBeInTheDocument();
    view.rerender(<App />);
    expect(create).toHaveBeenCalledOnce();
  });

  it("preserves explicit dimensions and frame rate once the saved-project check settles", async () => {
    window.location.hash = "#/new?dimensions=1080x1920&fps=24";
    lastProject.isChecking = true;
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(create).not.toHaveBeenCalled();
    lastProject.isChecking = false; view.rerender(<App />);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(useProjectStore.getState().project.settings).toMatchObject({ width: 1080, height: 1920, frameRate: 24 });
    expect(await view.findByText("Editor")).toBeInTheDocument();
  });

  it("preserves an already open project at a bare editor URL", async () => {
    window.location.hash = "#/editor";
    const opened = createEmptyProject("Already open");
    useProjectStore.setState({ hasOpenProject: true, project: opened });
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled(); expect(useProjectStore.getState().project).toBe(opened);
  });

  it("does not create an editor project for a shared video", async () => {
    window.location.hash = "#/share/video-1";
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(await view.findByText("Shared video")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled(); expect(useProjectStore.getState().hasOpenProject).toBe(false);
  });

  it.each(["", "#/welcome", "#/templates", "#/recent"])("opens the requested welcome view without creating a project for '%s'", async (hash) => {
    window.location.hash = hash;
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    const view = render(<App />);
    expect(await view.findByText("Welcome")).toBeInTheDocument();
    expect(view.queryByText("Editor")).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(useProjectStore.getState().hasOpenProject).toBe(false);
  });

  it("starts a #/new link without dimensions vertical", async () => {
    window.location.hash = "#/new";
    const create = vi.spyOn(useProjectStore.getState(), "createNewProject");
    render(<App />);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(expect.any(String), { width: 1080, height: 1920, frameRate: 30 });
  });
});
