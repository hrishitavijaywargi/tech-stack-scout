import { Card, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-12" />
          </Card>
        ))}
      </div>
      <Card className="mt-6 p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="mb-3 h-8 w-full" />
        ))}
      </Card>
    </div>
  );
}
