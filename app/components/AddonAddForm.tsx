import { useFetcher } from "@remix-run/react";
import { BlockStack, Button, FormLayout, Text, TextField } from "@shopify/polaris";
import { useEffect, useState } from "react";

export function AddonAddForm() {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const isSubmitting = fetcher.state !== "idle";

  const [addonName, setAddonName] = useState("");
  const [addonDescription, setAddonDescription] = useState("");
  const [addonPrice, setAddonPrice] = useState("0");
  const [addonVariantId, setAddonVariantId] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setAddonName("");
      setAddonDescription("");
      setAddonPrice("0");
      setAddonVariantId("");
    }
  }, [fetcher.state, fetcher.data]);

  const handleSubmit = () => {
    if (!addonName.trim()) return;
    fetcher.submit(
      {
        intent: "add_addon",
        addonName: addonName.trim(),
        addonDescription: addonDescription.trim(),
        addonPrice,
        addonVariantId: addonVariantId.trim(),
      },
      { method: "post" },
    );
  };

  return (
    <BlockStack gap="200">
      {fetcher.data?.error && (
        <Text as="p" tone="critical">
          {fetcher.data.error}
        </Text>
      )}
      <FormLayout>
        <TextField label="Name" value={addonName} onChange={setAddonName} autoComplete="off" />
        <TextField
          label="Description"
          value={addonDescription}
          onChange={setAddonDescription}
          autoComplete="off"
        />
        <TextField
          label="Price"
          value={addonPrice}
          onChange={setAddonPrice}
          type="number"
          autoComplete="off"
        />
        <TextField
          label="Variant ID"
          value={addonVariantId}
          onChange={setAddonVariantId}
          autoComplete="off"
        />
      </FormLayout>
      <Button onClick={handleSubmit} size="slim" loading={isSubmitting} disabled={!addonName.trim()}>
        Add add-on
      </Button>
    </BlockStack>
  );
}
