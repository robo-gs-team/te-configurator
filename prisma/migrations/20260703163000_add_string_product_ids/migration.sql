-- Individual string products, parallel to the existing "Individual racquet products" field.
ALTER TABLE "Configurator" ADD COLUMN "stringProductIds" TEXT NOT NULL DEFAULT '[]';
