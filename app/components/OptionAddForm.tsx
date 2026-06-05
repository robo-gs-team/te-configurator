import { useFetcher } from "@remix-run/react";
import { BlockStack, Box, Button, FormLayout, Text, TextField } from "@shopify/polaris";
import { useEffect, useState } from "react";

type OptionAddFormProps = {
  stepId: string;
  defaultGroupName?: string;
};

export function OptionAddForm({
  stepId,
  defaultGroupName = "String",
}: OptionAddFormProps) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const isSubmitting = fetcher.state !== "idle";

  const [groupName, setGroupName] = useState(defaultGroupName);
  const [optionLabel, setOptionLabel] = useState("");
  const [optionValue, setOptionValue] = useState("");
  const [colorHex, setColorHex] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [priceAdjust, setPriceAdjust] = useState("0");
  const [variantId, setVariantId] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setOptionLabel("");
      setOptionValue("");
      setColorHex("");
      setImageUrl("");
      setPriceAdjust("0");
      setVariantId("");
    }
  }, [fetcher.state, fetcher.data]);

  const handleSubmit = () => {
    if (!optionLabel.trim()) return;

    fetcher.submit(
      {
        intent: "add_option",
        stepId,
        groupName: groupName.trim() || defaultGroupName,
        optionLabel: optionLabel.trim(),
        optionValue: optionValue.trim() || optionLabel.trim().toLowerCase().replace(/\s+/g, "_"),
        colorHex: colorHex.trim(),
        imageUrl: imageUrl.trim(),
        priceAdjust,
        variantId: variantId.trim(),
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
        <FormLayout.Group>
          <TextField
            label="Group name"
            value={groupName}
            onChange={setGroupName}
            autoComplete="off"
            helpText="e.g. String, Tension, Stencil"
          />
          <TextField
            label="Option label"
            value={optionLabel}
            onChange={setOptionLabel}
            autoComplete="off"
            requiredIndicator
          />
          <TextField
            label="Value"
            value={optionValue}
            onChange={setOptionValue}
            helpText="Leave blank to auto-generate from label"
            autoComplete="off"
          />
        </FormLayout.Group>
        <FormLayout.Group>
          <TextField
            label="Color hex"
            value={colorHex}
            onChange={setColorHex}
            placeholder="#000000"
            autoComplete="off"
          />
          <TextField
            label="Image URL"
            value={imageUrl}
            onChange={setImageUrl}
            autoComplete="off"
          />
          <TextField
            label="Price adjust"
            value={priceAdjust}
            onChange={setPriceAdjust}
            type="number"
            autoComplete="off"
          />
          <TextField
            label="Variant ID"
            value={variantId}
            onChange={setVariantId}
            autoComplete="off"
          />
        </FormLayout.Group>
      </FormLayout>
      <Box paddingBlockStart="200">
        <Button
          onClick={handleSubmit}
          size="slim"
          variant="primary"
          loading={isSubmitting}
          disabled={!optionLabel.trim()}
        >
          Add option
        </Button>
      </Box>
    </BlockStack>
  );
}
