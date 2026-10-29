/**
 * Bundled copy of the bulk-import CSV template.
 *
 * `GET /agent/imports/template` is the authoritative source and is tried
 * first; this constant is the offline fallback. It is byte-identical to the
 * string `imports.controller.downloadTemplate` returns, which is in turn
 * identical to the inline string `BulkUploadFarmersController.downloadTemplate`
 * used — including the two sample rows, which are part of the documented
 * template, not demo data shown as a farmer's record.
 */
export const FARMER_CSV_TEMPLATE = [
  'cooperative_name,state,lga,farmer_full_name,gender,phone,nin,date_of_birth,farm_size_acres,crop_type',
  'Hamsel Industries,Oyo,Akinyele,Adaeze Nwosu,female,08012345678,12345678901,1985-03-15,4.5,maize',
  'Hamsel Industries,Oyo,Akinyele,Emeka Okafor,male,08087654321,98765432109,1980-07-22,3.2,maize',
].join('\n');

/** Dart wrote `farmer_bulk_upload_template.csv` to the temp directory. */
export const TEMPLATE_FILE_NAME = 'farmer_bulk_upload_template.csv';

/** The columns the importer recognises, for the on-screen hint. */
export const TEMPLATE_COLUMNS: readonly string[] = [
  'cooperative_name',
  'state',
  'lga',
  'farmer_full_name',
  'gender',
  'phone',
  'nin',
  'date_of_birth',
  'farm_size_acres',
  'crop_type',
];
