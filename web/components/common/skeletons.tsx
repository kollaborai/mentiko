import { Skeleton } from "@/components/ui/skeleton";

export function ChainSkeleton() {
  return (
    <div className="p-3 space-y-3 border-b border-border">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full max-w-[200px]" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChainListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <ChainSkeleton key={i} />
      ))}
    </>
  );
}

export function TemplateSkeleton() {
  return (
    <div className="bg-muted/50 rounded-md p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <Skeleton className="h-5 w-10" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-4" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-7 flex-1" />
        <Skeleton className="h-7 w-16" />
      </div>
    </div>
  );
}

export function TemplateGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <TemplateSkeleton key={i} />
      ))}
    </div>
  );
}

export function EventSkeleton() {
  return (
    <div className="py-2 px-1 space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-1.5 w-1.5 rounded-full" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-2 w-16" />
        <Skeleton className="h-2 w-12" />
      </div>
    </div>
  );
}

export function ActivityItemSkeleton() {
  return (
    <div className="p-3 flex items-start gap-3">
      <Skeleton className="h-3.5 w-3.5 rounded-full shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-12 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-2 w-16" />
          <Skeleton className="h-2 w-12" />
        </div>
      </div>
    </div>
  );
}
