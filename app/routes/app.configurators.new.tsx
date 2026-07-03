import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  FormLayout,
  Icon,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
  Tooltip,
} from "@shopify/polaris";
import { QuestionCircleIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import { CollectionPicker } from "~/components/CollectionPicker";
import { LaborProductPicker, type LaborProductSelection } from "~/components/LaborProductPicker";
import { ProductPicker } from "~/components/ProductPicker";
import prisma from "~/db.server";
import { ensureShop } from "~/lib/configurator.server";
import { parseCollectionIdsField } from "~/lib/collection-id";
import { parseProductIdsField } from "~/lib/product-id";
import type { CollectionSummary } from "~/lib/shopify-collections.server";
import type { ProductSummary } from "~/lib/shopify-products.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();

  const name = String(form.get("name") || "").trim();
  const description = String(form.get("description") || "").trim();
  const collectionIds = parseCollectionIdsField(String(form.get("collectionIds") || ""));
  const stringCollectionIds = parseCollectionIdsField(String(form.get("stringCollectionIds") || ""));
  const productIds = parseProductIdsField(String(form.get("productIds") || ""));
  const stringProductIds = parseProductIdsField(String(form.get("stringProductIds") || ""));
  const laborVariantId = String(form.get("laborVariantId") || "").trim() || null;
  const laborPrice = parseFloat(String(form.get("laborPrice") || "0")) || 0;
  const basePrice = parseFloat(String(form.get("basePrice") || "0")) || 0;

  if (!name) return json({ error: "Name is required" }, { status: 400 });

  // No pre-seeded steps/option groups: a racquet collection + string collection + labor
  // product is enough for a working stringing configurator on its own (the string catalog
  // is auto-resolved from stringCollectionIds/stringProductIds — see
  // enrich-configurator.server.ts). Merchants only need "Steps & options" for extra
  // customization beyond standard stringing.
  const configurator = await prisma.configurator.create({
    data: {
      shopId: shop.id,
      name,
      description: description || null,
      productIds: JSON.stringify(productIds),
      collectionIds: JSON.stringify(collectionIds),
      stringCollectionIds: JSON.stringify(stringCollectionIds),
      stringProductIds: JSON.stringify(stringProductIds),
      laborVariantId,
      laborPrice,
      basePrice,
    },
  });

  return redirect(`/app/configurators/${configurator.id}`);
};

const WIZARD_STEPS = [
  { label: "Basics" },
  { label: "Racquets" },
  { label: "Strings" },
  { label: "Labor & price" },
  { label: "Review" },
] as const;

// A small hoverable "?" next to a step heading — a quick hint, always paired with a
// persistent Banner nearby for the full explanation (tooltips alone aren't reliably
// discoverable on touch devices, so they're a supplement here, never the only source).
function StepHint({ content }: { content: string }) {
  return (
    <Tooltip content={content}>
      <span style={{ display: "inline-flex", cursor: "help" }}>
        <Icon source={QuestionCircleIcon} tone="subdued" />
      </span>
    </Tooltip>
  );
}

function StepHeading({ number, title, hint }: { number: number; title: string; hint: string }) {
  return (
    <InlineStack gap="150" blockAlign="center">
      <Text as="h2" variant="headingMd">
        {number}. {title}
      </Text>
      <StepHint content={hint} />
    </InlineStack>
  );
}

function WizardProgress({ stepIndex }: { stepIndex: number }) {
  return (
    <InlineStack gap="300" wrap>
      {WIZARD_STEPS.map((s, i) => (
        <InlineStack key={s.label} gap="150" blockAlign="center">
          <Badge tone={i === stepIndex ? "info" : i < stepIndex ? "success" : undefined}>
            {String(i + 1)}
          </Badge>
          <Text
            as="span"
            variant="bodySm"
            fontWeight={i === stepIndex ? "semibold" : "regular"}
            tone={i === stepIndex ? undefined : "subdued"}
          >
            {s.label}
          </Text>
          {i < WIZARD_STEPS.length - 1 && (
            <Text as="span" tone="subdued">
              →
            </Text>
          )}
        </InlineStack>
      ))}
    </InlineStack>
  );
}

function ReviewRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <BlockStack gap="050">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="span" variant="bodyMd">
          {value}
        </Text>
      </BlockStack>
      <Button variant="plain" onClick={onEdit}>
        Edit
      </Button>
    </InlineStack>
  );
}

