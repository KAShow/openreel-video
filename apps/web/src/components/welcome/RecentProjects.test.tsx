import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecentProjects } from "./RecentProjects";

const mockCheckForRecovery = vi.fn();
const mockRecoverFromAutoSave = vi.fn();
const mockClearProjectSaves = vi.fn();
const mockTrack = vi.fn();

vi.mock("../../services/auto-save", () => ({
  checkForRecovery: () => mockCheckForRecovery(),
  autoSaveManager: {
    clearProjectSaves: (projectId: string) => mockClearProjectSaves(projectId),
  },
}));

vi.mock("../../stores/project-store", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({ recoverFromAutoSave: mockRecoverFromAutoSave }),
}));

vi.mock("../../hooks/useAnalytics", () => ({
  AnalyticsEvents: { PROJECT_OPENED: "project_opened" },
  useAnalytics: () => ({ track: mockTrack }),
}));

function makeSave(
  projectId: string,
  projectName: string,
  timestamp: number = Date.now(),
  slot = 0,
) {
  return {
    id: `${projectId}-slot-${slot}`,
    projectId,
    projectName,
    timestamp,
    slot,
    isRecovery: true,
  };
}

describe("RecentProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClearProjectSaves.mockResolvedValue(undefined);
  });

  it("shows loading skeletons initially", () => {
    mockCheckForRecovery.mockReturnValue(new Promise(() => {}));
    render(<RecentProjects />);
    expect(screen.getByText("جاري تحميل مشاريعك…")).toBeInTheDocument();
  });

  it("shows a localized empty state and create action", async () => {
    mockCheckForRecovery.mockResolvedValue([]);
    const onCreateProject = vi.fn();
    render(<RecentProjects onCreateProject={onCreateProject} />);

    const createButton = await screen.findByRole("button", {
      name: "إنشاء مشروع جديد",
    });
    fireEvent.click(createButton);
    expect(onCreateProject).toHaveBeenCalledOnce();
  });

  it("deduplicates saves and displays the latest version of each project", async () => {
    mockCheckForRecovery.mockResolvedValue([
      makeSave("project-1", "Project v2", Date.now(), 1),
      makeSave("project-1", "Project v1", Date.now() - 3600000, 0),
      makeSave("project-2", "Another Project"),
    ]);

    render(<RecentProjects />);

    expect(await screen.findByRole("heading", { name: "Project v2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Another Project" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Project v1" })).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("filters projects by name and clears an empty search", async () => {
    mockCheckForRecovery.mockResolvedValue([
      makeSave("project-1", "Launch video"),
      makeSave("project-2", "Wedding film"),
    ]);
    render(<RecentProjects />);

    await screen.findByRole("heading", { name: "Launch video" });
    fireEvent.change(screen.getByLabelText("ابحث في مشاريعك"), {
      target: { value: "missing" },
    });

    expect(screen.getByRole("heading", { name: "لا توجد نتائج مطابقة" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "مسح البحث والتصفية" }));
    expect(screen.getByRole("heading", { name: "Launch video" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wedding film" })).toBeInTheDocument();
  });

  it("filters projects by modification date", async () => {
    mockCheckForRecovery.mockResolvedValue([
      makeSave("project-1", "Recent edit", Date.now() - 86_400_000),
      makeSave("project-2", "Old edit", Date.now() - 40 * 86_400_000),
    ]);
    render(<RecentProjects />);

    await screen.findByRole("heading", { name: "Recent edit" });
    fireEvent.change(screen.getByLabelText("تصفية حسب تاريخ التعديل"), {
      target: { value: "week" },
    });

    expect(screen.getByRole("heading", { name: "Recent edit" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Old edit" })).not.toBeInTheDocument();
  });

  it("opens the selected auto-save", async () => {
    mockCheckForRecovery.mockResolvedValue([makeSave("project-1", "Test Project")]);
    mockRecoverFromAutoSave.mockResolvedValue(true);
    const onProjectSelected = vi.fn();

    render(<RecentProjects onProjectSelected={onProjectSelected} />);
    const openButton = await screen.findByRole("button", {
      name: "فتح مشروع Test Project",
    });
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(mockRecoverFromAutoSave).toHaveBeenCalledWith("project-1-slot-0");
      expect(onProjectSelected).toHaveBeenCalled();
    });
  });

  it("asks for confirmation before permanently deleting a project", async () => {
    mockCheckForRecovery.mockResolvedValue([
      makeSave("project-1", "Project to Remove"),
    ]);
    render(<RecentProjects />);

    const removeButton = await screen.findByRole("button", {
      name: "حذف مشروع Project to Remove",
    });
    fireEvent.click(removeButton);
    expect(mockClearProjectSaves).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "حذف المشروع" }));

    await waitFor(() => {
      expect(mockClearProjectSaves).toHaveBeenCalledWith("project-1");
      expect(screen.queryByRole("heading", { name: "Project to Remove" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "ابدأ أول مشروع لك" })).toBeInTheDocument();
    });
  });

  it("offers a retry when loading fails", async () => {
    mockCheckForRecovery.mockRejectedValueOnce(new Error("Storage unavailable"));
    mockCheckForRecovery.mockResolvedValueOnce([makeSave("project-1", "Recovered Project")]);
    render(<RecentProjects />);

    const retryButton = await screen.findByRole("button", { name: "إعادة المحاولة" });
    fireEvent.click(retryButton);

    expect(await screen.findByRole("heading", { name: "Recovered Project" })).toBeInTheDocument();
  });
});
