"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/ui";

// Makes sure the signed-in Clerk user has a Convex user row before any page that needs it renders.
// This is UX only: every Convex function checks the caller again on the server.
export function ViewerGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    ensure()
      .then(() => setReady(true))
      .catch((e) => setError(errorMessage(e)));
  }, [isAuthenticated, ensure]);

  if (error) return <p className="error">{error}</p>;
  if (isLoading || (isAuthenticated && !ready)) return <p className="muted" role="status">Loading…</p>;
  if (!isAuthenticated) {
    return (
      <div className="empty">
        <p>Convex could not verify your session.</p>
        <p className="small-text">
          Check that the Clerk “convex” JWT template exists and that CLERK_JWT_ISSUER_DOMAIN is set on the Convex
          deployment (see README).
        </p>
      </div>
    );
  }
  return children;
}
