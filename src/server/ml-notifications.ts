import { z } from "zod";
import { HttpError } from "./access";
import { find, get, put, transaction, now, key } from "./db";

// Notifications are signals, not authoritative item/order data. The official
// resource is read with the seller token before any operational update.
export async function receiveNotification(
  payload: unknown,
  queued?: (storeId: string) => void,
) {
  const body = z
    .object({
      _id: z.string().max(200).optional(),
      resource: z.string().max(200),
      user_id: z.number().int().positive(),
      application_id: z.union([
        z.number().int().positive(),
        z.string().regex(/^\d+$/),
      ]),
      topic: z.string().max(100),
      sent: z.iso.datetime({ offset: true }),
    })
    .parse(payload);
  const applicationId = String(body.application_id);
  const configured = await find("connections", {
    provider: "mercadolivre",
    application_id: applicationId,
  });
  if (!configured.length && applicationId !== process.env.ML_CLIENT_ID?.trim())
    throw new HttpError(403, "Notificação de outra aplicação");
  const patterns: Record<string, RegExp> = {
    items: /^\/items\/MLB\d{1,20}$/,
    orders_v2: /^\/orders\/\d{1,20}$/,
    questions: /^\/questions\/\d{1,20}$/,
  };
  if (!patterns[body.topic] || !patterns[body.topic].test(body.resource))
    return { accepted: true };
  if (Math.abs(Date.now() - Date.parse(body.sent)) > 7 * 86400000)
    return { accepted: true };
  const connections = await find("connections", {
    provider: "mercadolivre",
    external_account: String(body.user_id),
  });
  for (const c of connections.filter(
    (c) =>
      (c.application_id || process.env.ML_CLIENT_ID?.trim()) === applicationId,
  ))
    await transaction(async () => {
      const current = await get("connections", c.id);
      if (
        !current ||
        current.external_account !== String(body.user_id) ||
        (current.application_id || process.env.ML_CLIENT_ID?.trim()) !==
          applicationId
      )
        return;
      const old = await get("ml_notification_inbox", c.id);
      const eventId = key(
        body._id || body.sent,
        body.topic,
        body.resource,
        String(body.user_id),
      );
      const events = (
        old?.auth_version == null ||
        old.auth_version === (current.auth_version || 0)
          ? old?.events || []
          : []
      ) as Array<Record<string, unknown>>;
      if (events.some((e) => e.id === eventId)) return;
      const event = {
        id: eventId,
        resource: body.resource,
        topic: body.topic,
        sent: body.sent,
        received_at: now(),
        verified: false,
      };
      // A bounded inbox avoids retaining order/customer payloads and unbounded queues.
      await put("ml_notification_inbox", c.id, {
        events: [
          event,
          ...events.filter(
            (e) => e.resource !== body.resource || e.topic !== body.topic,
          ),
        ].slice(0, 100),
        updated_at: now(),
        auth_version: current.auth_version || 0,
      });
      await put("connections", c.id, {
        ...current,
        last_notification_at: now(),
        notification_hint: true,
      });
      queued?.(c.store_id);
    });
  return { accepted: true };
}
