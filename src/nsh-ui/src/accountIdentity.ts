// The signed-in account as every surface shows it: the backend's identity
// projection (`AccountIdentityView` in `product-domains`). The desktop and CLI
// hosts answer it from `account_identity`, the phone's native module and the
// browser gateway from their sign-in. The name is ready to show (the email for
// email accounts, the GitHub login for GitHub accounts); no surface looks at
// the provider's handles or the account id.
//
// No imports: the controller port and both stores read this shape.

export type AccountProvider = "email" | "github";

export interface AccountIdentity {
  provider: AccountProvider;
  /** The stable account id the directory keys by. Never shown. */
  accountId: string;
  /** The name to show. */
  displayName: string;
  /** One uppercase character for the avatar. */
  initial: string;
  avatarUrl: string | null;
}

/** The projection from the wire, or `null` when there is none to show. */
export function readAccountIdentity(value: unknown): AccountIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = (key: string): string => (typeof record[key] === "string" ? (record[key] as string).trim() : "");
  const displayName = text("displayName");
  if (!displayName) return null;
  return {
    provider: text("provider") === "github" ? "github" : "email",
    accountId: text("accountId"),
    displayName,
    initial: text("initial"),
    avatarUrl: text("avatarUrl") || null,
  };
}
