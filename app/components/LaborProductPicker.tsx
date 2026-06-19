import { useAppBridge } from "@shopify/app-bridge-react";
import { BlockStack, Button, InlineStack, Tag, Text } from "@shopify/polaris";

export type LaborProductSelection = {
  variantId: string;
  title: string;
  price: number;
};

type Props = {
  selected: LaborProductSelection | null;
  onChange: (product: LaborProductSelection | null) => void;
};

type PickerProduct = {
  id: string;
  title?: string;
  variants?: Array<{
    id: string;
    title?: string;
    price?: string;
  }>;
};

export function LaborProductPicker({ selected, onChange }: Props) {
  const shopify = useAppBridge();

  async function openPicker() {
    const picker = await shopify.resourcePicker({
      type: "product",
      multiple: false,
      selectionIds: [],
    });

    const result = Array.isArray(picker)
      ? picker[0]
      : ((picker as { selection?: PickerProduct[] } | undefined)?.selection?.[0] ??
        null);

    if (!result) return;

    const variant = result.variants?.[0];
    if (!variant?.id) return;

    const variantId = String(variant.id).replace("gid://shopify/ProductVariant/", "");
    const price = parseFloat(String(variant.price ?? "0")) || 0;

    onChange({
      variantId,
      title: result.title ?? "Labor",
      price,
    });
  }

  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodyMd" fontWeight="semibold">
        Labor product
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        Added to cart once per stringed racquet (standard or hybrid). Select the
        stringing labor product from your catalog.
      </Text>
      {selected ? (
        <InlineStack gap="200" wrap>
          <Tag onRemove={() => onChange(null)}>
            {selected.title} (${selected.price.toFixed(2)})
          </Tag>
        </InlineStack>
      ) : (
        <Text as="p" variant="bodySm" tone="subdued">
          No labor product selected.
        </Text>
      )}
      <Button onClick={() => void openPicker()}>
        {selected ? "Change labor product" : "Select labor product"}
      </Button>
      <input
        type="hidden"
        name="laborVariantId"
        value={selected?.variantId ?? ""}
      />
      <input
        type="hidden"
        name="laborPrice"
        value={selected ? String(selected.price) : "0"}
      />
    </BlockStack>
  );
}
