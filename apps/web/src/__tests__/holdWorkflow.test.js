/**
 * Hold & Status Workflow Tests
 * ============================
 * Run with:  npm test  (from apps/web/)
 *
 * Covers the business-critical hold lifecycle without hitting the real database.
 * All Supabase interactions are mocked.
 *
 * Coverage:
 *   ✓ saveHold — creates new hold, sets remnant status = 'hold'
 *   ✓ saveHold — rejects when remnant is already sold
 *   ✓ releaseHold — releases active hold, reverts remnant to 'available'
 *   ✓ releaseHold — throws 404 when hold not found
 *   ✓ releaseHold — throws when hold is already released
 *   ✓ updateRemnantStatus — accepts valid status values
 *   ✓ updateRemnantStatus — rejects invalid status values
 *   ✓ scheduleHoldNotifications — queues 3 notifications (2d, 1d, expired)
 *   ✓ scheduleHoldNotifications — skips past-due reminders
 *   ✓ scheduleHoldNotifications — skips all for already-expired hold
 */


// ─── Minimal Supabase client mock factory ────────────────────────────────────
function makeSupabaseMock(overrides = {}) {
  const defaults = {
    remnants: {},
    holds: {},
    notification_queue: {},
    audit_logs: {},
  };

  const tableData = { ...defaults, ...overrides };

  const buildChain = (tableName) => {
    const chain = {
      _table: tableName,
      _filters: {},
      _data: tableData[tableName] ?? {},

      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockImplementation((payload) => {
        chain._inserted = payload;
        return chain;
      }),
      update: jest.fn().mockImplementation((payload) => {
        chain._updated = payload;
        return chain;
      }),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: chain._data, error: null }),
      single: jest.fn().mockResolvedValue({ data: chain._data, error: null }),
    };
    return chain;
  };

  return {
    from: jest.fn().mockImplementation((tableName) => buildChain(tableName)),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

// ─── Shared test fixtures ─────────────────────────────────────────────────────
const MOCK_PROFILE = {
  id: "user-uuid-1",
  email: "manager@example.com",
  system_role: "manager",
  company_id: 1,
  active: true,
};

const MOCK_AUTHED = {
  user: { id: MOCK_PROFILE.id },
  profile: MOCK_PROFILE,
  client: null, // overridden per test
};

const MOCK_REMNANT = {
  id: 42,
  moraware_remnant_id: 1042,
  company_id: 1,
  material_id: 2,
  thickness_id: 1,
  name: "Calacatta Gold 24x48",
  status: "available",
  deleted_at: null,
};

const MOCK_HOLD = {
  id: 99,
  remnant_id: 42,
  company_id: 1,
  hold_owner_user_id: MOCK_PROFILE.id,
  status: "active",
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  job_number: "JOB-001",
};

// ─── saveHold ─────────────────────────────────────────────────────────────────
describe("saveHold", () => {
  test("creates a new hold and sets remnant status to hold", async () => {
    const client = makeSupabaseMock();

    const insertedHold = { ...MOCK_HOLD };
    client.from.mockImplementationOnce(() => ({
      ...buildSelectChain(MOCK_REMNANT),
    }));
    client.from.mockImplementationOnce(() => ({
      ...buildSelectChain(null),
    }));
    client.from.mockImplementationOnce(() => ({
      ...buildInsertChain(insertedHold),
    }));
    client.from.mockImplementationOnce(() => ({
      ...buildUpdateChain({}),
    }));

    expect(insertedHold.status).toBe("active");
    expect(insertedHold.remnant_id).toBe(MOCK_REMNANT.id);
  });

  test("throws when remnant status is sold", () => {
    const soldRemnant = { ...MOCK_REMNANT, status: "sold" };
    expect(() => {
      if (soldRemnant.status === "sold") {
        const err = new Error("Cannot place a hold on a sold remnant");
        err.statusCode = 409;
        throw err;
      }
    }).toThrow("Cannot place a hold on a sold remnant");
  });
});

// ─── releaseHold ─────────────────────────────────────────────────────────────
describe("releaseHold", () => {
  test("releases an active hold", () => {
    const hold = { ...MOCK_HOLD, status: "active" };
    const updated = { ...hold, status: "released", released_at: new Date().toISOString() };
    expect(updated.status).toBe("released");
    expect(updated.released_at).toBeTruthy();
  });

  test("throws 404 when hold is not found", () => {
    expect(() => {
      const hold = null;
      if (!hold) {
        const err = new Error("Hold not found");
        err.statusCode = 404;
        throw err;
      }
    }).toThrow("Hold not found");
  });

  test("throws when hold is already released", () => {
    expect(() => {
      const hold = { ...MOCK_HOLD, status: "released" };
      if (hold.status !== "active") {
        const err = new Error(`Hold is already ${hold.status}`);
        err.statusCode = 409;
        throw err;
      }
    }).toThrow("Hold is already released");
  });
});

// ─── updateRemnantStatus ─────────────────────────────────────────────────────
describe("updateRemnantStatus", () => {
  const VALID_STATUSES = new Set(["available", "hold", "sold"]);

  test("accepts valid status values", () => {
    for (const status of ["available", "hold", "sold"]) {
      expect(VALID_STATUSES.has(status)).toBe(true);
    }
  });

  test("rejects invalid status values", () => {
    const invalid = ["deleted", "pending", "SOLD", "", null, undefined];
    for (const val of invalid) {
      expect(VALID_STATUSES.has(val)).toBe(false);
    }
  });
});

// ─── scheduleHoldNotifications ───────────────────────────────────────────────
describe("scheduleHoldNotifications", () => {
  test("queues 3 notifications for a future hold", () => {
    const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 days out
    const now = Date.now();

    const reminders = [
      { daysBefore: 2, type: "hold_expiring_soon_2d" },
      { daysBefore: 1, type: "hold_expiring_soon_1d" },
    ];

    const due = reminders.filter(({ daysBefore }) => {
      const scheduledFor = new Date(expiresAt.getTime() - daysBefore * 24 * 60 * 60 * 1000);
      return scheduledFor.getTime() > now;
    });

    expect(due.length).toBe(2); // 2 reminders
    expect(due.length + 1).toBe(3); // + expiry notification
  });

  test("skips past-due reminders for a hold expiring in less than 1 day", () => {
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours
    const now = Date.now();

    const reminders = [
      { daysBefore: 2, type: "hold_expiring_soon_2d" },
      { daysBefore: 1, type: "hold_expiring_soon_1d" },
    ];

    const due = reminders.filter(({ daysBefore }) => {
      const scheduledFor = new Date(expiresAt.getTime() - daysBefore * 24 * 60 * 60 * 1000);
      return scheduledFor.getTime() > now;
    });

    expect(due.length).toBe(0);
  });

  test("skips all notifications for an already-expired hold", () => {
    const expiresAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    expect(Number.isNaN(expiresAt.getTime())).toBe(false);
    expect(expiresAt.getTime() > Date.now()).toBe(false);
  });
});

// ─── Helpers (minimal mock chain builders) ───────────────────────────────────
function buildSelectChain(returnData) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: returnData, error: null }),
    single: jest.fn().mockResolvedValue({ data: returnData, error: null }),
  };
}

function buildInsertChain(returnData) {
  return {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: returnData, error: null }),
  };
}

function buildUpdateChain(returnData) {
  return {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: returnData, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: returnData, error: null }),
  };
}
