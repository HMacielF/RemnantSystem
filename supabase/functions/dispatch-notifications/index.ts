/**
 * Supabase Edge Function: dispatch-notifications
 * ================================================
 * Decouples notification delivery from the HTTP request path entirely.
 * Instead of firing SMTP inline, this function:
 *
 *   1. Runs on a schedule (every 2 minutes via pg_cron — see sql/dispatch-notifications-cron.sql)
 *   2. Claims all due `pending` rows atomically (no double-sends)
 *   3. Sends the emails via SMTP
 *   4. Marks rows `sent` or `failed` with full error text
 *
 * HOW TO DEPLOY
 *   supabase functions deploy dispatch-notifications
 *
 * ENVIRONMENT VARIABLES (set in Supabase Dashboard → Edge Functions → Secrets)
 *   SUPABASE_URL              (auto-set by runtime)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-set by runtime)
 *   SMTP_HOST
 *   SMTP_PORT
 *   SMTP_USER
 *   SMTP_PASS
 *   SMTP_FROM
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer";

const BATCH_SIZE = 20;

interface NotificationRow {
  id: number;
  notification_type: string;
  target_email: string | null;
  target_user_id: string | null;
  remnant_id: number | null;
  hold_id: number | null;
  hold_request_id: number | null;
  payload: Record<string, unknown>;
  scheduled_for: string;
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 1. Claim due rows atomically ─────────────────────────────────────────
  // Using an RPC with FOR UPDATE SKIP LOCKED prevents double-sends if two
  // function invocations overlap.
  const { data: rows, error: claimError } = await supabase.rpc(
    "claim_due_notifications",
    { p_limit: BATCH_SIZE },
  );

  if (claimError) {
    console.error("Failed to claim notifications:", claimError);
    return new Response(JSON.stringify({ error: claimError.message }), { status: 500 });
  }

  const notifications = (rows ?? []) as NotificationRow[];
  if (notifications.length === 0) {
    return new Response(JSON.stringify({ dispatched: 0 }), { status: 200 });
  }

  // ── 2. Send each notification ─────────────────────────────────────────────
  const results = await Promise.allSettled(
    notifications.map((row) => dispatchOne(supabase, row)),
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  console.log(`Dispatched: ${sent} sent, ${failed} failed`);
  return new Response(JSON.stringify({ dispatched: sent, failed }), { status: 200 });
});

async function dispatchOne(
  supabase: ReturnType<typeof createClient>,
  row: NotificationRow,
): Promise<void> {
  try {
    await sendEmail(row);
    await updateStatus(supabase, row.id, "sent");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Notification ${row.id} failed:`, message);
    await updateStatus(supabase, row.id, "failed", message);
    throw err;
  }
}

async function updateStatus(
  supabase: ReturnType<typeof createClient>,
  id: number,
  status: "sent" | "failed",
  errorMessage?: string,
) {
  await supabase
    .from("notification_queue")
    .update({
      status,
      ...(status === "sent" && { sent_at: new Date().toISOString() }),
      error: errorMessage ?? null,
    })
    .eq("id", id);
}

async function sendEmail(row: NotificationRow): Promise<void> {
  const toEmail = row.target_email;
  if (!toEmail) {
    throw new Error("No target_email on notification row");
  }

  const smtpHost = Deno.env.get("SMTP_HOST");
  const smtpPort = Number(Deno.env.get("SMTP_PORT") ?? "587");
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPass = Deno.env.get("SMTP_PASS");
  const smtpFrom = Deno.env.get("SMTP_FROM") ?? smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass) {
    throw new Error("SMTP not configured in Edge Function secrets");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false, // STARTTLS on port 587
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.sendMail({
    from: smtpFrom,
    to: toEmail,
    subject: subjectFor(row),
    text: bodyFor(row),
  });
}

function subjectFor(row: NotificationRow): string {
  switch (row.notification_type) {
    case "hold_request_created":
      return "New hold request — Remnant System";
    case "hold_expiring_soon_2d":
      return "Hold expiring in 2 days — Remnant System";
    case "hold_expiring_soon_1d":
      return "Hold expiring tomorrow — Remnant System";
    case "hold_expired":
      return "Hold has expired — Remnant System";
    default:
      return `Notification: ${row.notification_type} — Remnant System`;
  }
}

function bodyFor(row: NotificationRow): string {
  const p = row.payload ?? {};
  const lines: string[] = [
    `Notification type: ${row.notification_type}`,
    "",
  ];
  if (p.remnant_id) lines.push(`Remnant ID: ${p.remnant_id}`);
  if (p.expires_at) lines.push(`Expires: ${p.expires_at}`);
  if (p.job_number) lines.push(`Job number: ${p.job_number}`);
  if (p.requester_name) lines.push(`Requester: ${p.requester_name}`);
  if (p.requester_email) lines.push(`Requester email: ${p.requester_email}`);
  return lines.join("\n");
}
