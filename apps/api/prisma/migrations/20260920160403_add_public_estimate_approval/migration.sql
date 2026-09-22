/*
  Warnings:

  - A unique constraint covering the columns `[id,organizationId]` on the table `Estimate` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,organizationId]` on the table `OrganizationUser` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PublicEstimateDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "EstimatePublicToken" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "estimateId" UUID NOT NULL,
    "secretHash" BYTEA NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "decision" "PublicEstimateDecision",
    "decidedAt" TIMESTAMP(3),
    "responderName" TEXT,
    "rejectionReason" TEXT,
    "createdByMembershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimatePublicToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EstimatePublicToken_secretHash_key" ON "EstimatePublicToken"("secretHash");

-- CreateIndex
CREATE INDEX "EstimatePublicToken_organizationId_estimateId_idx" ON "EstimatePublicToken"("organizationId", "estimateId");

-- CreateIndex
CREATE INDEX "EstimatePublicToken_estimateId_revokedAt_idx" ON "EstimatePublicToken"("estimateId", "revokedAt");

-- CreateIndex
CREATE INDEX "EstimatePublicToken_expiresAt_idx" ON "EstimatePublicToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_id_organizationId_key" ON "Estimate"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUser_id_organizationId_key" ON "OrganizationUser"("id", "organizationId");

-- Custom partial unique index: at most one non-revoked public capability per estimate
CREATE UNIQUE INDEX "EstimatePublicToken_estimateId_one_active_key" ON "EstimatePublicToken"("estimateId") WHERE "revokedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "EstimatePublicToken" ADD CONSTRAINT "EstimatePublicToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimatePublicToken" ADD CONSTRAINT "EstimatePublicToken_estimateId_organizationId_fkey" FOREIGN KEY ("estimateId", "organizationId") REFERENCES "Estimate"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimatePublicToken" ADD CONSTRAINT "EstimatePublicToken_createdByMembershipId_organizationId_fkey" FOREIGN KEY ("createdByMembershipId", "organizationId") REFERENCES "OrganizationUser"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