// Every step's content stays mounted (never unmounted) so hidden <input> fields from the
// resource pickers remain part of the DOM at submit time, even though only the active step
// is visible — see the pickers, which all render `<input type="hidden">` under the hood.
function WizardStep({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div style={{ display: active ? "block" : "none" }}>{children}</div>;
}

export default function NewConfigurator() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCollections, setSelectedCollections] = useState<CollectionSummary[]>([]);
  const [selectedStringCollections, setSelectedStringCollections] = useState<CollectionSummary[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<ProductSummary[]>([]);
  const [selectedStringProducts, setSelectedStringProducts] = useState<ProductSummary[]>([]);
  const [laborProduct, setLaborProduct] = useState<LaborProductSelection | null>(null);
  const [basePrice, setBasePrice] = useState("0");

  const canProceedFromBasics = name.trim().length > 0;
  const isLastStep = step === WIZARD_STEPS.length - 1;

  const goNext = () => setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const racquetSummary =
    [
      selectedCollections.length > 0 ? `${selectedCollections.length} collection(s)` : null,
      selectedProducts.length > 0 ? `${selectedProducts.length} product(s)` : null,
    ]
      .filter(Boolean)
      .join(", ") || "None selected yet";

  const stringSummary =
    [
      selectedStringCollections.length > 0
        ? `${selectedStringCollections.length} collection(s)`
        : null,
      selectedStringProducts.length > 0 ? `${selectedStringProducts.length} product(s)` : null,
    ]
      .filter(Boolean)
      .join(", ") || "None selected yet";

  return (
    <Page
      title="Create configurator"
      backAction={{ content: "Configurators", url: "/app/configurators" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <WizardProgress stepIndex={step} />
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Form method="post">
              <BlockStack gap="400">
                {actionData?.error && (
                  <Text as="p" tone="critical">
                    {actionData.error}
                  </Text>
                )}

                <WizardStep active={step === 0}>
                  <BlockStack gap="300">
                    <StepHeading
                      number={1}
                      title="Basics"
                      hint="A recognizable internal name — shoppers never see it."
                    />
                    <FormLayout>
                      <TextField
                        label="Name"
                        name="name"
                        value={name}
                        onChange={setName}
                        autoComplete="off"
                        requiredIndicator
                        helpText="e.g. &quot;Performance racquets&quot; or &quot;Junior racquets&quot;"
                      />
                      <TextField
                        label="Description"
                        name="description"
                        value={description}
                        onChange={setDescription}
                        autoComplete="off"
                        multiline={3}
                      />
                    </FormLayout>
                  </BlockStack>
                </WizardStep>

                <WizardStep active={step === 1}>
                  <BlockStack gap="300">
                    <StepHeading
                      number={2}
                      title="Racquets"
                      hint="Every racquet in these collections/products shows the Configure button."
                    />
                    <Banner tone="info" title="What is a configurator?">
                      <p>
                        A configurator is a stringing setup assigned to one or more{" "}
                        <strong>racquet collections</strong> (or individual racquet products).
                        Every racquet in that collection shows the Configure button using this
                        configurator's string options, labor fee, and price. Create more than one
                        if different racquet collections need different string options or labor
                        pricing — e.g. one for performance racquets, another for junior racquets.
                        Most shops only need one.
                      </p>
                    </Banner>
                    <CollectionPicker
                      label="Racquet collections"
                      helpText="Products in these collections will show the Configure button."
                      selected={selectedCollections}
                      onChange={setSelectedCollections}
                    />
                    <ProductPicker
                      label="Individual racquet products"
                      helpText="These specific products will also show the Configure button."
                      selected={selectedProducts}
                      onChange={setSelectedProducts}
                    />
                  </BlockStack>
                </WizardStep>

                <WizardStep active={step === 2}>
                  <BlockStack gap="300">
                    <StepHeading
                      number={3}
                      title="Strings"
                      hint="These products become the string options shoppers pick from."
                    />
                    <CollectionPicker
                      label="String collections"
                      helpText="Products in these collections appear as string options in the configurator."
                      name="stringCollectionIds"
                      selected={selectedStringCollections}
                      onChange={setSelectedStringCollections}
                    />
                    <ProductPicker
                      label="Individual string products"
                      helpText="These specific products also appear as string options, in addition to any string collections above."
                      name="stringProductIds"
                      selected={selectedStringProducts}
                      onChange={setSelectedStringProducts}
                    />
                  </BlockStack>
                </WizardStep>

                <WizardStep active={step === 3}>
                  <BlockStack gap="300">
                    <StepHeading
                      number={4}
                      title="Labor & price"
                      hint="The labor product is added to cart once per stringed racquet."
                    />
                    <LaborProductPicker selected={laborProduct} onChange={setLaborProduct} />
                    <TextField
                      label="Base price"
                      name="basePrice"
                      type="number"
                      value={basePrice}
                      onChange={setBasePrice}
                      autoComplete="off"
                      prefix="$"
                      helpText="Optional starting price shown before string/labor are added — most shops leave this at $0."
                    />
                  </BlockStack>
                </WizardStep>

                <WizardStep active={step === 4}>
                  <BlockStack gap="300">
                    <StepHeading
                      number={5}
                      title="Review"
                      hint="Double-check everything, then create — you can change all of this later."
                    />
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="300">
                        <ReviewRow label="Name" value={name || "—"} onEdit={() => setStep(0)} />
                        <ReviewRow
                          label="Description"
                          value={description || "—"}
                          onEdit={() => setStep(0)}
                        />
                        <ReviewRow
                          label="Racquets"
                          value={racquetSummary}
                          onEdit={() => setStep(1)}
                        />
                        <ReviewRow
                          label="Strings"
                          value={stringSummary}
                          onEdit={() => setStep(2)}
                        />
                        <ReviewRow
                          label="Labor product"
                          value={laborProduct ? `${laborProduct.title} ($${laborProduct.price.toFixed(2)})` : "None selected yet"}
                          onEdit={() => setStep(3)}
                        />
                        <ReviewRow
                          label="Base price"
                          value={`$${(parseFloat(basePrice) || 0).toFixed(2)}`}
                          onEdit={() => setStep(3)}
                        />
                      </BlockStack>
                    </Box>
                    <Text as="p" variant="bodySm" tone="subdued">
                      The configurator is created as <strong>Active</strong> by default. You can
                      turn it off, add add-ons, or fine-tune anything else from the configurator's
                      page after creating it.
                    </Text>
                  </BlockStack>
                </WizardStep>

                <InlineStack align="space-between">
                  {step > 0 ? (
                    <Button onClick={goBack}>Back</Button>
                  ) : (
                    <span />
                  )}
                  {!isLastStep ? (
                    <Button
                      variant="primary"
                      onClick={goNext}
                      disabled={step === 0 && !canProceedFromBasics}
                    >
                      Next
                    </Button>
                  ) : (
                    <Button submit variant="primary" loading={navigation.state !== "idle"}>
                      Create configurator
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
