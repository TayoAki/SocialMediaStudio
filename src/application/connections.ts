import { z } from "zod";
import { AppError } from "@/src/domain/errors";
import { appMode } from "@/src/config";
import { encryptSecret, fingerprint, keyVersion } from "@/src/security/crypto";
import { publisherFor } from "@/src/providers/publishing";
import { ProviderError } from "@/src/providers/publishing/types";
import { audit, one, withScope, type Actor } from "@/src/data/db";
import { cancelDeliveryTx } from "./deliveries";

export const Connect = z.object({ provider: z.enum(["blotato", "fixture"]), secret: z.string().min(1).max(500) });

/**
 * Validate a BYOK key server-side, store it encrypted and list accounts (FR25).
 * Accounts are imported with allowed=false; the owner must allowlist them explicitly.
 * Rotation supersedes the previous connection; its outstanding jobs keep their identity.
 */
export async function connectProvider(actor: Actor, ws: string, input: unknown) {
  const p = Connect.parse(input);
  if (p.provider === "fixture" && appMode() !== "fixture") throw new AppError("FORBIDDEN", "Fixture provider is disabled in connected mode");
  let accounts;
  try {
    accounts = await publisherFor(p.provider, p.secret).listAccounts();
  } catch (e) {
    if (e instanceof ProviderError && e.errorClass === "auth") throw new AppError("CONNECTION_EXPIRED", "The provider rejected this key");
    throw new AppError("PROVIDER_REJECTED", "Could not validate the key with the provider");
  }
  return withScope(actor, ws, async (tx) => {
    await tx.query("update provider_connections set status = 'superseded' where workspace_id = $1 and provider = $2 and status = 'valid'", [ws, p.provider]);
    const c = await one(tx,
      "insert into provider_connections (workspace_id, provider, secret_ciphertext, key_version, fingerprint, status, last_validated_at) values ($1,$2,$3,$4,$5,'valid',now()) returning id",
      [ws, p.provider, encryptSecret(p.secret), keyVersion(), fingerprint(p.secret)]);
    for (const a of accounts) {
      await tx.query(
        "insert into social_accounts (workspace_id, connection_id, external_account_id, platform, display_name, capabilities) values ($1,$2,$3,$4,$5,$6)",
        [ws, c.id, a.externalId, a.platform, a.displayName, a.capabilities]);
    }
    await audit(tx, ws, actor, "connection.created", c.id, { provider: p.provider, accounts: accounts.length });
    return { connectionId: c.id as string, accounts: accounts.length, readyToPublish: accounts.length > 0 };
  });
}

export async function setAccountAllowed(actor: Actor, ws: string, accountId: string, allowed: boolean) {
  return withScope(actor, ws, async (tx) => {
    const r = await tx.query("update social_accounts set allowed = $3 where id = $1 and workspace_id = $2", [accountId, ws, allowed]);
    if (!r.rowCount) throw new AppError("NOT_FOUND", "Account not found");
    await audit(tx, ws, actor, allowed ? "account.allowed" : "account.disallowed", accountId);
  });
}

/**
 * Disconnect (FR31): blocks new submissions immediately, requests cancellation of
 * future provider jobs (the cleanup worker may still use the stored version for that),
 * and reports jobs whose remote state cannot be changed from here.
 */
export async function disconnect(actor: Actor, ws: string, connectionId: string) {
  return withScope(actor, ws, async (tx) => {
    await one(tx, "update provider_connections set status = 'revoked' where id = $1 and workspace_id = $2 returning id", [connectionId, ws]);
    const ds = (await tx.query(
      `select d.id, d.state from deliveries d join social_accounts s on s.id = d.account_id
       where s.connection_id = $1 and d.state not in ('published','failed','cancelled')`, [connectionId])).rows;
    const unresolved: { id: string; state: string }[] = [];
    for (const d of ds) {
      const r = await cancelDeliveryTx(tx, actor, ws, d.id, null).catch(() => null);
      if (!r) unresolved.push(d);
    }
    await audit(tx, ws, actor, "connection.revoked", connectionId, { cancellationsRequested: ds.length - unresolved.length, unresolved: unresolved.length });
    return { cancellationsRequested: ds.length - unresolved.length, unresolved };
  });
}

export async function listConnections(actor: Actor, ws: string) {
  return withScope(actor, ws, async (tx) => {
    const connections = (await tx.query("select id, provider, fingerprint, status, last_validated_at, created_at from provider_connections where workspace_id = $1 order by created_at desc", [ws])).rows;
    const accounts = (await tx.query("select id, connection_id, platform, display_name, capabilities, allowed, health from social_accounts where workspace_id = $1 order by platform", [ws])).rows;
    return { connections, accounts };
  });
}
