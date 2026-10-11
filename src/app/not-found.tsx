import { ButtonLink, Card, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <Card>
      <EmptyState title="Not found" description="This company may have been removed from the watchlist." action={<ButtonLink href="/watchlist">Back to watchlist</ButtonLink>} />
    </Card>
  );
}
