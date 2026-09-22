/**
 * Reads the public estimate capability from the URL fragment only.
 * Never reads query string or path segments.
 */
export function readCapabilityTokenFromHash(): string | null {
  const rawHash = window.location.hash;
  if (rawHash.length <= 1) {
    return null;
  }

  const params = new URLSearchParams(rawHash.slice(1));
  const token = params.get('token')?.trim();

  if (token === undefined || token.length === 0) {
    return null;
  }

  return token;
}

/** Removes the fragment from the visible URL without reloading the page. */
export function stripCapabilityTokenFromAddressBar(): void {
  const url = new URL(window.location.href);
  url.hash = '';
  const next = `${url.pathname}${url.search}`;
  window.history.replaceState(null, '', next);
}
