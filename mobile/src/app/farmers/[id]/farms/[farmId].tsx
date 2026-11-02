/**
 * `/farmers/[id]/farms/[farmId]` — edit one farm.
 *
 * The same screen as `add.tsx`; it switches on the presence of `farmId` and
 * sends a partial update, so an edit of one field leaves the walked boundary
 * and the rest of the record alone.
 */
export { FarmFormScreen as default } from '../../../../features/farmers/screens/FarmFormScreen';
