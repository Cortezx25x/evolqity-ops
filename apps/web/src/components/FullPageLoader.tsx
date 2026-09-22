export function FullPageLoader({ label }: { label: string }) {
  return (
    <div className="app-loader" role="status" aria-live="polite">
      <div className="app-spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}
