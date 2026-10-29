'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateFarmer } = require('../services/credit-score');
const { assertFarmerAccess } = require('../utils/ownership');
const { containsPattern } = require('../utils/search');
const logger = require('../utils/logger');

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { cooperativeId, search, farmerId, startDate, endDate } = req.query;

  let q = sb.from('produce_deliveries').select(
    `*, farmers!inner(id, full_name, cooperative_id), cooperatives(id, name)`,
    { count: 'exact' }
  );

  if (req.user.role === 'field_agent') {
    q = q.eq('logged_by_agent_id', req.user.userId);
  }
  if (cooperativeId) q = q.eq('cooperative_id', cooperativeId);
  if (farmerId) q = q.eq('farmer_id', farmerId);
  if (startDate) q = q.gte('date_delivered', startDate);
  if (endDate) q = q.lte('date_delivered', endDate);

  // FIXED — the farmer-name search was a JS `.filter()` applied AFTER
  // `.range()`. The database returned page N of ALL deliveries and the filter
  // then discarded the non-matching ones, so a search returned a handful of
  // rows (often none) while `meta.total` reported the UNFILTERED count. The
  // UI showed "182 results" above an empty table, and paging forward found
  // scattered single matches. The filter now runs in the database, through the
  // embedded farmer relation, so page and total agree.
  if (search) q = q.ilike('farmers.full_name', containsPattern(search));

  const { data, count, error } = await q
    .order('date_delivered', { ascending: false })
    .range(from, to);
  if (error) throw error;

  return paginated(res, data || [], { page, pageSize, total: count || 0 });
}

async function create(req, res) {
  const sb = supabaseAdmin();
  const body = req.body;

  // Verify the farmer belongs to this agent
  const access = await assertFarmerAccess(sb, body.farmerId, req.user);
  if (access.error === 'not_found') return notFound(res, 'Farmer not found');
  if (access.error === 'forbidden') return forbidden(res, 'Farmer was not onboarded by you');
  if (access.error) throw new Error('Could not verify access to that farmer');
  const farmer = access.farmer;

  // FIXED — `quantityKg * pricePerKg` is money computed in binary floating
  // point and stored into a NUMERIC(12,2) column. 1234.5 kg x ₦87.30 gives
  // 107772.44999999999 in JS, which Postgres then rounds — so the stored total
  // could disagree with the same multiplication done anywhere else. Rounded to
  // kobo here, before it is written.
  const totalValue =
    body.pricePerKg != null
      ? Math.round(Number(body.quantityKg) * Number(body.pricePerKg) * 100) / 100
      : null;

  const row = {
    farmer_id: body.farmerId,
    cooperative_id: body.cooperativeId || farmer.cooperative_id,
    crop: body.crop,
    quantity_kg: body.quantityKg,
    quality_grade: body.qualityGrade,
    price_per_kg: body.pricePerKg,
    total_value: totalValue,
    date_delivered: body.dateDelivered || new Date().toISOString().slice(0, 10),
    buyer_name: body.buyerName || null,
    warehouse: body.warehouse || null,
    receipt_number: body.receiptNumber,
    proof_photo_urls: body.proofPhotoUrls || null,
    notes: body.notes,
    logged_by_agent_id: req.user.userId,
  };

  const { data, error } = await sb.from('produce_deliveries').insert(row).select().single();
  if (error) throw error;

  // Recalculate the farmer's score (production may improve).
  // FIXED — was fire-and-forget, so on Vercel the recalculation was killed
  // when the response was written and never ran.
  await safeRecalculateFarmer(body.farmerId, { triggerReason: 'delivery_logged' });

  const { error: notifyErr } = await sb.from('notifications').insert({
    user_id: req.user.userId,
    type: 'delivery_logged',
    title: 'Delivery logged',
    message: `${data.quantity_kg} kg of ${data.crop} from ${farmer.full_name}`,
    metadata: { deliveryId: data.id, farmerId: farmer.id },
  });
  if (notifyErr) logger.warn({ err: notifyErr.message, code: notifyErr.code }, 'delivery notification failed');

  await logActivity({ actor: req.user, action: 'delivery_logged', entityType: 'delivery', entityId: data.id, req });

  return created(res, data);
}

async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('produce_deliveries')
    .select(`*, farmers(id, full_name), cooperatives(id, name)`)
    .eq('id', req.params.deliveryId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return notFound(res, 'Delivery not found');
  if (req.user.role === 'field_agent' && data.logged_by_agent_id !== req.user.userId) return forbidden(res);
  return ok(res, data);
}

module.exports = { list, create, getById };
