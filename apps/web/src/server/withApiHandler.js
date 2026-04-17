/**
 * withApiHandler.js
 * -----------------
 * A lightweight wrapper that eliminates the repeated try/catch + error-response
 * boilerplate across every route handler.  It handles:
 *
 *   - Auth context creation (required or optional)
 *   - Cookie refresh on every response
 *   - Consistent JSON error shape  { error, details?, path, method }
 *   - statusCode on thrown errors is respected automatically
 *   - console.error always includes the route path for grep-ability
 *
 * USAGE
 * -----
 * Before (old pattern in every route file):
 *
 *   export async function GET(request) {
 *     const authed = await createRequiredAuthedContext(request, ["manager"]);
 *     if (authed?.errorResponse) return authed.errorResponse;
 *     try {
 *       return applyAuthCookies(NextResponse.json(await doWork(authed)), authed);
 *     } catch (error) {
 *       console.error("Failed to load X:", error);
 *       return applyAuthCookies(
 *         NextResponse.json({ error: error.message }, { status: error.statusCode || 500 }),
 *         authed,
 *       );
 *     }
 *   }
 *
 * After (with this helper):
 *
 *   import { withAuth, withPublic } from "@/server/withApiHandler";
 *   import { doWork } from "@/server/private-api";
 *
 *   export const GET = withAuth(["manager"], async (request, authed) => {
 *     return NextResponse.json(await doWork(authed));
 *   });
 *
 *   // Public (no auth) route:
 *   export const GET = withPublic(async (request) => {
 *     return NextResponse.json(await doPublicWork());
 *   });
 *
 * PARAMS FORWARDING
 * -----------------
 * Dynamic route params (e.g. /remnants/[id]) are passed through automatically:
 *
 *   export const PATCH = withAuth(["manager"], async (request, authed, { params }) => {
 *     const { id } = await params;
 *     return NextResponse.json(await doWork(authed, Number(id)));
 *   });
 */

import { NextResponse } from "next/server";
import {
  applyAuthCookies,
  createRequiredAuthedContext,
} from "@/server/private-api";

function extractConstraintName(text) {
  const match = /constraint "([^"]+)"/.exec(String(text || ""));
  return match ? match[1] : null;
}

function extractColumnName(text) {
  const match = /column "([^"]+)"/.exec(String(text || ""));
  return match ? match[1] : null;
}

/**
 * Translate Supabase / Postgres errors into something the user can act on.
 * Returns { message, status } — falls back to the raw message when the code
 * isn't recognized, so nothing useful is hidden.
 */
function translateError(error) {
  const code = error?.code;
  const raw = error?.message || "";
  const details = error?.details || "";
  const hint = error?.hint || "";

  switch (code) {
    case "23505": return {
      status: 409,
      message: details
        ? `Already exists: ${details}`
        : "A record with these values already exists.",
    };
    case "23503": return {
      status: 400,
      message: details
        ? `Referenced record not found: ${details}`
        : "A referenced record doesn't exist.",
    };
    case "23514": {
      const constraint = extractConstraintName(raw);
      return {
        status: 400,
        message: constraint
          ? `Value rejected by constraint "${constraint}". ${details || hint || ""}`.trim()
          : `Value rejected: ${raw}`,
      };
    }
    case "23502": {
      const column = extractColumnName(raw);
      return {
        status: 400,
        message: column
          ? `Missing required field: ${column}`
          : "A required field is missing.",
      };
    }
    case "22P02": return { status: 400, message: `Invalid value format: ${details || raw}` };
    case "22001": return { status: 400, message: "A value is too long for its column." };
    case "PGRST116": return { status: 404, message: "Not found." };
    case "PGRST301": return { status: 401, message: "Session expired. Please sign in again." };
    case "42501": return { status: 403, message: "Not allowed to perform this action." };
    default: return null;
  }
}

/**
 * Build a consistent error response.
 * Attaches path + method so logs are immediately greppable.
 */
function errorResponse(request, error, authed = null) {
  const path = request?.nextUrl?.pathname ?? "(unknown)";
  const method = request?.method ?? "?";

  const translated = translateError(error);
  const status = Number(error?.statusCode) || translated?.status || 500;
  const message = translated?.message || error?.message || "An unexpected error occurred";

  console.error(`[${method} ${path}] ${message}`);
  if (status >= 500) {
    console.error(error);
  }

  const body = { error: message, path, method };
  if (error?.details) body.details = error.details;
  if (error?.hint) body.hint = error.hint;
  if (error?.code) body.code = error.code;

  const response = NextResponse.json(body, { status });
  return authed ? applyAuthCookies(response, authed) : response;
}

/**
 * Wrap an authenticated route handler.
 *
 * @param {string[]} roles  - Allowed system_role values. Pass [] to allow any
 *                            authenticated user.
 * @param {Function} handler - async (request, authed, routeContext) => NextResponse
 */
export function withAuth(roles, handler) {
  return async function routeHandler(request, routeContext) {
    let authed;
    try {
      authed = await createRequiredAuthedContext(request, roles);
    } catch (error) {
      return errorResponse(request, error);
    }

    if (authed?.errorResponse) return authed.errorResponse;

    try {
      const response = await handler(request, authed, routeContext ?? {});
      return applyAuthCookies(response, authed);
    } catch (error) {
      return errorResponse(request, error, authed);
    }
  };
}

/**
 * Wrap a public (unauthenticated) route handler.
 *
 * @param {Function} handler - async (request, routeContext) => NextResponse
 */
export function withPublic(handler) {
  return async function routeHandler(request, routeContext) {
    try {
      return await handler(request, routeContext ?? {});
    } catch (error) {
      return errorResponse(request, error);
    }
  };
}
