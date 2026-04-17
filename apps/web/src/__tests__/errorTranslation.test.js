/**
 * translateError() unit tests
 * ===========================
 * Covers each Postgres / PostgREST code branch in withApiHandler's
 * server-side error translator.
 */

import { translateError } from "@/server/errorTranslation";

describe("translateError", () => {
  test("23505 unique_violation surfaces details with 409", () => {
    const result = translateError({
      code: "23505",
      message: "duplicate key value violates unique constraint \"remnants_moraware_remnant_id_key\"",
      details: "Key (moraware_remnant_id)=(449) already exists.",
    });
    expect(result.status).toBe(409);
    expect(result.message).toContain("Already exists");
    expect(result.message).toContain("Key (moraware_remnant_id)=(449)");
  });

  test("23505 without details falls back to a generic sentence", () => {
    const result = translateError({ code: "23505", message: "dup" });
    expect(result.status).toBe(409);
    expect(result.message).toBe("A record with these values already exists.");
  });

  test("23503 foreign_key_violation returns 400", () => {
    const result = translateError({
      code: "23503",
      message: "insert or update on table \"remnants\" violates foreign key",
      details: "Key (material_id)=(9999) is not present in table \"materials\".",
    });
    expect(result.status).toBe(400);
    expect(result.message).toContain("Referenced record not found");
    expect(result.message).toContain("material_id");
  });

  test("23514 check_violation extracts constraint name", () => {
    const result = translateError({
      code: "23514",
      message: "new row for relation \"remnants\" violates check constraint \"remnants_status_check\"",
    });
    expect(result.status).toBe(400);
    expect(result.message).toContain("remnants_status_check");
  });

  test("23502 not_null_violation extracts column name", () => {
    const result = translateError({
      code: "23502",
      message: "null value in column \"thickness_id\" of relation \"remnants\" violates not-null",
    });
    expect(result.status).toBe(400);
    expect(result.message).toBe("Missing required field: thickness_id");
  });

  test("22P02 invalid_text_representation returns 400", () => {
    const result = translateError({ code: "22P02", message: "invalid input syntax for type integer: \"abc\"" });
    expect(result.status).toBe(400);
    expect(result.message).toContain("Invalid value format");
  });

  test("22001 string_data_right_truncation returns 400", () => {
    const result = translateError({ code: "22001" });
    expect(result.status).toBe(400);
    expect(result.message).toBe("A value is too long for its column.");
  });

  test("PGRST116 maps to 404 Not found", () => {
    const result = translateError({ code: "PGRST116" });
    expect(result.status).toBe(404);
    expect(result.message).toBe("Not found.");
  });

  test("PGRST301 maps to 401 session expired", () => {
    const result = translateError({ code: "PGRST301" });
    expect(result.status).toBe(401);
    expect(result.message).toMatch(/sign in again/i);
  });

  test("42501 permission denied maps to 403", () => {
    const result = translateError({ code: "42501" });
    expect(result.status).toBe(403);
    expect(result.message).toBe("Not allowed to perform this action.");
  });

  test("unknown code falls through to null (caller keeps raw message)", () => {
    const result = translateError({ code: "P0099", message: "something odd" });
    expect(result).toBeNull();
  });

  test("missing code returns null", () => {
    const result = translateError({ message: "plain error" });
    expect(result).toBeNull();
  });
});
