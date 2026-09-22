export type OrganizationRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export type PlatformRole = 'PLATFORM_ADMIN';

export interface PublicAuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  type: string | null;
  role: OrganizationRole;
  membershipId?: string;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: PublicAuthUser;
  organizations: OrganizationSummary[];
  platformRole: PlatformRole | null;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export interface MeResponse {
  user: PublicAuthUser;
  organizations: OrganizationSummary[];
  platformRole: PlatformRole | null;
}

export type CustomerType = 'PERSON' | 'COMPANY';

export type AssetType = 'VEHICLE' | 'EQUIPMENT' | 'DEVICE' | 'OTHER';

export interface Customer {
  id: string;
  type: CustomerType;
  name: string;
  identification: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type WorkOrderStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'COMPLETED'
  | 'CANCELLED';

export type WorkOrderPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface WorkOrderUserSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

export interface WorkOrderMembershipSummary {
  membershipId: string;
  user: WorkOrderUserSummary;
}

export interface WorkOrder {
  id: string;
  number: number;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  title: string;
  description: string | null;
  diagnosis: string | null;
  resolution: string | null;
  internalNotes: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    name: string;
    type: CustomerType;
  };
  asset: {
    id: string;
    name: string;
    type: string;
    plate: string | null;
    make: string | null;
    model: string | null;
  } | null;
  assignedTo: WorkOrderMembershipSummary | null;
  createdBy: WorkOrderMembershipSummary;
}

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  identifier: string | null;
  plate: string | null;
  vin: string | null;
  serialNumber: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    name: string;
    type: CustomerType;
  };
}
