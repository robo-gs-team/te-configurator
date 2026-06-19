import { useFetcher } from "@remix-run/react";
import { BlockStack, Box, Button, Text } from "@shopify/polaris";
import { useEffect, useState } from "react";
import { CollectionPicker } from "~/components/CollectionPicker";
import type { CollectionSummary } from "~/lib/shopify-collections.server";

type Props = {
  groupId: string;
  groupName: string;
  initialCollections: CollectionSummary[];
};

export function OptionGroupCollectionPicker({
  groupId,
  groupName,
  initialCollections,
}: Props) {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const [collections, setCollections] = useState(initialCollections);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    setCollections(initialCollections);
  }, [initialCollections]);

  const handleSave = () => {
    fetcher.submit(
      {
        intent: "update_group_collections",
        groupId,
        collectionIds: JSON.stringify(collections.map((c) => c.id)),
      },
      { method: "post" },
    );
  };

  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodySm" fontWeight="semibold">
        Product collections for &quot;{groupName}&quot;
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        Products from these collections appear as options in the storefront
        customizer (e.g. string choices). Manual options above are kept as well.
      </Text>
      {fetcher.data?.error ? (
        <Text as="p" tone="critical">
          {fetcher.data.error}
        </Text>
      ) : null}
      {fetcher.data?.success ? (
        <Text as="p" tone="success">
          Collections saved.
        </Text>
      ) : null}
      <CollectionPicker
        label="Option collections"
        selected={collections}
        onChange={setCollections}
        name={`groupCollections_${groupId}`}
      />
      <Box>
        <Button
          size="slim"
          variant="primary"
          loading={isSubmitting}
          onClick={handleSave}
        >
          Save collections
        </Button>
      </Box>
    </BlockStack>
  );
}
