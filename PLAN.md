# ใบรับรองแทนใบเสร็จรับเงิน — Cloudflare Workers + D1

## Context

ต้องออก "ใบรับรองแทนใบเสร็จรับเงิน" (เอกสารที่ใช้เมื่อจ่ายเงินให้ผู้รับที่ออกใบเสร็จไม่ได้ เช่น
แม่ค้า วินมอเตอร์ไซค์ ค่าทางด่วน) ปัจจุบันยังไม่มีระบบ ต้องพิมพ์เอกสารด้วยมือทุกครั้ง

ที่ต้องการ:
- รองรับหลายบริษัท (10+) เลือก/ค้นหาบริษัทได้
- กรอกชื่อผู้จ่ายเงิน / ผู้รับเงินได้เอง และเลือกจากที่เคยใช้ได้
- หลายคนหลายเครื่องใช้ข้อมูลชุดเดียวกัน
- เก็บประวัติใบที่ออก ค้นย้อนหลังได้
- พิมพ์ออกกระดาษ A4 / เซฟ PDF
- **Deploy บน Cloudflare 100%** — มีโดเมนใน Cloudflare อยู่แล้ว

โฟลเดอร์โปรเจกต์ว่างเปล่า สร้างใหม่ทั้งหมด

## Stack

**Cloudflare Workers + D1 + Static Assets** — ทุกอย่างอยู่บน Cloudflare ไม่มีบริการนอก

| ส่วน | ใช้อะไร | ทำไม |
|---|---|---|
| Hosting + API | Workers | โค้ดไฟล์เดียว ไม่ต้องมี server |
| ไฟล์ static | Workers Static Assets (`env.ASSETS`) | ในตัว ไม่ต้องใช้ Pages แยก |
| ฐานข้อมูล | D1 (SQLite ของ Cloudflare) | SQL ตรงๆ free tier 5M reads / 100k writes ต่อวัน เกินพอ |
| Login | Cloudflare Access (Zero Trust) | ไม่ต้องเขียนโค้ด auth เลย ตั้งใน dashboard ฟรีถึง 50 คน |
| PDF | `window.print()` ของเบราว์เซอร์ | ไม่ต้องมี library |

- **ไม่ใช้ React/Vite/framework** — ฟอร์ม + ตาราง + พิมพ์ HTML ธรรมดาพอ ไม่มี build step
- **ไม่ใช้ Hono/router library** — 8 routes เขียน routing เองประมาณ 15 บรรทัด
- **ไม่ใช้ ORM** — `env.DB.prepare(...).bind(...)` ตรงๆ
- dependency เดียวคือ `wrangler` (dev only)

## ไฟล์ (8 ไฟล์)

```
wrangler.jsonc            config: D1 binding, ASSETS binding, custom domain route
package.json              มีแค่ devDependency wrangler + scripts
src/index.js              Worker: routing + API + validation
migrations/0001_init.sql  schema (D1 ใช้ migration ไม่มี "สร้างตอน boot")
public/index.html         ทั้ง UI: ออกใบ + preview พิมพ์ + จัดการบริษัท + ประวัติ
public/baht.js            แปลงตัวเลข -> คำอ่านไทย (แยกไฟล์เพื่อให้เทสต์ได้)
public/test_baht.html     เปิดในเบราว์เซอร์ -> รัน assert โชว์ PASS/FAIL
README.md                 วิธี dev / migrate / deploy / ตั้ง Access
```

