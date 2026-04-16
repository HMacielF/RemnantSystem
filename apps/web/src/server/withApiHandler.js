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

/**
 * Build a consistent error response.
 * Attaches path + method so logs are immediately greppable.
 */
function errorResponse(request, error, authed = null) {
  const path = request?.nextUrl?.pathname ?? "(unknown)";
  const method = request?.method ?? "?";
  const status = Number(error?.statusCode) || 500;

  console.error(`[${method} ${path}] ${error?.message ?? error}`);
  if (status >= 500) {
    console.error(error);
  }

  const body = {
    error: error?.message || "An unexpected error occurred",
    path,
    method,
  };

  if (error?.details) {
    body.details = error.details;
  }

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
