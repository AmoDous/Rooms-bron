import "dotenv/config";
import { Pool, type PoolClient } from "pg";
import { demoRooms, demoVenues } from "../src/catalog.js";
import { postgresPoolConfig } from "../src/storage.js";

if (process.env.ALLOW_DEMO_SEED !== "true") {
  throw new Error("Set ALLOW_DEMO_SEED=true to confirm loading Rooms demo data.");
}

function hourToTime(value: number): string {
  const normalized = ((value % 24) + 24) % 24;
  const hours = Math.floor(normalized);
  const minutes = Math.round((normalized - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

async function seedVenue(client: PoolClient, venue: (typeof demoVenues)[number]): Promise<void> {
  await client.query(`
    insert into venues (
      id, slug, title, city, address, description, rules, amenities, payment_methods,
      publication_status, verification_status, cabinet_status, partner_mode
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published','verified','active',$10)
    on conflict (id) do update set
      slug = excluded.slug, title = excluded.title, city = excluded.city, address = excluded.address,
      description = excluded.description, rules = excluded.rules, amenities = excluded.amenities,
      payment_methods = excluded.payment_methods, updated_at = now()
  `, [
    venue.id, venue.slug, venue.title, venue.city, venue.address, venue.description, venue.rules,
    venue.amenities, venue.paymentMethods, venue.partnerMode,
  ]);
}

async function seedRoom(client: PoolClient, room: (typeof demoRooms)[number]): Promise<void> {
  const closesNextDay = room.closesAtHour >= 24;
  await client.query(`
    insert into rooms (
      id, venue_id, slug, title, room_type, subtitle, description, rules, promotion,
      capacity_min, capacity_max, price_per_hour, minimum_hours, rating_cached, review_count_cached,
      opens_at, closes_at, closes_next_day, buffer_minutes, features, tags, status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'published')
    on conflict (id) do update set
      venue_id = excluded.venue_id, slug = excluded.slug, title = excluded.title, room_type = excluded.room_type,
      subtitle = excluded.subtitle, description = excluded.description, rules = excluded.rules,
      promotion = excluded.promotion, capacity_min = excluded.capacity_min, capacity_max = excluded.capacity_max,
      price_per_hour = excluded.price_per_hour, minimum_hours = excluded.minimum_hours,
      rating_cached = excluded.rating_cached, review_count_cached = excluded.review_count_cached,
      opens_at = excluded.opens_at, closes_at = excluded.closes_at,
      closes_next_day = excluded.closes_next_day, buffer_minutes = excluded.buffer_minutes,
      features = excluded.features, tags = excluded.tags, updated_at = now()
  `, [
    room.id, room.venueId, room.slug, room.title, room.type, room.subtitle, room.description, room.rules,
    room.promotion, room.capacityMin, room.capacityMax, room.pricePerHour, room.minimumHours,
    room.rating, room.reviewCount, hourToTime(room.opensAtHour), hourToTime(room.closesAtHour),
    closesNextDay, room.bufferMinutes, room.features, room.tags,
  ]);
  await client.query("delete from room_photos where room_id = $1", [room.id]);
  for (const [index, path] of room.photoPaths.entries()) {
    await client.query(`
      insert into room_photos(room_id, original_url, landscape_url, sort_order, is_cover)
      values ($1,$2,$2,$3,$4)
    `, [room.id, path, index, index === 0]);
  }
  await client.query("delete from room_services where room_id = $1", [room.id]);
  for (const [index, service] of room.services.entries()) {
    await client.query(`
      insert into room_services(id, room_id, name, description, price, pricing_unit, active, sort_order)
      values ($1,$2,$3,$4,$5,'booking',true,$6)
    `, [service.id, room.id, service.name, service.description, service.price, index]);
  }
}

const pool = new Pool({ ...postgresPoolConfig(), max: 1, application_name: "rooms-seed" });
const client = await pool.connect();
try {
  await client.query("begin");
  for (const venue of demoVenues) await seedVenue(client, venue);
  for (const room of demoRooms) await seedRoom(client, room);
  await client.query("commit");
  console.log(`Seeded ${demoVenues.length} venues and ${demoRooms.length} rooms.`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
