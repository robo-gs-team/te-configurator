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

function mapPickerProducts(result: PickerProduct[]): ProductSummary[] {
  return result.map((product) => ({
    id: String(product.id).replace("gid://shopify/Product/", ""),
    title: product.title ?? "Product",
  }));
}

function dedupeById(products: ProductSummary[]): ProductSummary[] {
  const byId = new Map<string, ProductSummary>();
  for (const product of products) {
    byId.set(product.id, product);
  }
  return [...byId.values()];
}

export function ProductPicker({
  label = "Products",
  helpText,
  name = "productIds",
  multiple = true,
  selected,
  onChange,
}: Props) {
  const shopify = useAppBridge();

  /**
   * Open Shopify's resource picker.
   * - `replace`: edit the full list (preselects current products).
   * - `add`: append more products without wiping the current list (empty preselection).
   *
   * selectionIds MUST be `{ id: gid }[]` — passing bare GID strings breaks multi-select /
   * preselection in App Bridge and is why "Individual string products" felt single-select only.
   */
  async function openPicker(mode: "replace" | "add") {
    try {
      const picker = await shopify.resourcePicker({
        type: "product",
        multiple: multiple ? true : false,
        action: mode === "add" ? "add" : "select",
        filter: { variants: false },
        selectionIds:
          mode === "replace"
            ? selected.map((product) => ({ id: toProductGid(product.id) }))
            : [],
      });

      // Cancel returns undefined — do not clear the current selection.
      if (picker === undefined) return;

      const result = Array.isArray(picker)
        ? picker
        : ((picker as { selection?: PickerProduct[] } | undefined)?.selection ?? []);

      const mapped = mapPickerProducts(result);

      if (mode === "add") {
        onChange(dedupeById([...selected, ...mapped]));
        return;
      }

      // Replace mode: empty confirm means clear (merchant deselected everything).
      onChange(mapped);
    } catch (error) {
      console.error("Product picker failed", error);
      try {
        shopify.toast?.show("Couldn't open the product picker. Please try again.", {
          isError: true,
        });
      } catch {
        // toast optional
      }
    }
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
        {selected.length === 0 ? (
          <Button onClick={() => void openPicker("replace")}>Select products</Button>
        ) : (
          <>
            {multiple ? (
              <Button onClick={() => void openPicker("add")}>Add more products</Button>
            ) : null}
            <Button onClick={() => void openPicker("replace")}>Change selection</Button>
            <Button variant="plain" onClick={() => onChange([])}>
              Clear all
            </Button>
          </>
        )}
      </InlineStack>
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(selected.map((product) => product.id))}
      />
    </BlockStack>
  );
}
