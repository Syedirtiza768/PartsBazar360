import crypto from 'node:crypto';
import { Client } from 'pg';
const seller = 'seller-superior-auto-parts';
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "MvlOeRecoveryJob" (
      id uuid PRIMARY KEY, seller_id text NOT NULL, status text NOT NULL DEFAULT 'QUEUED',
      total_items integer NOT NULL DEFAULT 0, processed_items integer NOT NULL DEFAULT 0,
      attached_listings integer NOT NULL DEFAULT 0, attached_rows integer NOT NULL DEFAULT 0,
      skipped_items integer NOT NULL DEFAULT 0, failed_items integer NOT NULL DEFAULT 0,
      started_at timestamptz, completed_at timestamptz, last_heartbeat_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS "MvlOeRecoveryItem" (
      id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES "MvlOeRecoveryJob"(id) ON DELETE CASCADE,
      canonical_part_id text NOT NULL, title text, brand text, mpn text,
      oe_candidates jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'PENDING',
      attempts integer NOT NULL DEFAULT 0, research_output jsonb, mvl_rows integer NOT NULL DEFAULT 0,
      last_error text, next_attempt_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id, canonical_part_id)
    );
    CREATE INDEX IF NOT EXISTS "MvlOeRecoveryItem_claim_idx" ON "MvlOeRecoveryItem"(job_id,status,next_attempt_at,id);
  `);
  const jobId = crypto.randomUUID();
  await client.query(`INSERT INTO "MvlOeRecoveryJob" (id,seller_id,status,started_at,last_heartbeat_at) VALUES ($1,$2,'QUEUED',now(),now())`, [jobId, seller]);
  await client.query(`
    INSERT INTO "MvlOeRecoveryItem" (id,job_id,canonical_part_id,title,brand,mpn,oe_candidates)
    SELECT gen_random_uuid(),$1,cp.id,cp.title,cp.brand,cp."manufacturerPartNumber",
           jsonb_build_object('manufacturerPartNumber',cp."manufacturerPartNumber",'oeNumbers',to_jsonb(cp."oeNumbers"))
    FROM "CanonicalPart" cp
    WHERE upper(trim(cp.brand))='FEBI'
      AND (COALESCE(array_length(cp."oeNumbers",1),0)>0 OR NULLIF(btrim(cp."manufacturerPartNumber"),'') IS NOT NULL)
      AND EXISTS (SELECT 1 FROM "SellerOffer" so WHERE so."canonicalPartId"=cp.id AND so."sellerId"=$2 AND so.status='ACTIVE')
      AND NOT EXISTS (SELECT 1 FROM "Fitment" f WHERE f."canonicalPartId"=cp.id AND f.source='MVL_BACKFILL')
    ON CONFLICT (job_id,canonical_part_id) DO NOTHING`, [jobId, seller]);
  await client.query(`UPDATE "MvlOeRecoveryJob" SET total_items=(SELECT count(*) FROM "MvlOeRecoveryItem" WHERE job_id=$1),updated_at=now() WHERE id=$1`, [jobId]);
  const { rows: [job] } = await client.query(`SELECT id,status,total_items FROM "MvlOeRecoveryJob" WHERE id=$1`, [jobId]);
  console.log(JSON.stringify({ event: 'febi_job_created', jobId: job.id, status: job.status, totalItems: job.total_items, scope: 'FEBI active Superior offers only' }));
} finally { await client.end(); }