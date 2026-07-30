import { useAppBridge } from "@shopify/app-bridge-react";
import { BlockStack, Button, InlineStack, Tag, Text } from "@shopify/polaris";
import type { ReactNode } from "react";
import { toCollectionGid } from "~/lib/collection-id";
import type { CollectionSummary } from "~/lib/shopify-collections.server";

type Props = {
  label?: ReactNode;
  helpText?: string;
  selected: CollectionSummary[];
  onChange: (collections: CollectionSummary[]) => void;
  name?: string;
};

type PickerCollection = {
  id: string;
  title?: string;
};

function mapPickerCollections(result: PickerCollection[]): CollectionSummary[] {
  return result.map((collection) => ({
    id: String(collection.id).replace("gid://shopify/Collection/", ""),
    title: collection.title ?? "Collection",
  }));
}

function dedupeById(collections: CollectionSummary[]): CollectionSummary[] {
  const byId = new Map<string, CollectionSummary>();
  for (const collection of collections) {
    byId.set(collection.id, collection);
  }
  return [...byId.values()];
}

export function CollectionPicker({
  label = "Collections",
  helpText,
  selected,
  onChange,
  name = "collectionIds",
}: Props) {
  const shopify = useAppBridge();

  async function openPicker(mode: "replace" | "add") {
    try {
      const picker = await shopify.resourcePicker({
        type: "collection",
        multiple: true,
        action: mode === "add" ? "add" : "select",
        selectionIds:
          mode === "replace"
            ? selected.map((collection) => ({ id: toCollectionGid(collection.id) }))
            : [],
      });

      if (picker === undefined) return;

      const result = Array.isArray(picker)
        ? picker
        : ((picker as { selection?: PickerCollection[] } | undefined)?.selection ?? []);

      const mapped = mapPickerCollections(result);

      if (mode === "add") {
        onChange(dedupeById([...selected, ...mapped]));
        return;
      }

      onChange(mapped);
    } catch (error) {
      console.error("Collection picker failed", error);
      try {
        shopify.toast?.show("Couldn't open the collection picker. Please try again.", {
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
        {selected.length === 0 ? (
          <Button onClick={() => void openPicker("replace")}>Select collections</Button>
        ) : (
          <>
            <Button onClick={() => void openPicker("add")}>Add more collections</Button>
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
        value={JSON.stringify(selected.map((collection) => collection.id))}
      />
    </BlockStack>
  );
}
