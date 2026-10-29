/**
 * Produce delivery — **new in this port.** The Flutter app had no delivery
 * model, repository or endpoint call: the Activities 'Deliveries' tab rendered
 * a hardcoded `_EmptyState('No deliveries found')` and the dashboard's
 * 'Log delivery' quick action was a disabled stub.
 *
 * `GET /agent/deliveries` exists and works, so the model is derived from the
 * two authoritative sources:
 *
 *   READ  `produce_deliveries` rows, snake_case, with the embeds from
 *         backend/src/controllers/deliveries.controller.js:
 *           `*, farmers(id, full_name, cooperative_id), cooperatives(id, name)`
 *         `total_value` is computed server-side as quantityKg * pricePerKg.
 *
 *   WRITE camelCase, per `createDelivery` in validators/domain.js:
 *           farmerId       uuid                      required
 *           cooperativeId  uuid                      optional
 *           crop           string                    required
 *           quantityKg     number().positive()       required
 *           qualityGrade   valid('A','B','C','D')    optional
 *           pricePerKg     number().min(0)           optional
 *           dateDelivered  date().iso().max('now')   optional
 *           buyerName      string().max(150)         optional
 *           warehouse      string().max(150)         optional
 *           receiptNumber  string().max(60)          optional
 *           proofPhotoUrls array(string().uri())     optional
 *           notes          string().max(500)         optional
 */
import { z } from 'zod';

import { LIMITS } from '../../../core/api/domainConstants';

import {
  compact,
  nullableNum,
  nullableStr,
  numOrUndefined,
  obj,
  orUndefined,
  pick,
  strList,
  type Raw,
} from './primitives';

/** The embedded `farmers(...)` object. */
export interface DeliveryFarmer {
  id: string | null;
  fullName: string | null;
  cooperativeId: string | null;
}

/** The embedded `cooperatives(...)` object. */
export interface DeliveryCooperative {
  id: string | null;
  name: string | null;
}

export interface Delivery {
  id: string | null;
  farmerId: string | null;
  cooperativeId: string | null;
  crop: string | null;
  quantityKg: number | null;
  qualityGrade: string | null;
  pricePerKg: number | null;
  /** Server-computed; null when `pricePerKg` was not supplied. */
  totalValue: number | null;
  /** `yyyy-MM-dd` — the column is a date, not a timestamp. */
  dateDelivered: string | null;
  buyerName: string | null;
  warehouse: string | null;
  receiptNumber: string | null;
  proofPhotoUrls: string[];
  notes: string | null;
  loggedByAgentId: string | null;
  createdAt: string | null;
  farmer: DeliveryFarmer | null;
  cooperative: DeliveryCooperative | null;
  /** `farmers.full_name` — the only farmer name the row carries. */
  farmerName: string | null;
}

function parseDeliveryFarmer(raw: unknown): DeliveryFarmer | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = obj(raw);
  return {
    id: nullableStr(f.id),
    fullName: nullableStr(pick(f, 'full_name', 'fullName')),
    cooperativeId: nullableStr(pick(f, 'cooperative_id', 'cooperativeId')),
  };
}

function parseDeliveryCooperative(raw: unknown): DeliveryCooperative | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = obj(raw);
  return { id: nullableStr(c.id), name: nullableStr(c.name) };
}

export function parseDelivery(raw: unknown): Delivery {
  const d: Raw = obj(raw);

  const farmer = parseDeliveryFarmer(d.farmers);
  const cooperative = parseDeliveryCooperative(d.cooperatives);

  return {
    id: nullableStr(d.id),
    farmerId: nullableStr(pick(d, 'farmer_id', 'farmerId')),
    cooperativeId: nullableStr(pick(d, 'cooperative_id', 'cooperativeId')),
    crop: nullableStr(d.crop),
    quantityKg: nullableNum(pick(d, 'quantity_kg', 'quantityKg')),
    qualityGrade: nullableStr(pick(d, 'quality_grade', 'qualityGrade')),
    pricePerKg: nullableNum(pick(d, 'price_per_kg', 'pricePerKg')),
    totalValue: nullableNum(pick(d, 'total_value', 'totalValue')),
    dateDelivered: nullableStr(pick(d, 'date_delivered', 'dateDelivered')),
    buyerName: nullableStr(pick(d, 'buyer_name', 'buyerName')),
    warehouse: nullableStr(d.warehouse),
    receiptNumber: nullableStr(pick(d, 'receipt_number', 'receiptNumber')),
    proofPhotoUrls: strList(pick(d, 'proof_photo_urls', 'proofPhotoUrls')),
    notes: nullableStr(d.notes),
    loggedByAgentId: nullableStr(pick(d, 'logged_by_agent_id', 'loggedByAgentId')),
    createdAt: nullableStr(pick(d, 'created_at', 'createdAt')),
    farmer,
    cooperative,
    farmerName: farmer?.fullName ?? null,
  };
}

// ------------------------------------------------------------------- create
/**
 * Form schema for logging a delivery. Mirrors `createDelivery` so a bad value
 * is rejected before the round trip rather than coming back as a 422.
 */
export const deliverySchema = z.object({
  farmerId: z.string().min(1, 'Farmer is required'),
  cooperativeId: z.string().optional(),
  crop: z.string().min(1, 'Crop is required'),
  quantityKg: z
    .string()
    .min(1, 'Quantity is required')
    .refine((v) => Number.isFinite(Number(v)), 'Enter a valid quantity')
    .refine((v) => Number(v) > 0, 'Quantity must be greater than zero'),
  qualityGrade: z.enum(['A', 'B', 'C', 'D']).optional(),
  pricePerKg: z
    .string()
    .optional()
    .refine(
      (v) => !v || (Number.isFinite(Number(v)) && Number(v) >= 0),
      'Enter a valid price',
    ),
  /** `date().iso().max('now')` — a future delivery is rejected server-side. */
  dateDelivered: z.string().optional(),
  buyerName: z
    .string()
    .max(LIMITS.buyerName.max, `Buyer name must be at most ${LIMITS.buyerName.max} characters`)
    .optional(),
  warehouse: z.string().max(150, 'Warehouse must be at most 150 characters').optional(),
  receiptNumber: z
    .string()
    .max(60, 'Receipt number must be at most 60 characters')
    .optional(),
  notes: z
    .string()
    .max(LIMITS.notes.max, `Notes must be at most ${LIMITS.notes.max} characters`)
    .optional(),
});

export type DeliveryForm = z.infer<typeof deliverySchema>;

export interface CreateDeliveryInput extends DeliveryForm {
  proofPhotoUrls?: string[];
}

/** `POST /agent/deliveries` body — camelCase, per `createDelivery`. */
export function toCreateDeliveryBody(
  input: CreateDeliveryInput,
): Record<string, unknown> {
  return compact({
    farmerId: input.farmerId,
    cooperativeId: orUndefined(input.cooperativeId),
    crop: input.crop.trim(),
    quantityKg: numOrUndefined(input.quantityKg),
    qualityGrade: input.qualityGrade,
    pricePerKg: numOrUndefined(input.pricePerKg),
    dateDelivered: orUndefined(input.dateDelivered),
    buyerName: orUndefined(input.buyerName),
    warehouse: orUndefined(input.warehouse),
    receiptNumber: orUndefined(input.receiptNumber),
    proofPhotoUrls:
      input.proofPhotoUrls && input.proofPhotoUrls.length > 0
        ? input.proofPhotoUrls
        : undefined,
    notes: orUndefined(input.notes),
  });
}
