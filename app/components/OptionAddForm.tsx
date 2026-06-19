import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Button,
  FormLayout,
  InlineStack,
  Tag,
  Text,
  TextField,
} from "@shopify/polaris";
import { useEffect, useState } from "react";

type OptionAddFormProps = {
  stepId: string;
  defaultGroupName?: string;
};

type PickerProduct = {
  id: string;
  title?: string;
  variants?: Array<{ id: string; price?: string }>;
};

export function OptionAddForm({
  stepId,
  defaultGroupName = "String",
}: OptionAddFormProps) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";

  const [groupName, setGroupName] = useState(defaultGroupName);
  const [optionLabel, setOptionLabel] = useState("");
  const [optionValue, setOptionValue] = useState("");
  const [colorHex, setColorHex] = useState("");
  const [priceAdjust, setPriceAdjust] = useState("0");
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setOptionLabel("");
      setOptionValue("");
      setColorHex("");
      setPriceAdjust("0");
      setSelectedProduct(null);
    }
  }, [fetcher.state, fetcher.data]);

  async function openProductPicker() {
    const picker = await shopify.resourcePicker({
      type: "product",
      multiple: false,
      selectionIds: selectedProduct
        ? [`gid://shopify/Product/${selectedProduct.id}`]
        : [],
    });

    const result = Array.isArray(picker)
      ? picker[0]
      : ((picker as { selection?: PickerProduct[] } | undefined)?.selection?.[0] ??
        null);

    if (!result) return;

    const id = String(result.id).replace("gid://shopify/Product/", "");
    const title = result.title ?? "Product";
    setSelectedProduct({ id, title });
    if (!optionLabel.trim()) setOptionLabel(title);

    const variantPrice = result.variants?.[0]?.price;
    if (variantPrice && priceAdjust === "0") {
      setPriceAdjust(String(parseFloat(variantPrice) || 0));
    }
  }

  const handleSubmit = () => {
    if (!selectedProduct && !optionLabel.trim()) return;

    fetcher.submit(
      {
        intent: "add_option",
        stepId,
        groupName: groupName.trim() || defaultGroupName,
        optionLabel: optionLabel.trim() || selectedProduct?.title || "",
        optionValue:
          optionValue.trim() ||
          (optionLabel.trim() || selectedProduct?.title || "")
            .toLowerCase()
            .replace(/\s+/g, "_"),
        colorHex: colorHex.trim(),
        priceAdjust,
        productId: selectedProduct?.id ?? "",
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
            helpText="Auto-filled when you pick a product."
          />
          <TextField
            label="Value"
            value={optionValue}
            onChange={setOptionValue}
            helpText="Leave blank to auto-generate from label"
            autoComplete="off"
          />
        </FormLayout.Group>
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            Shopify product
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Featured image and variant ID are pulled from the assigned product
            automatically.
          </Text>
          {selectedProduct ? (
            <InlineStack gap="200">
              <Tag onRemove={() => setSelectedProduct(null)}>{selectedProduct.title}</Tag>
            </InlineStack>
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">
              No product linked yet.
            </Text>
          )}
          <Button onClick={() => void openProductPicker()} size="slim">
            {selectedProduct ? "Change product" : "Select product"}
          </Button>
        </BlockStack>
        <FormLayout.Group>
          <TextField
            label="Color hex"
            value={colorHex}
            onChange={setColorHex}
            placeholder="#000000"
            autoComplete="off"
          />
          <TextField
            label="Price adjust"
            value={priceAdjust}
            onChange={setPriceAdjust}
            type="number"
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
          disabled={!selectedProduct && !optionLabel.trim()}
        >
          Add option
        </Button>
      </Box>
    </BlockStack>
  );
}
