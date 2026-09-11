-- เลขที่เอกสารแยกรันตามบริษัท: INS-2569/0001
-- รหัสบริษัทนำหน้าทำให้ doc_no ยังไม่ซ้ำทั้งระบบ จึงไม่ต้องรื้อ UNIQUE บน certificates

ALTER TABLE companies ADD COLUMN code TEXT;

-- ให้รหัสชั่วคราวทุกบริษัทก่อน ระบบจะได้ไม่พังระหว่างที่ผู้ใช้ยังไม่ได้ตั้งรหัสจริง
UPDATE companies SET code = 'C' || id;

-- ต้องไม่ซ้ำ "ทุกบริษัท" รวมที่ถูกลบไปแล้ว เพราะ doc_no ต้องไม่ซ้ำตลอดไป
CREATE UNIQUE INDEX idx_company_code ON companies(code);

-- เติมรหัสนำหน้าให้ใบเดิม -> ทุกใบอยู่ในรูปแบบเดียวกัน ไม่ต้องมีโค้ดรองรับของเก่า
UPDATE certificates
   SET doc_no = (SELECT code FROM companies WHERE id = certificates.company_id) || '-' || doc_no
 WHERE doc_no NOT LIKE '%-%';

-- counters เป็นตารางอนุมาน ทิ้งแล้วสร้างใหม่ได้ (ALTER PRIMARY KEY ไม่ได้อยู่แล้ว)
DROP TABLE counters;
CREATE TABLE counters (
  company_id INTEGER NOT NULL,
  year       INTEGER NOT NULL,
  last_no    INTEGER NOT NULL,
  PRIMARY KEY (company_id, year)     -- จำเป็นสำหรับ ON CONFLICT ใน src/index.js
);

-- seed จากใบที่มีอยู่จริง (ปีเอาจาก doc_date ไม่ใช่จาก doc_no -> ทนได้ทั้งสองรูปแบบ)
INSERT INTO counters (company_id, year, last_no)
SELECT company_id,
       CAST(substr(doc_date, 1, 4) AS INTEGER) + 543,
       MAX(CAST(substr(doc_no, instr(doc_no, '/') + 1) AS INTEGER))
  FROM certificates
 GROUP BY 1, 2;
