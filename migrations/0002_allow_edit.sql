-- เปิดให้แก้ไขใบที่ออกไปแล้ว: เก็บเวลาแก้ไขล่าสุดไว้เป็นร่องรอย
-- (เลขที่และปี พ.ศ. ยังล็อกอยู่ ดู updateCertificate ใน src/index.js)
ALTER TABLE certificates ADD COLUMN updated_at TEXT;