## Worker entry (`src/index.js`)

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    // ...routing ต่อจากนี้
  }
}
```

ทุกอย่างที่ไม่ใช่ `/api/*` ส่งต่อให้ `env.ASSETS` — ไม่ต้องตั้ง `run_worker_first`
ไม่ต้องแคร์เวอร์ชัน wrangler

Routing: `const [, , resource, id] = url.pathname.split('/')` แล้ว switch บน
`` `${request.method} ${resource}` `` — พอสำหรับ 8 routes ไม่ต้องลง router library

## Database (D1, `migrations/0001_init.sql`)

```sql
CREATE TABLE companies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, branch TEXT,
  address TEXT, tax_id TEXT, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE counters (
  year INTEGER PRIMARY KEY,      -- พ.ศ. — PRIMARY KEY จำเป็นสำหรับ ON CONFLICT
  last_no INTEGER NOT NULL
);

CREATE TABLE certificates (
  id INTEGER PRIMARY KEY,
  doc_no TEXT NOT NULL UNIQUE,     -- 2569/0001
  company_id INTEGER REFERENCES companies(id),  -- ใช้กรองประวัติเท่านั้น ไม่ใช้ตอนพิมพ์
  -- snapshot ข้อมูลบริษัท ณ วันที่ออกใบ
  company_name TEXT, company_branch TEXT, company_address TEXT, company_tax_id TEXT,
  doc_date TEXT NOT NULL,          -- ISO 'YYYY-MM-DD' เก็บ ค.ศ. แปลงเป็น พ.ศ. ตอนแสดง
  payer_name TEXT NOT NULL, payer_position TEXT,
  payee_name TEXT NOT NULL, payee_address TEXT, payee_idcard TEXT,
  items_json TEXT NOT NULL,        -- [{desc, amount_satang}, ...]
  total_satang INTEGER NOT NULL,   -- สตางค์ (จำนวนเต็ม) ไม่ใช้ float กับเงิน
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cert_date ON certificates(doc_date);
CREATE INDEX idx_cert_company ON certificates(company_id);
```

### สามจุดที่ห้ามพลาด

**1. snapshot ไม่ใช่ FK** — ตอนพิมพ์/พิมพ์ซ้ำใช้ `company_*` ที่ snapshot ไว้เสมอ
ห้าม join กลับไป `companies` มิฉะนั้นแก้ที่อยู่บริษัทวันนี้แล้วพิมพ์ใบเก่าซ้ำ เอกสารจะเปลี่ยนไป
จากตอนที่ออกจริง — ผิดหลักเอกสารภาษี (payer/payee เก็บเป็น text ด้วยเหตุผลเดียวกัน)

**2. เลขที่รันด้วย counter ไม่ใช่ `MAX+1`** — D1 ไม่มี interactive transaction
`MAX(doc_no)+1` แล้วค่อย INSERT จะชนกันเมื่อสองคนกดพร้อมกัน ใช้ statement เดียวที่ atomic:

```sql
INSERT INTO counters(year, last_no) VALUES(?1, 1)
ON CONFLICT(year) DO UPDATE SET last_no = last_no + 1
RETURNING last_no;
```

แล้วค่อย INSERT certificate เป็น round trip ที่สอง
`// ponytail: จอง counter กับ insert เป็นคนละ round trip (batch() ส่ง RETURNING ต่อกันไม่ได้)
// ถ้า insert พลาดจะเหลือเลขว่างหนึ่งเลข — ยอมรับได้ ระบบเอกสารทั่วไปก็เป็นแบบนี้`

**ปี พ.ศ. ต้องเอามาจาก `doc_date` ที่ผู้ใช้เลือก ไม่ใช่นาฬิกา server** — Worker รันเป็น UTC
ถ้าใช้เวลา server ใบที่ออกช่วงเช้าวันที่ 1 ม.ค. ตามเวลาไทยจะได้ปีเก่า

**3. เงินเป็น INTEGER สตางค์เสมอ** — client แปลง `Math.round(amount * 100)` ก่อนส่ง
server แปลง/ตรวจซ้ำและรวมยอดเองด้วย integer ไม่เชื่อ `total` จาก client

## API (`src/index.js`)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/companies?q=` | บริษัท `active=1` กรอง `name LIKE ?` |
| POST | `/api/companies` | เพิ่ม |
| PUT | `/api/companies/:id` | แก้ไข |
| DELETE | `/api/companies/:id` | soft delete (`active=0`) — ใบเก่ายังอ้างถึงได้ |
| GET | `/api/names?field=payer\|payee&q=` | ชื่อที่เคยใช้ (DISTINCT) สำหรับ autocomplete |
| GET | `/api/certificates?q=&company_id=&from=&to=` | ค้นประวัติ (doc_no, payer, payee) |
| POST | `/api/certificates` | บันทึกใบใหม่ คืน `doc_no` |
| GET | `/api/certificates/:id` | ดึงใบเดิมมาพิมพ์ซ้ำ |

Validation ฝั่ง server (ห้ามข้าม เป็นเอกสารการเงิน):
- `company_id` ต้องมีอยู่จริงและ `active=1`
- `payer_name` / `payee_name` ต้องไม่ว่าง
- `items` อย่างน้อย 1 รายการ ทุก `amount_satang` ต้องเป็น integer > 0
- `total_satang` คำนวณใหม่ฝั่ง server จาก items เสมอ
- `doc_date` ต้องตรงรูปแบบ `YYYY-MM-DD`
- ใช้ `.bind()` ทุกจุด (รวม `LIKE` — ส่ง `%q%` เป็น parameter ไม่ต่อ string)
- ตอบ 400 พร้อมข้อความไทยเมื่อไม่ผ่าน

## Auth — Cloudflare Access (โค้ด 0 บรรทัด)

1. ผูก Worker กับ subdomain ในโดเมนที่มี (เช่น `receipt.<domain>`) ใน `wrangler.jsonc`
   → `routes: [{ pattern: "receipt.<domain>", custom_domain: true }]`
2. Zero Trust → Access → Applications → Self-hosted → ใส่ hostname นั้น
3. Policy: Allow → Emails ending in `@<domain ของบริษัท>` (หรือลิสต์อีเมลตรงๆ)

Cloudflare Access ใช้กับ `*.workers.dev` ไม่ได้ — ต้องเป็น hostname ในโซนที่เราคุม
ดังนั้น **ปิด `workers_dev`** ใน `wrangler.jsonc` (`"workers_dev": false`) ไม่งั้นจะมี URL
ที่เข้าได้โดยไม่ผ่าน Access

## UI (`public/index.html`) — 3 แท็บ

**1. ออกใบใหม่** (หน้าหลัก)
- เลือกบริษัท: `<input list>` + `<datalist>` จาก `/api/companies` → พิมพ์กรองได้ทันที
- วันที่: `<input type="date">` (native) แสดงเป็น พ.ศ. ในเอกสาร ค่าเริ่มต้น = วันนี้
- ผู้จ่ายเงิน / ตำแหน่ง / ผู้รับเงิน / ที่อยู่ / เลขบัตรประชาชน: `<input list>` + `<datalist>`
  จาก `/api/names` → **พิมพ์เองก็ได้ เลือกจากที่เคยใช้ก็ได้** (ตอบทั้ง "กรอง" และ "กรอก")
- ตารางรายการ: แถวละ `รายการ` + `จำนวนเงิน` ปุ่ม + เพิ่มแถว
- รวมเงิน + ตัวอักษร คำนวณสดขณะพิมพ์
- ปุ่ม `บันทึกและพิมพ์` → POST สำเร็จ (ได้ `doc_no` กลับ) → `window.print()`

**2. บริษัท** — ตาราง + ช่องค้นหา + เพิ่ม/แก้ไข/ลบ

**3. ประวัติ** — ช่องค้นหา + กรองบริษัท + ช่วงวันที่ → ตาราง → คลิกแถวเพื่อดู/พิมพ์ซ้ำ

## เลย์เอาต์เอกสาร (แบบมาตรฐานทั่วไป)

```
            ใบรับรองแทนใบเสร็จรับเงิน
                                        เลขที่ 2569/0001
  ชื่อบริษัท / สาขา / ที่อยู่ / เลขประจำตัวผู้เสียภาษี
                                        วันที่ ___ เดือน _____ พ.ศ. ____

  ข้าพเจ้า _______________ ตำแหน่ง _______________
  ขอรับรองว่า รายจ่ายต่อไปนี้ไม่อาจเรียกใบเสร็จรับเงินจากผู้รับได้
  จ่ายให้ (ผู้รับเงิน) ______________ ที่อยู่ ______________
  เลขบัตรประชาชน ______________

  ┌────┬──────────────────────────┬──────────────┐
  │ ที่ │ รายการ                    │ จำนวนเงิน     │
  ├────┼──────────────────────────┼──────────────┤
  └────┴──────────────────────────┴──────────────┘
                              รวมเป็นเงิน  x,xxx.xx
  (หนึ่งพันสองร้อยบาทถ้วน)

  ลงชื่อ __________ ผู้จ่ายเงิน    ลงชื่อ __________ ผู้อนุมัติ
```

Print CSS:
- `@page { size: A4; margin: 15mm }`
- `@media print` ซ่อนแท็บ/ปุ่ม/ช่องกรอก เหลือแต่ตัวเอกสาร
- ฟอนต์ `'Sarabun', 'TH Sarabun New', 'Noto Sans Thai', sans-serif` โหลดจาก Google Fonts
  (fallback ฟอนต์ระบบ) — เป็นฟอนต์มาตรฐานเอกสารราชการไทย
- ⚠️ เบราว์เซอร์แทรก URL/วันที่ที่หัว-ท้ายกระดาษเอง ผู้ใช้ต้องติ๊กออก "Headers and footers"
  ในหน้าต่างพิมพ์ครั้งแรก (เบราว์เซอร์จำค่าให้เอง) — เขียนไว้ใน README

## ตรรกะจริงจุดเดียว: `public/baht.js` → `bahtText(satang)`

จุดที่พังง่ายสุดในแอปนี้ ต้องมีเทสต์ (รับเป็น**สตางค์** integer ไม่รับ float):

| input (สตางค์) | expected |
|---|---|
| `100` | หนึ่งบาทถ้วน |
| `1100` | สิบเอ็ดบาทถ้วน |
| `2100` | ยี่สิบเอ็ดบาทถ้วน |
| `10100` | หนึ่งร้อยเอ็ดบาทถ้วน (ไม่ใช่ "หนึ่งร้อยหนึ่ง" — เคสที่ logic ง่ายๆ พลาดบ่อยสุด) |
| `100000000` | หนึ่งล้านบาทถ้วน |
| `100000100` | หนึ่งล้านเอ็ดบาทถ้วน |
| `12345678900` | หนึ่งร้อยยี่สิบสามล้านสี่แสนห้าหมื่นหกพันเจ็ดร้อยแปดสิบเก้าบาทถ้วน |
| `120050` | หนึ่งพันสองร้อยบาทห้าสิบสตางค์ |
| `0` | ศูนย์บาทถ้วน |

`public/test_baht.html` = `<script src="baht.js">` + assert 9 เคสข้างบน แสดง PASS/FAIL
เปิดไฟล์ในเบราว์เซอร์ตรงๆ ได้ ไม่ต้องมี test framework

## สิ่งที่ตัดออก (และเมื่อไหร่ค่อยเพิ่ม)

- ไม่มีระบบสิทธิ์ผู้ใช้ในแอป — Access คุมว่าใครเข้าได้ ทุกคนที่เข้าได้ทำได้ทุกอย่าง
  `ponytail: ถ้าต้องรู้ว่าใครออกใบไหน อ่าน header Cf-Access-Authenticated-User-Email
  เก็บลง certificates.created_by — เพิ่มทีหลังได้ไม่กระทบของเดิม`
- ไม่มีอัปโหลดโลโก้บริษัท — เพิ่มเมื่อขอ (ถ้าเพิ่มค่อยใช้ R2)
- ไม่มี export Excel — ค้นในหน้าเว็บได้แล้ว เพิ่มเมื่อบัญชีขอไฟล์
- ไม่มีแก้ไขใบที่ออกไปแล้ว — เอกสารการเงินควรออกใบใหม่แทน (ลบได้อย่างเดียวถ้าออกผิด)
- ไม่มี pagination ในหน้าประวัติ — `LIMIT 200` พอ
  `ponytail: LIMIT 200 ถ้าใบเกินพันค่อยใส่ pagination`

## Verify

**Local**
1. `npm i` → `npx wrangler d1 create receipt-db` → ใส่ `database_id` ใน `wrangler.jsonc`
2. `npx wrangler d1 migrations apply receipt-db --local`
3. `npx wrangler dev` → เปิด `http://localhost:8787`
4. เปิด `http://localhost:8787/test_baht.html` → ต้อง PASS ครบ 9 เคส
5. เพิ่มบริษัท 2-3 บริษัท → พิมพ์บางส่วนของชื่อในช่องเลือกบริษัท ต้องกรองถูก
6. ออกใบ 1 ใบ (2 รายการ) → ยอดรวม + ตัวอักษรตรงกัน → บันทึกและพิมพ์
   → Print preview ต้องได้ A4 หน้าเดียว ไม่มีปุ่ม/แท็บติดมา
7. **ทดสอบ snapshot:** ออกใบให้บริษัท A → แก้ที่อยู่ A ในแท็บบริษัท → พิมพ์ใบเดิมซ้ำ
   → ต้องเห็น**ที่อยู่เดิม** ไม่ใช่ที่อยู่ใหม่
8. **ทดสอบเงิน:** ออกใบ 3 รายการ `0.07 + 0.01 + 1200.50` → ยอดต้องเป็น `1200.58` เป๊ะ
   และคำอ่านตรงกับตัวเลข
9. **ทดสอบ validation:** `curl -X POST` ที่ `amount` ติดลบ / `items` ว่าง / `company_id` มั่ว
   → ต้องได้ 400 ไม่ใช่บันทึกผ่าน
10. **ทดสอบเลขที่:** ยิง POST พร้อมกัน 5 request (`curl ... &`) → ต้องได้ `doc_no`
    ไม่ซ้ำกัน 5 เลข

**Production**
11. `npx wrangler d1 migrations apply receipt-db --remote` → `npx wrangler deploy`
12. ตั้ง Access ตามหัวข้อด้านบน → เปิด `https://receipt.<domain>` จากหน้าต่าง incognito
    → **ต้องเจอหน้า login ของ Cloudflare ก่อน** ไม่ใช่เข้าถึงแอปได้เลย
13. ลองเข้า `https://<worker>.<subdomain>.workers.dev` → ต้องเข้าไม่ได้ (ปิดไปแล้ว)
14. เปิดจาก 2 เครื่อง ออกใบสลับกัน → เห็นข้อมูลชุดเดียวกัน เลขที่ไม่ชน
