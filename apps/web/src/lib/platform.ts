export type PlatformRole = 'PLATFORM_ADMIN';

export function isPlatformAdmin(
  platformRole: PlatformRole | null | undefined,
): boolean {
  return platformRole === 'PLATFORM_ADMIN';
}

export function resolveDefaultAuthenticatedPath(input: {
  organizationsCount: number;
  platformRole: PlatformRole | null;
}): string {
  if (input.organizationsCount === 0 && isPlatformAdmin(input.platformRole)) {
    return '/app/platform/organizations';
  }

  return '/app/dashboard';
}
