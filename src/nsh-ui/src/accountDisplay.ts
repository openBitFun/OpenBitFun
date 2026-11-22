// The one account the shell shows: the sidebar account row and its avatar,
// Settings › Account and the account dialog read `accountDisplay()` and
// nothing else. A browser or phone controller shows the account its own port
// signed in to; a desktop shows its host's (`account_identity`). Both are the
// backend's identity projection (`accountIdentity.ts`), so no surface picks
// between an email, a login or an id.

import type { AccountIdentity } from "./accountIdentity";
import { controllerPort } from "./controller/controllerPort";
import { controllerAccount } from "./controller/controllerStore";
import { accountIdentity, isAccountSignedIn } from "./homeStore";

export interface AccountDisplay {
  signedIn: boolean;
  /** The projection, when the backend named the account. */
  identity: AccountIdentity | null;
}

/**
 * Read in a reactive scope. A plain function, not a `computed`: the port is
 * installed by the page's entry (`servedBackend.ts`), not through a signal, so
 * a cached value could miss it.
 */
export function accountDisplay(): AccountDisplay {
  if (controllerPort()) {
    const account = controllerAccount();
    return { signedIn: account !== null, identity: account?.identity ?? null };
  }
  return { signedIn: isAccountSignedIn(), identity: accountIdentity() };
}
