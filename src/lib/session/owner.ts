import { cookies } from "next/headers";

/**
 * Anonymous ownership.
 *
 * There are no accounts. A rider gets an unguessable id in an HTTP-only cookie,
 * minted by the middleware on first visit. Every read and write is scoped to it,
 * so one rider can never see or delete another's sessions.
 */

export const OWNER_COOKIE = "swellread_sid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidOwnerId(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Reads the owner id. When the cookie is missing (for example during a static
 * render) a fresh throwaway id is used so that request can see nobody's data.
 */
export async function currentOwnerId(): Promise<string> {
  const store = await cookies();
  const value = store.get(OWNER_COOKIE)?.value;
  return isValidOwnerId(value) ? value : crypto.randomUUID();
}