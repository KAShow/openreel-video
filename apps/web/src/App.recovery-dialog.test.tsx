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
vi.mock("./components/welcome/RecoveryDialog", () => ({ RecoveryDialog: () => <div role="dialog" /> }));

const savedProject: AutoSaveMetadata = {
  id: "saved-1", projectId: "saved-project", projectName: "Vacation edit",
  timestamp: 1, slot: 0, isRecovery: true,
};

// Runs the real recovery hook: the bug lives between its startup check and the store.
describe("recovery dialog after a project is opened", () => {
  beforeEach(() => {
    vi.spyOn(autoSaveManager, "initialize").mockResolvedValue(undefined);
    vi.spyOn(autoSaveManager, "checkForRecovery").mockResolvedValue([savedProject]);
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Unopened placeholder") });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = ""; });

  it("still offers recovery when a reload lands straight in the editor", async () => {
    window.location.hash = "#/editor";
    const view = render(<App />);
    expect(await view.findByRole("dialog")).toBeInTheDocument();
    expect(useProjectStore.getState().hasOpenProject).toBe(false);
  });

  it("still offers recovery when leaving the welcome screen without choosing a project", async () => {
    window.location.hash = "#/welcome";
    const view = render(<App />);
    await waitFor(() => expect(autoSaveManager.checkForRecovery).toHaveBeenCalled());
    act(() => { window.location.hash = "#/editor"; });
    expect(await view.findByRole("dialog")).toBeInTheDocument();
  });

  it("stays closed after a project is opened from the welcome screen", async () => {
    window.location.hash = "#/recent";
    const view = render(<App />);
    await act(async () => { await vi.mocked(autoSaveManager.checkForRecovery).mock.results[0]?.value; });
    act(() => { useProjectStore.getState().createNewProject("Chosen project"); window.location.hash = "#/editor"; });
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(view.queryByRole("dialog")).toBeNull();
    expect(useProjectStore.getState().project.name).toBe("Chosen project");
  });

  it("stays closed when the startup check finishes after a project was already opened", async () => {
    let finishCheck: (saves: AutoSaveMetadata[]) => void = () => {};
    vi.mocked(autoSaveManager.checkForRecovery).mockReturnValue(new Promise((resolve) => { finishCheck = resolve; }));
    window.location.hash = "#/recent";
    const view = render(<App />);
    await waitFor(() => expect(autoSaveManager.checkForRecovery).toHaveBeenCalled());
    act(() => { useProjectStore.getState().createNewProject("Chosen project"); window.location.hash = "#/editor"; });
    await act(async () => { finishCheck([savedProject]); });
    expect(await view.findByText("Editor")).toBeInTheDocument();
    expect(view.queryByRole("dialog")).toBeNull();
  });
});
