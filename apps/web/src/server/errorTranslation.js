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
 * Returns { message, status } — or null when the code isn't recognized,
 * so the caller can fall back to the raw error message.
 */
export function translateError(error) {
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
