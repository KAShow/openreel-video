import { useEffect, useState } from "react";
import { autoSaveManager } from "../services/auto-save";

/** Finds the project saved last. A project is its latest changes, so there is nothing to choose from. */
export function useLastProject() {
  const [state, setState] = useState<{ isChecking: boolean; lastSaveId: string | null }>({
    isChecking: true,
    lastSaveId: null,
  });

  useEffect(() => {
    const find = async () => {
      try {
        await autoSaveManager.initialize();
        const saves = await autoSaveManager.checkForRecovery();
        setState({ isChecking: false, lastSaveId: saves[0]?.id ?? null });
      } catch (error) {
        console.warn("[LastProject] Failed to read saved projects:", error);
        setState({ isChecking: false, lastSaveId: null });
      }
    };
    void find();
  }, []);

  return state;
}
