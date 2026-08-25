'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { ok, created, notFound, forbidden, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/pagination');
const { logActivity } = require('../utils/activity');
const { safeRecalculateFarmer } = require('../services/credit-score');

async function list(req, res) {
  const sb = supabaseAdmin();
  const { page, pageSize, from, to } = parsePagination(req.query);
  const { cooperativeId, search, startDate, endDate } = req.query;

  let q = sb.from('produce_deliveries').select(
    `*, farmers(id, full_name, cooperative_id), cooperatives(id, name)`,
    { count: 'exact' }
  );

  if (req.user.role === 'field_agent') {
    q = q.eq('logged_by_agent_id', req.user.userId);
  }
  if (cooperativeId) q = q.eq('cooperative_id', cooperativeId);
  if (startDate) q = q.gte('date_delivered', startDate);
  if (endDate) q = q.lte('date_delivered', endDate);
  q = q.order('date_delivered', { ascending: false }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  // Optional client-side search by farmer name post-fetch
  let rows = data || [];
  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((r) => (r.farmers?.full_name || '').toLowerCase().includes(s));
  }

  return paginated(res, rows, { page, pageSize, total: count || 0 });
}

async function create(req, res) {
  const sb = supabaseAdmin();
  const body = req.body;

  // Verify the farmer belongs to this agent
  const { data: farmer } = await sb.from('farmers').select('id, cooperative_id, created_by_agent_id, full_name').eq('id', body.farmerId).maybeSingle();
  if (!farmer) return notFound(res, 'Farmer not found');
  if (req.user.role === 'field_agent' && farmer.created_by_agent_id !== req.user.userId) {
    return forbidden(res, 'Farmer was not onboarded by you');
  }

  const totalValue =
    body.pricePerKg != null ? Number(body.quantityKg) * Number(body.pricePerKg) : null;

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

  // Recalculate the farmer's score (production may improve)
  safeRecalculateFarmer(body.farmerId, { triggerReason: 'delivery_logged' });

  await sb.from('notifications').insert({
    user_id: req.user.userId,
    type: 'delivery_logged',
    title: 'Delivery logged',
    message: `${data.quantity_kg} kg of ${data.crop} from ${farmer.full_name}`,
    metadata: { deliveryId: data.id, farmerId: farmer.id },
  });
  await logActivity({ actor: req.user, action: 'delivery_logged', entityType: 'delivery', entityId: data.id, req });

  return created(res, data);
}

async function getById(req, res) {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('produce_deliveries')
    .select(`*, farmers(id, full_name), cooperatives(id, name)`)
    .eq('id', req.params.deliveryId)
    .maybeSingle();
  if (!data) return notFound(res);
  if (req.user.role === 'field_agent' && data.logged_by_agent_id !== req.user.userId) return forbidden(res);
  return ok(res, data);
}

module.exports = { list, create, getById };
