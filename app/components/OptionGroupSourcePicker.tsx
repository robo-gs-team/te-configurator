import { useFetcher } from "@remix-run/react";
import { BlockStack, Box, Button, Text } from "@shopify/polaris";
import { useEffect, useState } from "react";
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

export function OptionGroupSourcePicker({
  groupId,
  groupName,
  initialCollections,
  initialProducts,
}: Props) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const [collections, setCollections] = useState(initialCollections);
  const [products, setProducts] = useState(initialProducts);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    setCollections(initialCollections);
    setProducts(initialProducts);
  }, [initialCollections, initialProducts]);

  const handleSave = () => {
    fetcher.submit(
      {
        intent: "update_group_sources",
        groupId,
        collectionIds: JSON.stringify(collections.map((c) => c.id)),
        productIds: JSON.stringify(products.map((p) => p.id)),
      },
      { method: "post" },
    );
  };

  return (
    <BlockStack gap="300">
      <Text as="p" variant="bodySm" fontWeight="semibold">
        Product sources for &quot;{groupName}&quot;
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        Pick collections and/or individual products. Featured images and variant IDs
        are pulled from Shopify automatically. Manual options above are kept as well.
      </Text>
      {fetcher.data?.error ? (
        <Text as="p" tone="critical">
          {fetcher.data.error}
        </Text>
      ) : null}
      {fetcher.data?.success ? (
        <Text as="p" tone="success">
          Sources saved.
        </Text>
      ) : null}
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
      <Box>
        <Button
          size="slim"
          variant="primary"
          loading={isSubmitting}
          onClick={handleSave}
        >
          Save sources
        </Button>
      </Box>
    </BlockStack>
  );
}
