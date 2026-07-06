import { useAppBridge } from "@shopify/app-bridge-react";
import { BlockStack, Button, InlineStack, Tag, Text } from "@shopify/polaris";
import type { ReactNode } from "react";
import { toProductGid } from "~/lib/product-id";
import type { ProductSummary } from "~/lib/shopify-products.server";

type Props = {
  label?: ReactNode;
  helpText?: string;
  name?: string;
  multiple?: boolean;
  selected: ProductSummary[];
  onChange: (products: ProductSummary[]) => void;
};

type PickerProduct = {
  id: string;
  title?: string;
};

export function ProductPicker({
  label = "Products",
  helpText,
  name = "productIds",
  multiple = true,
  selected,
  onChange,
}: Props) {
  const shopify = useAppBridge();

  async function openPicker() {
    const picker = await shopify.resourcePicker({
      type: "product",
      multiple,
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
      {typeof label === "string" ? (
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {label}
        </Text>
      ) : (
        label
      )}
      {helpText ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {helpText}
        </Text>
      ) : null}
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
        name={name}
        value={JSON.stringify(selected.map((product) => product.id))}
      />
    </BlockStack>
  );
}
