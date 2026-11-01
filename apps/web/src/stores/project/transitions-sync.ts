import type { Project } from "@openreel/core";
import { getTransitionBridge } from "../../bridges/transition-bridge";

export function syncTrackTransitionsBridge(
  project: Project,
  trackId: string,
): void {
  const transitionBridge = getTransitionBridge();
  if (!transitionBridge.isInitialized()) return;

  const track = project.timeline.tracks.find(
    (candidate) => candidate.id === trackId,
  );
  if (!track) {
    transitionBridge.clearTransitionsForTrack(trackId);
    return;
  }

  transitionBridge.setTransitionsForTrack(trackId, track.transitions);
}

export function syncProjectTransitionsBridge(
  nextProject: Project,
  previousProject?: Project,
): void {
  const transitionBridge = getTransitionBridge();
  if (!transitionBridge.isInitialized()) return;

  const nextTrackIds = new Set(
    nextProject.timeline.tracks.map((track) => track.id),
  );
  for (const trackId of previousProject
    ? previousProject.timeline.tracks.map((track) => track.id)
    : []) {
    if (!nextTrackIds.has(trackId)) {
      transitionBridge.clearTransitionsForTrack(trackId);
    }
  }

  for (const track of nextProject.timeline.tracks) {
    syncTrackTransitionsBridge(nextProject, track.id);
  }
}
