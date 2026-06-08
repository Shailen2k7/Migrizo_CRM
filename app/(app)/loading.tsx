export default function Loading() {
  return (
    <div className="max-w-[1480px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-10">
      <div className="animate-pulse">
        <div className="h-8 w-72 bg-surface-2 rounded-md mb-3" />
        <div className="h-4 w-56 bg-surface-2 rounded-md mb-7" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[120px] bg-surface-2 rounded-2xl" />
          ))}
        </div>
        <div className="h-[80px] bg-surface-2 rounded-2xl mb-3" />
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-3">
          <div className="h-[280px] bg-surface-2 rounded-2xl" />
          <div className="h-[280px] bg-surface-2 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
