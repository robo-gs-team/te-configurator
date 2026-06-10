import { useAppBridge } from "@shopify/app-bridge-react";
import { BlockStack, Button, InlineStack, Tag, Text } from "@shopify/polaris";
import { toCollectionGid } from "~/lib/collection-id";
import type { CollectionSummary } from "~/lib/shopify-collections.server";

type Props = {
  selected: CollectionSummary[];
  onChange: (collections: CollectionSummary[]) => void;
};

type PickerCollection = {
  id: string;
  title?: string;
};

export function CollectionPicker({ selected, onChange }: Props) {
  const shopify = useAppBridge();

  async function openPicker() {
    const picker = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: selected.map((collection) => toCollectionGid(collection.id)),
    });

    const result = Array.isArray(picker)
      ? picker
      : ((picker as { selection?: PickerCollection[] } | undefined)?.selection ??
        []);

    if (!result.length) return;

    onChange(
      result.map((collection) => ({
        id: String(collection.id).replace("gid://shopify/Collection/", ""),
        title: collection.title ?? "Collection",
      })),
    );
  }

  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodySm" tone="subdued">
        Products in the selected collections will use this configurator on the storefront.
      </Text>
      {selected.length > 0 ? (
        <InlineStack gap="200" wrap>
          {selected.map((collection) => (
            <Tag
              key={collection.id}
              onRemove={() =>
                onChange(selected.filter((item) => item.id !== collection.id))
              }
            >
              {collection.title}
            </Tag>
          ))}
        </InlineStack>
      ) : (
        <Text as="p" variant="bodySm" tone="subdued">
          No collections selected yet.
        </Text>
      )}
      <InlineStack gap="200">
        <Button onClick={() => void openPicker()}>Select collections</Button>
        {selected.length > 0 ? (
          <Button variant="plain" onClick={() => onChange([])}>
            Clear all
          </Button>
        ) : null}
      </InlineStack>
      <input
        type="hidden"
        name="collectionIds"
        value={JSON.stringify(selected.map((collection) => collection.id))}
      />
    </BlockStack>
  );
}
