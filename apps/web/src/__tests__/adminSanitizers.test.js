/**
 * sanitizeAdminWriteValues() + parseAdminColumnValue() unit tests
 * ===============================================================
 * Covers the type-coercion branches used by admin-api when applying
 * user input to the admin table config.
 */

import { parseAdminColumnValue, sanitizeAdminWriteValues } from "@/server/admin-api";

describe("parseAdminColumnValue", () => {
  test("boolean: truthy strings", () => {
    expect(parseAdminColumnValue("active", { type: "boolean" }, "true")).toBe(true);
    expect(parseAdminColumnValue("active", { type: "boolean" }, "yes")).toBe(true);
    expect(parseAdminColumnValue("active", { type: "boolean" }, "1")).toBe(true);
    expect(parseAdminColumnValue("active", { type: "boolean" }, 1)).toBe(true);
    expect(parseAdminColumnValue("active", { type: "boolean" }, true)).toBe(true);
  });

  test("boolean: falsy strings", () => {
    expect(parseAdminColumnValue("active", { type: "boolean" }, "false")).toBe(false);
    expect(parseAdminColumnValue("active", { type: "boolean" }, "0")).toBe(false);
    expect(parseAdminColumnValue("active", { type: "boolean" }, 0)).toBe(false);
  });

  test("boolean: unknown string throws", () => {
    expect(() => parseAdminColumnValue("active", { type: "boolean" }, "maybe"))
      .toThrow("Invalid boolean value: maybe");
  });

  test("integer: parses numbers, rejects garbage", () => {
    expect(parseAdminColumnValue("id", { type: "integer" }, "42")).toBe(42);
    expect(parseAdminColumnValue("id", { type: "integer" }, "")).toBeNull();
    expect(() => parseAdminColumnValue("id", { type: "integer" }, "abc"))
      .toThrow("Invalid numeric value for id");
  });

  test("timestamptz: ISO normalization", () => {
    const result = parseAdminColumnValue("created_at", { type: "timestamptz" }, "2026-04-17T12:34:00Z");
    expect(result).toBe("2026-04-17T12:34:00.000Z");
  });

  test("timestamptz: invalid date throws", () => {
    expect(() => parseAdminColumnValue("created_at", { type: "timestamptz" }, "not-a-date"))
      .toThrow("Invalid timestamp value: not-a-date");
  });

  test("enum: accepts allowed, rejects others", () => {
    const config = { type: "enum", options: ["available", "hold", "sold"] };
    expect(parseAdminColumnValue("status", config, "hold")).toBe("hold");
    expect(() => parseAdminColumnValue("status", config, "pending"))
      .toThrow("Invalid value for status");
  });

  test("json: parses strings, passes objects through", () => {
    expect(parseAdminColumnValue("meta", { type: "json" }, '{"a":1}')).toEqual({ a: 1 });
    expect(parseAdminColumnValue("meta", { type: "json" }, { a: 1 })).toEqual({ a: 1 });
    expect(() => parseAdminColumnValue("meta", { type: "json" }, "{not json"))
      .toThrow("Invalid JSON value");
  });

  test("undefined raw value with defaultValue returns the default", () => {
    const config = { type: "boolean", defaultValue: true };
    expect(parseAdminColumnValue("active", config, undefined)).toBe(true);
  });

  test("undefined raw value with no default returns undefined", () => {
    expect(parseAdminColumnValue("foo", { type: "text" }, undefined)).toBeUndefined();
  });

  test("text defaults: empty string becomes null", () => {
    expect(parseAdminColumnValue("name", { type: "text" }, "")).toBeNull();
    expect(parseAdminColumnValue("name", { type: "text" }, "Hello")).toBe("Hello");
  });
});

describe("sanitizeAdminWriteValues", () => {
  const tableConfig = {
    columns: {
      id: { type: "bigint", editable: false },
      name: { type: "text", required: true },
      active: { type: "boolean", defaultValue: true },
      notes: { type: "text" },
    },
  };

  test("skips non-editable columns", () => {
    const out = sanitizeAdminWriteValues(tableConfig, { id: 99, name: "Hello" }, "insert");
    expect(out).not.toHaveProperty("id");
    expect(out.name).toBe("Hello");
  });

  test("insert mode omits optional nulls the user didn't submit", () => {
    const out = sanitizeAdminWriteValues(tableConfig, { name: "X" }, "insert");
    expect(out).not.toHaveProperty("notes");
    expect(out).toEqual({ name: "X", active: true });
  });

  test("insert mode keeps optional nulls when the user explicitly submitted null", () => {
    const out = sanitizeAdminWriteValues(tableConfig, { name: "X", notes: null }, "insert");
    expect(out).toHaveProperty("notes", null);
  });

  test("update mode keeps nulls (they are clears)", () => {
    const out = sanitizeAdminWriteValues(tableConfig, { name: "X", notes: null }, "update");
    expect(out).toEqual({ name: "X", notes: null, active: true });
  });

  test("throws on invalid column value", () => {
    expect(() => sanitizeAdminWriteValues(tableConfig, { name: "X", active: "maybe" }, "insert"))
      .toThrow("Invalid boolean value");
  });
});
