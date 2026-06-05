import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const shopDomain = process.env.SHOP || "demo-store.myshopify.com";

  const shop = await prisma.shop.upsert({
    where: { domain: shopDomain },
    create: { domain: shopDomain, name: "Demo Store" },
    update: {},
  });

  await prisma.themeSetting.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      buttonLabel: "Customize Product",
      modalAccent: "#6366f1",
    },
    update: {},
  });

  const existing = await prisma.configurator.findFirst({
    where: { shopId: shop.id, name: "Proto Switcher Demo" },
  });

  if (!existing) {
    await prisma.configurator.create({
      data: {
        shopId: shop.id,
        name: "Proto Switcher Demo",
        description: "Premium product configurator demo",
        basePrice: 299,
        productIds: JSON.stringify([]),
        steps: {
          create: [
            {
              title: "Choose Color",
              stepType: "variant",
              sortOrder: 0,
              optionGroups: {
                create: [
                  {
                    name: "Color",
                    displayType: "swatch",
                    sortOrder: 0,
                    options: {
                      create: [
                        {
                          label: "Midnight Black",
                          value: "black",
                          colorHex: "#111827",
                          priceAdjust: 0,
                          isDefault: true,
                          sortOrder: 0,
                        },
                        {
                          label: "Arctic White",
                          value: "white",
                          colorHex: "#f3f4f6",
                          priceAdjust: 0,
                          sortOrder: 1,
                        },
                        {
                          label: "Ocean Blue",
                          value: "blue",
                          colorHex: "#3b82f6",
                          priceAdjust: 25,
                          sortOrder: 2,
                        },
                      ],
                    },
                  },
                  {
                    name: "Material",
                    displayType: "card",
                    sortOrder: 1,
                    options: {
                      create: [
                        {
                          label: "Aluminum",
                          value: "aluminum",
                          priceAdjust: 0,
                          isDefault: true,
                          sortOrder: 0,
                        },
                        {
                          label: "Premium Leather",
                          value: "leather",
                          priceAdjust: 20,
                          sortOrder: 1,
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              title: "Preview",
              stepType: "preview",
              sortOrder: 1,
            },
          ],
        },
        addons: {
          create: [
            {
              name: "Wireless Charger",
              description: "Fast wireless charging pad",
              price: 49,
              sortOrder: 0,
            },
            {
              name: "Premium Case",
              description: "Hard-shell protective case",
              price: 29,
              sortOrder: 1,
            },
          ],
        },
      },
    });
  }

  console.log("Seed complete for shop:", shopDomain);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
