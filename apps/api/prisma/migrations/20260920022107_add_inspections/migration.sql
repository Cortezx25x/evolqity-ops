-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "InspectionItemCondition" AS ENUM ('OK', 'ATTENTION', 'FAIL', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "Inspection" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workOrderId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "nextItemOrder" INTEGER NOT NULL DEFAULT 1,
    "createdByMembershipId" UUID NOT NULL,
    "completedByMembershipId" UUID,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionItem" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "condition" "InspectionItemCondition",
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Inspection_organizationId_workOrderId_idx" ON "Inspection"("organizationId", "workOrderId");

-- CreateIndex
CREATE INDEX "Inspection_organizationId_status_idx" ON "Inspection"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Inspection_organizationId_createdAt_idx" ON "Inspection"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "InspectionItem_inspectionId_sortOrder_idx" ON "InspectionItem"("inspectionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "OrganizationUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_completedByMembershipId_fkey" FOREIGN KEY ("completedByMembershipId") REFERENCES "OrganizationUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionItem" ADD CONSTRAINT "InspectionItem_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
