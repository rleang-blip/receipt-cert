-- ถังขยะใบรับรอง: ลบ = ตั้ง deleted_at, กู้คืน = เคลียร์, ครบ 14 วัน = ลบถาวร
-- รายการปกติคือ deleted_at IS NULL, ถังขยะคือ deleted_at IS NOT NULL
ALTER TABLE certificates ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_cert_deleted ON certificates(deleted_at);
