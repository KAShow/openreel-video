/**
 * The preview's particle layer, loaded on first use (Hawsh, plan phase 5): it is built on three.js,
 * which most projects never need. `components/editor/preview/index.ts` exports this in place of
 * the original, so `Preview.tsx` is unchanged.
 */
import React, { Suspense, lazy } from "react";
import type { ParticleRenderer as RealParticleRenderer } from "../components/editor/preview/ParticleRenderer";

const Real = lazy(() =>
  import("../components/editor/preview/ParticleRenderer").then((module) => ({ default: module.ParticleRenderer })),
);

export const ParticleRenderer: React.FC<React.ComponentProps<typeof RealParticleRenderer>> = (props) => (
  <Suspense fallback={null}>
    <Real {...props} />
  </Suspense>
);
