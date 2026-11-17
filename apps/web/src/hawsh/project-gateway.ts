/**
 * Lazy door to the project store (Hawsh, plan phase 5 "lighter loading").
 *
 * `stores/project-store` pulls in every engine of `@openreel/core` (decoders, effects, motion,
 * export). The start page only needs it once the user opens or creates a project, so the start
 * page talks to it through this file: the store's code downloads on first use (or earlier, when
 * the idle prefetch in `useEditorPreload` gets to it) instead of before anything is shown.
 *
 * The store registers itself here when its module runs (`registerProjectStore`), however it was
 * loaded: through this file, with the editor chunk, or by a test.
 *
 * Import only types from the store here; a value import would put it back in the start bundle.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { ProjectState, useProjectStore as ProjectStoreHook } from "../stores/project-store";

type ProjectStore = typeof ProjectStoreHook;

let store: ProjectStore | null = null;
let loading: Promise<ProjectStore> | null = null;
const onRegister = new Set<() => void>();

/** Called once by `stores/project-store` when its module runs. */
export function registerProjectStore(projectStore: ProjectStore): void {
  store = projectStore;
  for (const listener of [...onRegister]) listener();
}

/** Downloads the project store (once) and returns it. */
export function loadProjectStore(): Promise<ProjectStore> {
  if (store) return Promise.resolve(store);
  loading ??= import("../stores/project-store").then(
    (module) => store ?? module.useProjectStore,
    (error: unknown) => {
      loading = null; // a dropped connection can try again on the next tap
      throw error;
    },
  );
  return loading;
}

type Actions = {
  [K in keyof ProjectState as ProjectState[K] extends (...args: never[]) => unknown ? K : never]: ProjectState[K];
};
type ActionName = keyof Actions;
type Lazy<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;

// Actions started but not finished. While one runs (say "new project" waiting for the store to
// download), App must not open another project for the same editor route.
let pending = 0;
const pendingListeners = new Set<() => void>();
const setPending = (delta: number) => {
  pending += delta;
  for (const listener of [...pendingListeners]) listener();
};

/** Calls a project-store action, downloading the store first when needed. */
export async function callProjectAction<K extends ActionName>(
  name: K,
  ...args: Parameters<Actions[K]>
): Promise<Awaited<ReturnType<Actions[K]>>> {
  setPending(1);
  try {
    const projectStore = await loadProjectStore();
    // Read the action at call time so a spy or a store reset is honoured.
    const action = projectStore.getState()[name] as (...a: Parameters<Actions[K]>) => ReturnType<Actions[K]>;
    return (await action(...args)) as Awaited<ReturnType<Actions[K]>>;
  } finally {
    setPending(-1);
  }
}

/** True while a project action called through this file is still running. */
export function useProjectActionPending(): boolean {
  return useSyncExternalStore(
    (listener) => {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
    () => pending > 0,
    () => false,
  );
}

/** A stable function that runs a project-store action (async, since the store may still download). */
export function useProjectAction<K extends ActionName>(name: K): Lazy<Actions[K]> {
  return useCallback(
    (...args: Parameters<Actions[K]>) => callProjectAction(name, ...args),
    [name],
  ) as unknown as Lazy<Actions[K]>;
}

function subscribe(listener: () => void): () => void {
  let unsubscribeStore = store?.subscribe(listener);
  const whenRegistered = () => {
    unsubscribeStore ??= store?.subscribe(listener);
    listener();
  };
  if (!store) onRegister.add(whenRegistered);
  return () => {
    onRegister.delete(whenRegistered);
    unsubscribeStore?.();
  };
}

/**
 * Reads a value from the project store without downloading it: `fallback` until something loads
 * the store. Return primitives (or stable references) from `select`.
 */
export function useProjectValue<T>(select: (state: ProjectState) => T, fallback: T): T {
  return useSyncExternalStore(
    subscribe,
    () => (store ? select(store.getState()) : fallback),
    () => fallback,
  );
}
