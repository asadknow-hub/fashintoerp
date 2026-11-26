export default function Loading() {
  return (
    <div className="animate-pulse space-y-3" aria-label="Loading">
      <div className="h-8 w-48 rounded bg-stone-200" />
      <div className="h-14 rounded-md bg-stone-200/70" />
      <div className="h-64 rounded-md bg-stone-200/50" />
    </div>
  );
}
