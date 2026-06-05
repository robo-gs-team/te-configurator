import { useFetcher } from "@remix-run/react";
import { Button } from "@shopify/polaris";

type RemoveItemButtonProps = {
  intent: string;
  id: string;
  idField?: string;
  label?: string;
};

export function RemoveItemButton({
  intent,
  id,
  idField = "id",
  label = "Remove",
}: RemoveItemButtonProps) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const isSubmitting = fetcher.state !== "idle";

  const handleRemove = () => {
    fetcher.submit({ intent, [idField]: id }, { method: "post" });
  };

  return (
    <Button
      size="micro"
      tone="critical"
      variant="plain"
      onClick={handleRemove}
      loading={isSubmitting}
      accessibilityLabel={`${label} item`}
    >
      {label}
    </Button>
  );
}
