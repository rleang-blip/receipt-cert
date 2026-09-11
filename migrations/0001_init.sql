-- ใบรับรองแทนใบเสร็จรับเงิน — schema

CREATE TABLE companies (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  branch  TEXT,
  address TEXT,
  tax_id  TEXT,
  active  INTEGER NOT NULL DEFAULT 1
);

-- เลขที่เอกสารรันต่อปี พ.ศ.
-- PRIMARY KEY จำเป็นสำหรับ ON CONFLICT(year) ใน src/index.js
CREATE TABLE counters (
  year    INTEGER PRIMARY KEY,
  last_no INTEGER NOT NULL
);

CREATE TABLE certificates (
  id              INTEGER PRIMARY KEY,
  doc_no          TEXT NOT NULL UNIQUE,          -- 2569/0001
  company_id      INTEGER REFERENCES companies(id), -- ใช้กรองประวัติเท่านั้น ห้าม join ตอนพิมพ์

  -- snapshot ข้อมูลบริษัท ณ วันที่ออกใบ: แก้ที่อยู่บริษัทวันนี้ ใบเก่าต้องไม่เปลี่ยน
  company_name    TEXT,
  company_branch  TEXT,
  company_address TEXT,
  company_tax_id  TEXT,

  doc_date        TEXT NOT NULL,                 -- ISO 'YYYY-MM-DD' (ค.ศ.) แปลงเป็น พ.ศ. ตอนแสดง
  payer_name      TEXT NOT NULL,
  payer_position  TEXT,
  payee_name      TEXT NOT NULL,
  payee_address   TEXT,
  payee_idcard    TEXT,

  items_json      TEXT NOT NULL,                 -- [{desc, amount_satang}, ...]
  total_satang    INTEGER NOT NULL,              -- สตางค์ (จำนวนเต็ม) ห้ามใช้ float กับเงิน
  note            TEXT,
  created_at      TEXT NOT NULL                  -- ISO UTC
);

CREATE INDEX idx_cert_date    ON certificates(doc_date);
CREATE INDEX idx_cert_company ON certificates(company_id);
