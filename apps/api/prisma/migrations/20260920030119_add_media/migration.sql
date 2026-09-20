-- CreateTable
CREATE TABLE "Media" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workOrderId" UUID,
    "inspectionId" UUID,
    "inspectionItemId" UUID,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedByMembershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Media_storageKey_key" ON "Media"("storageKey");

-- CreateIndex
CREATE INDEX "Media_organizationId_workOrderId_idx" ON "Media"("organizationId", "workOrderId");

-- CreateIndex
CREATE INDEX "Media_organizationId_inspectionId_idx" ON "Media"("organizationId", "inspectionId");

-- CreateIndex
CREATE INDEX "Media_organizationId_inspectionItemId_idx" ON "Media"("organizationId", "inspectionItemId");

-- CreateIndex
CREATE INDEX "Media_organizationId_createdAt_idx" ON "Media"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_inspectionItemId_fkey" FOREIGN KEY ("inspectionItemId") REFERENCES "InspectionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_uploadedByMembershipId_fkey" FOREIGN KEY ("uploadedByMembershipId") REFERENCES "OrganizationUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
