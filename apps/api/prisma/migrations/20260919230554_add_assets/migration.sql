-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('VEHICLE', 'EQUIPMENT', 'DEVICE', 'OTHER');

-- CreateTable
CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "AssetType" NOT NULL DEFAULT 'VEHICLE',
    "name" TEXT NOT NULL,
    "identifier" TEXT,
    "plate" TEXT,
    "vin" TEXT,
    "serialNumber" TEXT,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_organizationId_idx" ON "Asset"("organizationId");

-- CreateIndex
CREATE INDEX "Asset_organizationId_customerId_idx" ON "Asset"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "Asset_organizationId_active_idx" ON "Asset"("organizationId", "active");

-- CreateIndex
CREATE INDEX "Asset_organizationId_type_idx" ON "Asset"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Asset_organizationId_plate_idx" ON "Asset"("organizationId", "plate");

-- CreateIndex
CREATE INDEX "Asset_organizationId_vin_idx" ON "Asset"("organizationId", "vin");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
