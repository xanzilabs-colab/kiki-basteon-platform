type AuthFailure = { code?: string; message?: string } | null | undefined;
type SessionClient = {
  auth: {
    refreshSession(): Promise<{ data: { session: unknown }; error: unknown }>;
    signOut(): Promise<unknown>;
  };
};

export function isExpiredAuthError(error: AuthFailure) {
  return Boolean(error && (
    error.code === "PGRST301"
    || /jwt (?:is )?expired|token (?:has )?expired|invalid jwt/i.test(error.message ?? "")
  ));
}

export function redirectToSignIn(pathname: string) {
  const destination = pathname.startsWith("/admin")
    ? "/admin/login"
    : pathname.startsWith("/responder")
      ? "/responder/login"
      : "/login";
  const url = new URL(destination, window.location.origin);
  url.searchParams.set("reason", "session-expired");
  window.location.replace(url.toString());
}

export async function refreshExpiredSession(client: SessionClient, pathname: string) {
  try {
    const { data, error } = await client.auth.refreshSession();
    if (!error && data.session) return true;
  } catch {
    // A failed refresh cannot restore a session that the API has rejected.
  }
  try {
    await client.auth.signOut();
  } catch {
    // Redirect regardless; the login route can clear an expired local session.
  }
  redirectToSignIn(pathname);
  return false;
}
