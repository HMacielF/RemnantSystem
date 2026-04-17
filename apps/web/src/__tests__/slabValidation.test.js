/**
 * validateSlabPayload() unit tests
 * ================================
 * Covers each guard clause in slabs-api's payload validator.
 */

import { validateSlabPayload } from "@/server/slabs-api";

const VALID_PAYLOAD = {
  name: "Stone X",
  supplier_id: 3,
  material_id: 4,
  width: 120,
  height: 60,
};

describe("validateSlabPayload", () => {
  test("returns null when the required fields are present", () => {
    expect(validateSlabPayload(VALID_PAYLOAD, {})).toBeNull();
  });

  test("requires slab name", () => {
    expect(validateSlabPayload({ ...VALID_PAYLOAD, name: "" }, {}))
      .toBe("Slab name is required");
  });

  test("requires supplier", () => {
    expect(validateSlabPayload({ ...VALID_PAYLOAD, supplier_id: null }, {}))
      .toBe("Supplier is required");
  });

  test("requires material", () => {
    expect(validateSlabPayload({ ...VALID_PAYLOAD, material_id: 0 }, {}))
      .toBe("Material is required");
  });

  test("rejects an unparseable width when the user provided one", () => {
    const payload = { ...VALID_PAYLOAD, width: null };
    const body = { width: "not a number" };
    expect(validateSlabPayload(payload, body)).toBe("Slab width is invalid");
  });

  test("accepts a cleared width (empty string means user removed it)", () => {
    const payload = { ...VALID_PAYLOAD, width: null };
    const body = { width: "" };
    expect(validateSlabPayload(payload, body)).toBeNull();
  });

  test("rejects an unparseable height", () => {
    const payload = { ...VALID_PAYLOAD, height: null };
    const body = { height: "x" };
    expect(validateSlabPayload(payload, body)).toBe("Slab height is invalid");
  });
});
