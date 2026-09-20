-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "nextWorkOrderNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" UUID NOT NULL,
    "assetId" UUID,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "diagnosis" TEXT,
    "resolution" TEXT,
    "internalNotes" TEXT,
    "assignedToMembershipId" UUID,
    "createdByMembershipId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_status_idx" ON "WorkOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_customerId_idx" ON "WorkOrder"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_assetId_idx" ON "WorkOrder"("organizationId", "assetId");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_assignedToMembershipId_idx" ON "WorkOrder"("organizationId", "assignedToMembershipId");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_createdAt_idx" ON "WorkOrder"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_organizationId_number_key" ON "WorkOrder"("organizationId", "number");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_assignedToMembershipId_fkey" FOREIGN KEY ("assignedToMembershipId") REFERENCES "OrganizationUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "OrganizationUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
