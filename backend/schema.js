// Sheet tabs and columns (CLAUDE.md section 6, docs/PLAN.md section 3). setup() creates them in this order.
const SCHEMA = {
  Settings: ['key', 'value'],
  Locations: ['location_id', 'name', 'type', 'active'],
  Items: ['item_id', 'name', 'category', 'unit', 'sort_order', 'active', 'photo_version', 'created_at', 'updated_at'],
  Photos: ['item_id', 'photo_version', 'data'],
  Barcodes: ['code', 'item_id', 'added_by', 'added_at'],
  UnknownBarcodes: ['code', 'location_id', 'first_seen', 'last_seen', 'times_seen'],
  Thresholds: ['item_id', 'location_id', 'threshold', 'reorder_qty'],
  Stock: ['item_id', 'location_id', 'on_hand', 'updated_at'],
  Transactions: [
    'txn_id', 'occurred_at', 'recorded_at', 'location_id', 'type', 'item_id', 'quantity',
    'visit_id', 'batch_id', 'staff_email', 'reason', 'flag', 'source_device', 'app_version',
  ],
  Visits: [
    'visit_id', 'occurred_at', 'recorded_at', 'location_id', 'student_key', 'line_count',
    'flagged', 'unverified_student', 'source', 'device_id', 'app_version', 'voided',
  ],
  Batches: ['batch_id', 'type', 'created_at', 'location_id', 'to_location_id', 'staff_email', 'donor_source', 'delivery_date', 'note'],
  ArchiveTotals: ['item_id', 'location_id', 'archived_sum', 'archived_through'],
  Students: [
    'student_key', 'student_id', 'name', 'faculty_code', 'source',
    'consent_at', 'first_visit_at', 'last_visit_at', 'visit_count',
  ],
  Faculties: ['faculty_code', 'name_ms', 'name_en', 'active'],
  Staff: ['email', 'name', 'role', 'receives_alerts', 'active'],
  Devices: ['device_id', 'label', 'location_id', 'key_hash', 'created_by', 'created_at', 'last_seen', 'revoked'],
  AlertLog: ['date', 'location_id', 'item_id', 'alert_type', 'sent_at'],
  AuditLog: ['at', 'staff_email', 'action', 'detail'],
};

// Stored as plain text so Sheets keeps leading zeros and never shows long numbers as 9.55E+12.
const TEXT_COLUMNS = [
  'key', 'value', 'location_id', 'to_location_id', 'item_id', 'code', 'txn_id', 'visit_id', 'batch_id',
  'student_key', 'student_id', 'faculty_code', 'device_id', 'key_hash', 'date',
];

// History and personal data: only the owner can edit these tabs directly. Staff use the staff pages.
const LOCKED_TABS = [
  'Transactions', 'Visits', 'Batches', 'Stock', 'ArchiveTotals', 'Students',
  'Photos', 'Devices', 'AlertLog', 'AuditLog',
];
