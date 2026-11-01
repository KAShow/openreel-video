export type PreviewResourceRequest = number;

/**
 * Owns cleanup callbacks and invalidates asynchronous work when the preview
 * unmounts. A disposed manager can be activated again for React StrictMode's
 * setup/cleanup/setup cycle without admitting requests from the prior cycle.
 */
export class PreviewResourceManager {
  private disposed = false;
  private revision = 0;
  private disposers = new Set<() => void>();

  activate(): void {
    if (!this.disposed) return;
    this.disposed = false;
    this.revision += 1;
  }

  beginRequest(): PreviewResourceRequest {
    return this.revision;
  }

  isCurrent(request: PreviewResourceRequest): boolean {
    return !this.disposed && request === this.revision;
  }

  own(disposer: () => void): () => void {
    if (this.disposed) {
      disposer();
      return () => {};
    }

    this.disposers.add(disposer);
    return () => {
      this.disposers.delete(disposer);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;

    const disposers = [...this.disposers];
    this.disposers.clear();
    for (const disposeResource of disposers.reverse()) {
      try {
        disposeResource();
      } catch (error) {
        console.warn("[Preview] Resource cleanup failed:", error);
      }
    }
  }
}
