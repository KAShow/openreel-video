/**
 * The one loading screen of the editor (also painted by index.html before the script loads, so the
 * `ds-*` styles live there). Pass `progress` (0–1) for a real timeline-style bar, omit it for an
 * indeterminate one. With `error` it becomes the "couldn't start" screen.
 */
interface SplashScreenProps {
  status?: string;
  progress?: number;
  error?: string | null;
  onRetry?: () => void;
}

const Mark = () => (
  <svg className="ds-mark" viewBox="0 0 490 490" fill="none" aria-hidden="true">
    <circle cx="245" cy="245" r="220.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="30" />
    <g className="ds-rays" stroke="currentColor" strokeWidth="24.5" strokeLinecap="round">
      <path d="M245 98v73.5M392 245h-73.5M245 392v-73.5M98 245h73.5M348.9 141.1l-52 52M348.9 348.9l-52-52M141.1 348.9l52-52M141.1 141.1l52 52" />
    </g>
    <circle cx="245" cy="245" r="49" fill="currentColor" />
  </svg>
);

export const SplashScreen: React.FC<SplashScreenProps> = ({ status = "نفتح المحرر…", progress, error, onRetry }) => {
  if (error) {
    return (
      <div className="ds-splash">
        <Mark />
        <div role="alert" className="ds-error">
          <h1>تعذّر فتح المحرر</h1>
          <p>{error}</p>
          {onRetry && <button type="button" className="ds-btn" onClick={onRetry}>حاول مرة أخرى</button>}
        </div>
      </div>
    );
  }
  const determinate = typeof progress === "number";
  return (
    <div className="ds-splash" role="status" aria-live="polite">
      <Mark />
      <div
        className="ds-track"
        data-indeterminate={determinate ? undefined : ""}
        style={determinate ? ({ "--p": Math.min(1, Math.max(0.04, progress)) } as React.CSSProperties) : undefined}
      >
        <div className="ds-fill" />
      </div>
      <p className="ds-status">{status}</p>
    </div>
  );
};
