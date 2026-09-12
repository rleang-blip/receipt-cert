-- ตำแหน่งผู้อนุมัติ (ไม่บังคับ เหมือน approver_name)
ALTER TABLE certificates ADD COLUMN approver_position TEXT;
