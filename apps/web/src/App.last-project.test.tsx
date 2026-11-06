import "./test/install-local-storage-mock";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { autoSaveManager, type AutoSaveMetadata } from "./services/auto-save";
import { useProjectStore } from "./stores/project-store";
import { createEmptyProject } from "./stores/project/project-helpers";

vi.mock("./hooks/useKieAIPoller", () => ({ useKieAIPoller: () => undefined }));
vi.mock("./components/MobileBlocker", () => ({ MobileBlocker: () => null }));
vi.mock("./components/Toast", () => ({ ToastContainer: () => null }));
vi.mock("./components/editor/EditorInterface", () => ({ EditorInterface: () => <p>Editor</p> }));
vi.mock("./components/welcome", () => ({ WelcomeScreen: () => <p>Welcome</p> }));

const save = (id: string, projectId: string, timestamp: number): AutoSaveMetadata => ({
  id, projectId, projectName: projectId, timestamp, slot: 0, isRecovery: true,
});
const newest = save("save-new", "vacation", 3);
const older = save("save-old", "vacation", 2);

// Runs the real startup check: the behaviour lives between it, the route and the store.
describe("opening the last project", () => {
  const openSave = vi.fn(async (_saveId: string) => false);

  beforeEach(() => {
    openSave.mockReset().mockImplementation(async (saveId: string) => {
      useProjectStore.setState({ hasOpenProject: true, project: { ...createEmptyProject("Vacation"), id: saveId } });
      return true;
    });
    vi.spyOn(autoSaveManager, "initialize").mockResolvedValue(undefined);
    vi.spyOn(autoSaveManager, "checkForRecovery").mockResolvedValue([newest, older]);
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Unopened placeholder"), recoverFromAutoSave: openSave });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = ""; });

  it("reopens the latest changes when a reload lands in the editor, without asking", async () => {
    window.location.hash = "#/editor";
    const view = render(<App />);
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(openSave).toHaveBeenCalledOnce();
    expect(openSave).toHaveBeenCalledWith("save-new");
    expect(view.queryByRole("dialog")).toBeNull();
  });

  it("starts a new project when nothing is saved", async () => {
    vi.mocked(autoSaveManager.checkForRecovery).mockResolvedValue([]);
    window.location.hash = "#/editor";
    const view = render(<App />);
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(openSave).not.toHaveBeenCalled();
    expect(useProjectStore.getState().hasOpenProject).toBe(true);
  });

  it("starts a new project when the last one cannot be opened, once", async () => {
    openSave.mockResolvedValue(false);
    window.location.hash = "#/editor";
    const view = render(<App />);
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(openSave).toHaveBeenCalledOnce();
    expect(useProjectStore.getState().hasOpenProject).toBe(true);
  });

  it("does not touch a project the user already opened from the welcome screen", async () => {
    window.location.hash = "#/recent";
    const view = render(<App />);
    await waitFor(() => expect(autoSaveManager.checkForRecovery).toHaveBeenCalled());
    await act(async () => { useProjectStore.getState().createNewProject("Chosen project"); window.location.hash = "#/editor"; });
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(openSave).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project.name).toBe("Chosen project");
  });

  it("keeps a project opened while the startup check was still running", async () => {
    let finishCheck: (saves: AutoSaveMetadata[]) => void = () => {};
    vi.mocked(autoSaveManager.checkForRecovery).mockReturnValue(new Promise((resolve) => { finishCheck = resolve; }));
    window.location.hash = "#/recent";
    const view = render(<App />);
    await waitFor(() => expect(autoSaveManager.checkForRecovery).toHaveBeenCalled());
    await act(async () => { useProjectStore.getState().createNewProject("Chosen project"); window.location.hash = "#/editor"; });
    await act(async () => { finishCheck([newest]); });
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(openSave).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project.name).toBe("Chosen project");
  });

  it("stays on the welcome screen without opening anything", async () => {
    window.location.hash = "#/welcome";
    const view = render(<App />);
    expect(await view.findByText("Welcome")).toBeInTheDocument();
    await waitFor(() => expect(autoSaveManager.checkForRecovery).toHaveBeenCalled());
    expect(openSave).not.toHaveBeenCalled();
    expect(useProjectStore.getState().hasOpenProject).toBe(false);
  });

  it("gives a #/new link a new project even when others are saved", async () => {
    window.location.hash = "#/new?dimensions=1080x1080&fps=60";
    const view = render(<App />);
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(openSave).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project.settings).toMatchObject({ width: 1080, height: 1080, frameRate: 60 });
  });
});
