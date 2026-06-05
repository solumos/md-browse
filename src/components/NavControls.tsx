interface Props {
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  canReload: boolean;
}

const btn =
  "flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700";

export function NavControls({
  canBack,
  canForward,
  loading,
  onBack,
  onForward,
  onReload,
  canReload,
}: Props) {
  return (
    <div className="flex items-center gap-1 chrome-no-select">
      <button
        type="button"
        className={btn}
        onClick={onBack}
        disabled={!canBack}
        aria-label="Go back"
        title="Back"
      >
        <Icon path="M15 18l-6-6 6-6" />
      </button>
      <button
        type="button"
        className={btn}
        onClick={onForward}
        disabled={!canForward}
        aria-label="Go forward"
        title="Forward"
      >
        <Icon path="M9 18l6-6-6-6" />
      </button>
      <button
        type="button"
        className={btn}
        onClick={onReload}
        disabled={!canReload}
        aria-label={loading ? "Loading" : "Reload"}
        title="Reload"
      >
        <Icon
          path="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
          className={loading ? "animate-spin" : undefined}
        />
      </button>
    </div>
  );
}

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
