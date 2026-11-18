# A security and privacy consideration

In LendLoop the integration boundary gets the most care. Every call between Convex and n8n is HMAC-signed with a
timestamp, verified in constant time and rejected outside a five-minute window, with a separate secret per direction.
The webhook carries only what the notification needs: a first name, an opaque user id, the tool and the dates. No
emails. Access rules live in Convex functions behind one auth helper, not in the UI, and every automated action is
written to an audit table with an idempotency key.

In a healthcare setting I would apply the same pattern more strictly. Workflow tools like n8n keep execution data, so
I would send them a reference, never PHI, and let the final step fetch the minimum it needs over an authenticated
call. I would add an append-only audit trail of who read which record, encryption at rest with managed keys,
least-privilege service credentials and a retention policy. I worked with similar constraints on fintech payment
bridges at Trii and on a multi-tenant Next.js and Convex platform at The Mariscal.
