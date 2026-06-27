import crypto from "crypto";
import { NextResponse } from "next/server";
import { resolveAuditActor } from "./audit-log";

export const JWT_SECRET = process.env.JWT_SECRET || "streampay-dev-secret-do-not-use-in-prod";
export const JWT_ISSUER = "streampay-api";
export const JWT_AUDIENCE = "streampay-app";

/**
 * Validates double-submit CSRF tokens using constant-time comparison.
 * Protects wallet authentication endpoints from timing and CSRF attacks.
 */
export function validateCsrfToken(cookieToken: string | null, headerToken: string | null): boolean {
  if (!cookieToken || !headerToken) return false;

  try {
    const bufCookie = Buffer.from(cookieToken);
    const bufHeader = Buffer.from(headerToken);

    if (bufCookie.length !== bufHeader.length) {
      return false;
    }

    // Secure constant-time string comparison
    return crypto.timingSafeEqual(bufCookie, bufHeader);
  } catch {
    return false;
  }
}

/**
 * Tries to authenticate a request via JWT.
 * Returns actor info including walletAddress on success, null on failure.
 * Does not throw.
 */
export function tryAuthenticateRequest(
  request: Request
): { actorId: string; role: 'admin' | 'user'; walletAddress: string } | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  
  try {
    const token = authHeader.substring(7);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    
    if (payload.sub && payload.iss === JWT_ISSUER && payload.aud === JWT_AUDIENCE) {
      return { 
        actorId: payload.sub, 
        role: payload.role || 'user',
        // Fallback to subject ID if walletAddress parameter isn't explicitly present in payload claims
        walletAddress: payload.walletAddress || payload.sub 
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Enforces that the request actor has audit log access.
 * Returns a NextResponse error if access is denied.
 */
export function requireAuditLogAccess(
  request: any, 
  action?: 'export' | 'read'
): { actorId: string; role: string; walletAddress: string } | null | any {
  const actor = resolveAuditActor(request);
  const allowedRoles: Array<typeof actor.role> = ["admin", "security", "compliance"];
  
  if (allowedRoles.includes(actor.role)) {
    return { 
      actorId: actor.id, 
      role: actor.role,
      walletAddress: (actor as any).walletAddress || actor.id
    }; // Access granted
  }
  
  return NextResponse.json(
    { error: { code: "FORBIDDEN", message: "Audit log access is restricted." } }, 
    { status: 403 }
  );
}