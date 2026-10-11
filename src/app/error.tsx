"use client";

import { Button, Card, Notice } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="p-5">
      <Notice tone="red" title="Something went wrong loading this page">
        <p>{error.message || "Unexpected error."}</p>
        {error.digest && <p className="mt-1 text-xs opacity-75">Reference: {error.digest}</p>}
      </Notice>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </Card>
  );
}
