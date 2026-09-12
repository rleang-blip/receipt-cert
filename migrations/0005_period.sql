-- ช่วงเวลาที่จ่ายจริง (ไม่บังคับ) — ใช้ในข้อความรับรองท้ายเอกสาร
-- payee_address / payee_idcard เลิกใช้แล้ว แต่ไม่ drop — ใบเก่าต้องคงข้อมูลเดิมไว้
ALTER TABLE certificates ADD COLUMN period_from TEXT;   -- ISO 'YYYY-MM-DD'
ALTER TABLE certificates ADD COLUMN period_to   TEXT;
