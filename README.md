# ใบรับรองแทนใบเสร็จรับเงิน

เว็บแอปออกใบรับรองแทนใบเสร็จรับเงิน รองรับหลายบริษัท เก็บประวัติ ค้นย้อนหลัง พิมพ์ A4 / เซฟ PDF
รันบน Cloudflare 100% (Workers + D1 + Static Assets + Access)

## ติดตั้งครั้งแรก

```bash
npm install

# 1) สร้างฐานข้อมูล แล้วเอา database_id ที่ได้ไปใส่ใน wrangler.jsonc
npx wrangler d1 create receipt-db

# 2) สร้างตาราง (local สำหรับทดสอบ)
npm run db:local

# 3) รันทดสอบในเครื่อง
npm run dev          # -> http://localhost:8787
```

เปิด http://localhost:8787/test_baht เพื่อเช็คว่าคำอ่านจำนวนเงินถูกต้องครบ 9 เคส

## Deploy

แก้ `wrangler.jsonc` 2 จุดก่อน:

- `database_id` — จากขั้นตอนที่ 1
- `routes[0].pattern` — เปลี่ยน `receipt.example.com` เป็น subdomain จริงในโดเมนที่อยู่ใน Cloudflare

```bash
npm run db:remote    # สร้างตารางบน production
npm run deploy
```

## ตั้ง login (Cloudflare Access)

**ต้องทำ** — แอปนี้เก็บข้อมูลการเงินของบริษัทและเปิดอยู่บนอินเทอร์เน็ต

1. Cloudflare Dashboard → Zero Trust → Access → Applications → **Add an application** → Self-hosted
2. Application domain = `receipt.<โดเมนของคุณ>` (ต้องตรงกับ `routes` ใน `wrangler.jsonc`)
3. Policy: **Allow** → Include → *Emails ending in* `@<โดเมนบริษัท>` (หรือใส่อีเมลทีละคน)

ฟรีถึง 50 ผู้ใช้ ไม่ต้องเขียนโค้ด auth ในแอปเลย

`workers_dev` และ `preview_urls` ถูกตั้งเป็น `false` ไว้แล้วทั้งคู่ เพราะ Access ผูกกับ hostname
ใน `routes` เท่านั้น ครอบ `*.workers.dev` ไม่ได้ ถ้าเปิดไว้จะมีทางเข้าถึงข้อมูลการเงินโดยไม่ผ่าน login
(`preview_urls` คือ URL แบบ `<version>-receipt-cert.<subdomain>.workers.dev` ที่ Cloudflare
สร้างให้อัตโนมัติทุกครั้งที่ deploy — ต้องปิดแยกจาก `workers_dev`)

**หลัง deploy ครั้งแรก ให้เช็คใน Dashboard → Workers → receipt-cert → Settings → Domains & Routes
ว่าไม่มี workers.dev URL เหลืออยู่**

## วิธีใช้

- **ออกใบใหม่** — พิมพ์บางส่วนของชื่อบริษัทเพื่อกรอง ช่องผู้จ่ายเงิน/ผู้รับเงินพิมพ์เองได้
  หรือเลือกจากชื่อที่เคยใช้ เอกสารด้านล่างอัปเดตสดขณะพิมพ์ กด **บันทึกและพิมพ์**
- **บริษัท** — เพิ่ม/แก้ไข/ลบ (ลบเป็น soft delete ใบเก่ายังพิมพ์ซ้ำได้ครบ)
- **ประวัติ** — ค้นด้วยเลขที่ / ชื่อผู้จ่าย / ชื่อผู้รับ กรองบริษัทและช่วงวันที่ คลิกแถวเพื่อพิมพ์ซ้ำ

### ⚠️ ครั้งแรกที่พิมพ์

ในหน้าต่าง Print ของเบราว์เซอร์ ให้ **ติ๊กออก "Headers and footers"**
ไม่งั้นจะมี URL และวันที่ของเบราว์เซอร์ติดหัว-ท้ายกระดาษ (เบราว์เซอร์จำค่าให้ครั้งต่อไป)

## หมายเหตุการออกแบบ

- **ข้อมูลบริษัทถูก snapshot ลงในใบ** ตอนบันทึก แก้ที่อยู่บริษัทวันนี้ ใบเก่าที่พิมพ์ซ้ำยังเป็นข้อมูลเดิม
  (ถูกต้องตามหลักเอกสารภาษี)
- **จำนวนเงินเก็บเป็นสตางค์ (integer)** ทั้งระบบ ไม่ใช้ float
- **เลขที่เอกสาร** รันต่อปี พ.ศ. โดยเอาปีจากวันที่ที่ผู้ใช้เลือก ไม่ใช่นาฬิกาเซิร์ฟเวอร์ (Worker รันเป็น UTC)
- **แก้ไขใบที่ออกแล้วไม่ได้** ออกใบใหม่หรือลบทิ้งอย่างเดียว
