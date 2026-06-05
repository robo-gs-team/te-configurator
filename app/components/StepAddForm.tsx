import { useFetcher } from "@remix-run/react";
import { BlockStack, Button, FormLayout, Text, TextField } from "@shopify/polaris";
import { useEffect, useState } from "react";

export function StepAddForm() {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const isSubmitting = fetcher.state !== "idle";
  const [stepTitle, setStepTitle] = useState("Choose Your Options");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setStepTitle("Choose Your Options");
    }
  }, [fetcher.state, fetcher.data]);

  const handleSubmit = () => {
    if (!stepTitle.trim()) return;
    fetcher.submit(
      {
        intent: "add_step",
        stepTitle: stepTitle.trim(),
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
        <TextField
          label="Step title"
          value={stepTitle}
          onChange={setStepTitle}
          autoComplete="off"
          helpText="Shown in the configurator popup"
        />
      </FormLayout>
      <Button onClick={handleSubmit} loading={isSubmitting} disabled={!stepTitle.trim()}>
        Add step
      </Button>
    </BlockStack>
  );
}
