export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Loading">
      <div className="h-7 w-40 rounded bg-stone-200" />
      <div className="h-32 rounded-xl bg-stone-200/70" />
      <div className="h-64 rounded-xl bg-stone-200/50" />
    </div>
  );
}
