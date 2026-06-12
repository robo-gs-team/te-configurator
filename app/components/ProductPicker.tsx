import { useAppBridge } from "@shopify/app-bridge-react";
import { BlockStack, Button, InlineStack, Tag, Text } from "@shopify/polaris";
import { toProductGid } from "~/lib/product-id";
import type { ProductSummary } from "~/lib/shopify-products.server";

type Props = {
  selected: ProductSummary[];
  onChange: (products: ProductSummary[]) => void;
};

type PickerProduct = {
  id: string;
  title?: string;
};

export function ProductPicker({ selected, onChange }: Props) {
  const shopify = useAppBridge();

  async function openPicker() {
    const picker = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: selected.map((product) => toProductGid(product.id)),
    });

    const result = Array.isArray(picker)
      ? picker
      : ((picker as { selection?: PickerProduct[] } | undefined)?.selection ?? []);

    if (!result.length) return;

    onChange(
      result.map((product) => ({
        id: String(product.id).replace("gid://shopify/Product/", ""),
        title: product.title ?? "Product",
      })),
    );
  }

  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodySm" tone="subdued">
        Select the products that should use this configurator on the storefront.
      </Text>
      {selected.length > 0 ? (
        <InlineStack gap="200" wrap>
          {selected.map((product) => (
            <Tag
              key={product.id}
              onRemove={() => onChange(selected.filter((item) => item.id !== product.id))}
            >
              {product.title}
            </Tag>
          ))}
        </InlineStack>
      ) : (
        <Text as="p" variant="bodySm" tone="subdued">
          No products selected yet.
        </Text>
      )}
      <InlineStack gap="200">
        <Button onClick={() => void openPicker()}>Select products</Button>
        {selected.length > 0 ? (
          <Button variant="plain" onClick={() => onChange([])}>
            Clear all
          </Button>
        ) : null}
      </InlineStack>
      <input
        type="hidden"
        name="productIds"
        value={JSON.stringify(selected.map((product) => product.id))}
      />
    </BlockStack>
  );
}
