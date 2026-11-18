import type { AuthConfig } from "convex/server";

// Convex verifies the Clerk-issued JWT (template / integration named "convex") against this issuer's JWKS.
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
