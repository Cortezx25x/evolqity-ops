import { apiRequest } from './api-client';
import type { OrganizationRole } from './types';

export interface OrganizationMember {
  id: string;
  role: OrganizationRole;
  active: boolean;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

export async function listOrganizationMembersRequest(
  organizationId: string,
): Promise<OrganizationMember[]> {
  return apiRequest<OrganizationMember[]>(
    `/api/organizations/${organizationId}/members`,
    { method: 'GET' },
  );
}

export interface CreateOrganizationMemberInput {
  userId: string;
  role: OrganizationRole;
}

export async function createOrganizationMemberRequest(
  organizationId: string,
  input: CreateOrganizationMemberInput,
): Promise<OrganizationMember> {
  return apiRequest<OrganizationMember>(
    `/api/organizations/${organizationId}/members`,
    {
      method: 'POST',
      body: input,
    },
  );
}

export interface ProvisionOrganizationMemberInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'MEMBER';
}

export async function provisionOrganizationMemberRequest(
  organizationId: string,
  input: ProvisionOrganizationMemberInput,
): Promise<OrganizationMember> {
  return apiRequest<OrganizationMember>(
    `/api/organizations/${organizationId}/members/provision`,
    {
      method: 'POST',
      body: input,
    },
  );
}

export async function deactivateOrganizationMemberRequest(
  organizationId: string,
  membershipId: string,
): Promise<OrganizationMember> {
  return apiRequest<OrganizationMember>(
    `/api/organizations/${organizationId}/members/${membershipId}/deactivate`,
    { method: 'POST' },
  );
}

export async function activateOrganizationMemberRequest(
  organizationId: string,
  membershipId: string,
): Promise<OrganizationMember> {
  return apiRequest<OrganizationMember>(
    `/api/organizations/${organizationId}/members/${membershipId}/activate`,
    { method: 'POST' },
  );
}
