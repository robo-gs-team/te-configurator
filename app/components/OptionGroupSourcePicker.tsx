import { BlockStack, Text } from "@shopify/polaris";
import { useState } from "react";
import { CollectionPicker } from "~/components/CollectionPicker";
import { ProductPicker } from "~/components/ProductPicker";
import type { CollectionSummary } from "~/lib/shopify-collections.server";
import type { ProductSummary } from "~/lib/shopify-products.server";

type Props = {
  groupId: string;
  groupName: string;
  initialCollections: CollectionSummary[];
  initialProducts: ProductSummary[];
};

// Purely a controlled sub-section of the page's single "Save changes" form — no submit
// button, no fetcher of its own. CollectionPicker/ProductPicker already render a hidden
// input under the given name, so their selections travel with the enclosing <Form> and are
// picked up by the `update` action alongside everything else on the page.
export function OptionGroupSourcePicker({
  groupId,
  groupName,
  initialCollections,
  initialProducts,
}: Props) {
  const [collections, setCollections] = useState(initialCollections);
  const [products, setProducts] = useState(initialProducts);

  return (
    <BlockStack gap="300">
      <Text as="p" variant="bodySm" fontWeight="semibold">
        Product sources for &quot;{groupName}&quot;
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        Pick collections and/or individual products. Featured images and variant IDs
        are pulled from Shopify automatically. Manual options above are kept as well.
      </Text>
      <CollectionPicker
        label="Collections"
        helpText="All products in these collections appear as options."
        selected={collections}
        onChange={setCollections}
        name={`groupCollections_${groupId}`}
      />
      <ProductPicker
        label="Individual products"
        helpText="These products also appear as options."
        selected={products}
        onChange={setProducts}
        name={`groupProducts_${groupId}`}
      />
    </BlockStack>
  );
}
