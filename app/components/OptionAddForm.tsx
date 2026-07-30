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

type SelectedProduct = {
  id: string;
  title: string;
  price?: number;
};

export function OptionAddForm({
  stepId,
  defaultGroupName = "String",
}: OptionAddFormProps) {
  const fetcher = useFetcher<{ error?: string; success?: boolean; added?: number }>();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";

  const [groupName, setGroupName] = useState(defaultGroupName);
  const [optionLabel, setOptionLabel] = useState("");
  const [optionValue, setOptionValue] = useState("");
  const [colorHex, setColorHex] = useState("");
  const [priceAdjust, setPriceAdjust] = useState("0");
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setOptionLabel("");
      setOptionValue("");
      setColorHex("");
      setPriceAdjust("0");
      setSelectedProducts([]);
    }
  }, [fetcher.state, fetcher.data]);

  async function openProductPicker() {
    const picker = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: selectedProducts.map(
        (product) => `gid://shopify/Product/${product.id}`,
      ),
    });

    const result = Array.isArray(picker)
      ? picker
      : ((picker as { selection?: PickerProduct[] } | undefined)?.selection ?? []);

    if (!result.length) return;

    const next = result.map((product) => {
      const id = String(product.id).replace("gid://shopify/Product/", "");
      const title = product.title ?? "Product";
      const variantPrice = product.variants?.[0]?.price;
      return {
        id,
        title,
        price: variantPrice ? parseFloat(variantPrice) || 0 : undefined,
      };
    });

    setSelectedProducts(next);

    // Single-product convenience: keep label/price fields in sync for a manual tweak before add.
    if (next.length === 1) {
      if (!optionLabel.trim()) setOptionLabel(next[0].title);
      if (priceAdjust === "0" && next[0].price !== undefined) {
        setPriceAdjust(String(next[0].price));
      }
    }
  }

  const handleSubmit = () => {
    if (selectedProducts.length === 0 && !optionLabel.trim()) return;

    const payload: Record<string, string> = {
      intent: "add_option",
      stepId,
      groupName: groupName.trim() || defaultGroupName,
      optionLabel: optionLabel.trim(),
      optionValue: optionValue.trim(),
      colorHex: colorHex.trim(),
      priceAdjust,
      productId: "",
      productsJson: "",
    };

    if (selectedProducts.length > 0) {
      payload.productsJson = JSON.stringify(selectedProducts);
    } else {
      payload.optionLabel = optionLabel.trim();
      payload.optionValue =
        optionValue.trim() ||
        optionLabel.trim().toLowerCase().replace(/\s+/g, "_");
    }

    fetcher.submit(payload, { method: "post" });
  };

  const canSubmit = selectedProducts.length > 0 || Boolean(optionLabel.trim());
  const addLabel =
    selectedProducts.length > 1
      ? `Add ${selectedProducts.length} options`
      : "Add option";

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
            helpText={
              selectedProducts.length > 1
                ? "Ignored when adding multiple products — each product title is used."
                : "Auto-filled when you pick a single product."
            }
            disabled={selectedProducts.length > 1}
          />
          <TextField
            label="Value"
            value={optionValue}
            onChange={setOptionValue}
            helpText={
              selectedProducts.length > 1
                ? "Ignored when adding multiple products — auto-generated per product."
                : "Leave blank to auto-generate from label"
            }
            autoComplete="off"
            disabled={selectedProducts.length > 1}
          />
        </FormLayout.Group>
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            Shopify product(s)
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Select one or many products. Each becomes its own option; featured image and
            variant ID are pulled from Shopify automatically.
          </Text>
          {selectedProducts.length > 0 ? (
            <InlineStack gap="200" wrap>
              {selectedProducts.map((product) => (
                <Tag
                  key={product.id}
                  onRemove={() =>
                    setSelectedProducts((items) =>
                      items.filter((item) => item.id !== product.id),
                    )
                  }
                >
                  {product.title}
                </Tag>
              ))}
            </InlineStack>
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">
              No products linked yet.
            </Text>
          )}
          <InlineStack gap="200">
            <Button onClick={() => void openProductPicker()} size="slim">
              {selectedProducts.length > 0 ? "Change products" : "Select products"}
            </Button>
            {selectedProducts.length > 0 ? (
              <Button variant="plain" size="slim" onClick={() => setSelectedProducts([])}>
                Clear
              </Button>
            ) : null}
          </InlineStack>
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
            helpText={
              selectedProducts.length > 1
                ? "Used only when a product has no Shopify price; otherwise each product’s price is used."
                : undefined
            }
          />
        </FormLayout.Group>
      </FormLayout>
      <Box paddingBlockStart="200">
        <Button
          onClick={handleSubmit}
          size="slim"
          variant="primary"
          loading={isSubmitting}
          disabled={!canSubmit}
        >
          {addLabel}
        </Button>
      </Box>
    </BlockStack>
  );
}
