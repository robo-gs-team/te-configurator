import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher } from "@remix-run/react";
import {
  BlockStack,
  Button,
  ChoiceList,
  FormLayout,
  InlineStack,
  Tag,
  Text,
  TextField,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import { CollectionPicker } from "~/components/CollectionPicker";
import type { CollectionSummary } from "~/lib/shopify-collections.server";

type AddonSource = "product" | "collection";

export function AddonAddForm() {
  const fetcher = useFetcher<{ error?: string; success?: boolean }>();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";

  const [source, setSource] = useState<AddonSource[]>(["product"]);
  const [addonName, setAddonName] = useState("");
  const [addonDescription, setAddonDescription] = useState("");
  const [addonPrice, setAddonPrice] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<
    Array<{ id: string; title: string }>
  >([]);
  const [selectedCollections, setSelectedCollections] = useState<CollectionSummary[]>(
    [],
  );

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setAddonName("");
      setAddonDescription("");
      setAddonPrice("");
      setSelectedProducts([]);
      setSelectedCollections([]);
    }
  }, [fetcher.state, fetcher.data]);

  async function openProductPicker() {
    const picker = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: selectedProducts.map((p) => `gid://shopify/Product/${p.id}`),
    });

    const result = Array.isArray(picker)
      ? picker
      : ((picker as { selection?: Array<{ id: string; title?: string }> } | undefined)
          ?.selection ?? []);

    if (!result.length) return;

    setSelectedProducts(
      result.map((product) => ({
        id: String(product.id).replace("gid://shopify/Product/", ""),
        title: product.title ?? "Product",
      })),
    );
  }

  const handleSubmit = () => {
    const sourceType = source[0] ?? "product";
    if (sourceType === "product" && selectedProducts.length === 0) return;
    if (sourceType === "collection" && selectedCollections.length === 0) return;

    fetcher.submit(
      {
        intent: "add_addon",
        addonSource: sourceType,
        addonName: addonName.trim(),
        addonDescription: addonDescription.trim(),
        addonPrice: addonPrice.trim() || "0",
        productIds: JSON.stringify(selectedProducts.map((p) => p.id)),
        collectionIds: JSON.stringify(selectedCollections.map((c) => c.id)),
      },
      { method: "post" },
    );
  };

  const sourceType = source[0] ?? "product";
  const canSubmit =
    sourceType === "product" ? selectedProducts.length > 0 : selectedCollections.length > 0;

  return (
    <BlockStack gap="200">
      {fetcher.data?.error && (
        <Text as="p" tone="critical">
          {fetcher.data.error}
        </Text>
      )}
      <ChoiceList
        title="Add-on source"
        choices={[
          { label: "Individual product(s)", value: "product" },
          { label: "Collection(s)", value: "collection" },
        ]}
        selected={source}
        onChange={setSource}
      />
      {sourceType === "product" ? (
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" tone="subdued">
            Each selected product becomes an add-on. Featured image and variant ID are
            resolved automatically.
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
              No products selected.
            </Text>
          )}
          <Button onClick={() => void openProductPicker()}>Select products</Button>
        </BlockStack>
      ) : (
        <CollectionPicker
          label="Add-on collections"
          helpText="Each product in these collections becomes an add-on in the storefront."
          selected={selectedCollections}
          onChange={setSelectedCollections}
          name="addonCollectionIds"
        />
      )}
      <FormLayout>
        <TextField
          label="Display name (optional)"
          value={addonName}
          onChange={setAddonName}
          helpText="Leave blank to use the product title from Shopify."
          autoComplete="off"
        />
        <TextField
          label="Description"
          value={addonDescription}
          onChange={setAddonDescription}
          autoComplete="off"
        />
        <TextField
          label="Price override"
          value={addonPrice}
          onChange={setAddonPrice}
          type="number"
          helpText="Leave blank or 0 to use the Shopify product price."
          autoComplete="off"
        />
      </FormLayout>
      <Button
        onClick={handleSubmit}
        size="slim"
        loading={isSubmitting}
        disabled={!canSubmit}
      >
        Add add-on
      </Button>
    </BlockStack>
  );
}
