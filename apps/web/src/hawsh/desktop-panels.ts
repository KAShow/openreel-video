/**
 * OpenReel's desktop layout panels, gathered into one lazy chunk (Hawsh, plan phase 5).
 * The phone editor is the editor on every screen; these load only for `?m=0`
 * (see `components/editor/EditorInterface.tsx`, which imports them through `React.lazy`).
 */
export { Toolbar } from "../components/editor/Toolbar";
export { EditorActionRail } from "../components/editor/EditorActionRail";
export { AssetsPanel } from "../components/editor/AssetsPanel";
export { InspectorPanel } from "../components/editor/InspectorPanel";
export { Timeline } from "../components/editor/Timeline";
export { KeyframeEditorPanel } from "../components/editor/KeyframeEditorPanel";
export { AudioMixer } from "../components/audio-mixer";
export { KeyboardShortcutsOverlay } from "../components/editor/KeyboardShortcutsOverlay";
export { SpotlightTour, MoGraphTour } from "../components/editor/tour";
