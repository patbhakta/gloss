// bhakta.us: Clerk middleware removed — tailnet-only single-user deployment.
// Nothing is protected here; routes that need a user use lib/clerk-shim auth().

export default function proxy() {}

export const config = {
  matcher: [],
};
