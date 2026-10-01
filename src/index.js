// ใบรับรองแทนใบเสร็จรับเงิน — Cloudflare Worker + D1
// ทุก path ที่ไม่ใช่ /api/* ส่งต่อให้ static assets

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const bad = (msg) => json({ error: msg }, 400);
const str = (v) => (v == null ? '' : String(v).trim());
// วันที่แบบไม่บังคับ — ว่างได้ แต่ถ้ามีต้องเป็น ISO ไม่งั้นเก็บเป็นค่าว่าง
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '');

const CODE_RE = /^[A-Z0-9]{2,10}$/;   // รหัสบริษัท: ตัวอักษรอังกฤษ/ตัวเลข 2-10 ตัว

// ตรวจรหัสบริษัท คืน { error } หรือ { code } ที่ normalize เป็นตัวใหญ่แล้ว
// excludeId = id ของบริษัทที่กำลังแก้ (ไม่นับว่าซ้ำกับตัวเอง)
async function checkCode(raw, DB, excludeId) {
  const code = str(raw).toUpperCase();
  if (!code) return { error: 'ต้องระบุรหัสบริษัท' };
  if (!CODE_RE.test(code))
    return { error: 'รหัสบริษัทต้องเป็นตัวอักษรอังกฤษหรือตัวเลข 2-10 ตัว (เช่น INS)' };
  // เช็คก่อน insert เพื่อให้ได้ข้อความไทย ไม่ใช่ปล่อยให้ UNIQUE index โยน error ดิบ
  // ซ้ำกับบริษัทที่ถูกลบไปแล้วก็ไม่ได้ เพราะใบเก่ายังอ้างรหัสนั้นอยู่
  const dup = await DB.prepare(`SELECT id FROM companies WHERE code=?1 AND id<>?2`)
    .bind(code, excludeId || 0).first();
  if (dup) return { error: `รหัส ${code} ถูกใช้กับบริษัทอื่นแล้ว` };
  return { code };
}

// field ที่ยอมให้ autocomplete ได้ — whitelist เพราะชื่อคอลัมน์ bind ไม่ได้
const NAME_FIELDS = {
  payer: 'payer_name',
  position: 'payer_position',
  payee: 'payee_name',
  approver: 'approver_name',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
  // cron ล้างถังขยะทุกวัน — กันเคสไม่มีคนเปิดแอปเลย 14 วัน (ปกติ GET ก็ purge แบบ lazy อยู่แล้ว)
  async scheduled(event, env) {
    await purgeExpired(env.DB);
  },
};

// ลบถาวรใบที่อยู่ในถังขยะครบ 14 วัน (deleted_at เก็บเป็น ISO UTC)
async function purgeExpired(DB) {
  await DB.prepare(
    `DELETE FROM certificates WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', '-14 days')`
  ).run();
}

async function api(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', resource, id, action]
  const [, resource, id, action] = parts;
  const q = url.searchParams;
  const DB = env.DB;
  const route = `${request.method} ${resource}${id ? '/:id' : ''}${action ? '/' + action : ''}`;

  switch (route) {
    /* ---------- บริษัท ---------- */

    case 'GET companies': {
      const { results } = await DB.prepare(
        `SELECT * FROM companies WHERE active = 1 AND name LIKE ?1 ORDER BY name LIMIT 200`
      ).bind(`%${q.get('q') || ''}%`).all();
      return json(results);
    }

    case 'POST companies': {
      const b = await request.json();
      if (!str(b.name)) return bad('ต้องระบุชื่อบริษัท');
      const c = await checkCode(b.code, DB);
      if (c.error) return bad(c.error);
      const row = await DB.prepare(
        `INSERT INTO companies (name, branch, address, tax_id, code)
         VALUES (?1,?2,?3,?4,?5) RETURNING *`
      ).bind(str(b.name), str(b.branch), str(b.address), str(b.tax_id), c.code).first();
      return json(row, 201);
    }

    case 'PUT companies/:id': {
      const b = await request.json();
      if (!str(b.name)) return bad('ต้องระบุชื่อบริษัท');
      const c = await checkCode(b.code, DB, +id);
      if (c.error) return bad(c.error);
      // แก้รหัสได้ ใบเก่าคงเลขเดิม (เป็น snapshot อยู่แล้ว) ใบใหม่ใช้รหัสใหม่
      const row = await DB.prepare(
        `UPDATE companies SET name=?2, branch=?3, address=?4, tax_id=?5, code=?6
         WHERE id=?1 AND active=1 RETURNING *`
      ).bind(+id, str(b.name), str(b.branch), str(b.address), str(b.tax_id), c.code).first();
      return row ? json(row) : bad('ไม่พบบริษัทนี้');
    }

    case 'DELETE companies/:id': {
      // soft delete — ใบเก่ายัง snapshot ข้อมูลไว้แล้ว แต่เก็บ row ไว้ให้ประวัติ join id ได้
      await DB.prepare(`UPDATE companies SET active=0 WHERE id=?1`).bind(+id).run();
      return json({ ok: true });
    }

    /* ---------- autocomplete ชื่อที่เคยใช้ ---------- */

    case 'GET names': {
      const col = NAME_FIELDS[q.get('field')];
      if (!col) return bad('field ไม่ถูกต้อง');
      const { results } = await DB.prepare(
        `SELECT DISTINCT ${col} AS v FROM certificates
         WHERE deleted_at IS NULL
           AND ${col} IS NOT NULL AND ${col} <> '' AND ${col} LIKE ?1
         ORDER BY v LIMIT 50`
      ).bind(`%${q.get('q') || ''}%`).all();
      return json(results.map((r) => r.v));
    }

    /* ---------- ใบรับรอง ---------- */

    case 'GET certificates': {
      // ล้างใบที่ค้างถังขยะครบ 14 วันแบบ lazy ทุกครั้งที่เปิดประวัติ/ถังขยะ
      // (มี cron scheduled() คอยล้างรายวันด้วย กันเคสไม่มีคนเปิดแอปเลย)
      await purgeExpired(DB);
      const search = str(q.get('q'));
      const companyId = +q.get('company_id') || 0;
      const from = str(q.get('from'));
      const to = str(q.get('to'));
      // แบ่งหน้า 10 รายการ/หน้า — ?trash=1 = ดูเฉพาะถังขยะ (เรียงตามวันที่ลบ) ไม่งั้นดูเฉพาะรายการปกติ
      const page = Math.max(1, parseInt(q.get('page'), 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(q.get('limit'), 10) || 10));
      const offset = (page - 1) * limit;
      const isTrash = q.get('trash') === '1';
      // สองค่านี้มาจาก boolean ภายในเท่านั้น ไม่ใช่ input ผู้ใช้โดยตรง — ต่อ string ลง SQL ได้ปลอดภัย
      const delCond = isTrash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
      const orderBy = isTrash ? 'deleted_at DESC' : 'id DESC';
      const cols = isTrash
        ? 'id, doc_no, doc_date, company_name, payer_name, payee_name, total_satang, updated_at, deleted_at'
        : 'id, doc_no, doc_date, company_name, payer_name, payee_name, total_satang, updated_at';
      const where =
        `${delCond}` +
        " AND (?1 = '' OR doc_no LIKE ?2 OR payer_name LIKE ?2 OR payee_name LIKE ?2)" +
        ' AND (?3 = 0  OR company_id = ?3)' +
        " AND (?4 = '' OR doc_date >= ?4)" +
        " AND (?5 = '' OR doc_date <= ?5)";
      const like = `%${search}%`;
      const cnt = await DB.prepare(
        `SELECT COUNT(*) AS n FROM certificates WHERE ${where}`
      ).bind(search, like, companyId, from, to).first();
      const total = (cnt && cnt.n) || 0;
      const { results } = await DB.prepare(
        `SELECT ${cols} FROM certificates WHERE ${where} ORDER BY ${orderBy} LIMIT ?6 OFFSET ?7`
      ).bind(search, like, companyId, from, to, limit, offset).all();
      return json({ items: results, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
    }

    case 'GET certificates/:id': {
      // คืนใบแม้จะอยู่ในถังขยะ เพื่อให้เปิดดู/ยืนยันก่อนกู้คืนหรือลบถาวรได้
      const row = await DB.prepare(`SELECT * FROM certificates WHERE id=?1`).bind(+id).first();
      return row ? json(row) : json({ error: 'ไม่พบใบนี้' }, 404);
    }

    case 'DELETE certificates/:id': {
      // ลบปกติ = ย้ายลงถังขยะ (soft delete) กู้คืนได้ใน 14 วัน
      // ?permanent=1 = ลบถาวรทันที (ใช้จากในถังขยะเท่านั้น)
      if (q.get('permanent') === '1') {
        await DB.prepare(`DELETE FROM certificates WHERE id=?1`).bind(+id).run();
        return json({ ok: true, permanent: true });
      }
      const now = new Date().toISOString();
      const row = await DB.prepare(
        `UPDATE certificates SET deleted_at=?2, updated_at=?2
         WHERE id=?1 AND deleted_at IS NULL RETURNING id, deleted_at`
      ).bind(+id, now).first();
      if (!row) {
        const exists = await DB.prepare(`SELECT id FROM certificates WHERE id=?1`).bind(+id).first();
        if (!exists) return json({ error: 'ไม่พบใบนี้' }, 404);
        return json({ ok: true, already: true });
      }
      return json({ ok: true, deleted_at: row.deleted_at });
    }

    case 'POST certificates/:id/restore': {
      // กู้คืนจากถังขยะ — ถ้าครบ 14 วัน purge จะลบไปแล้ว จะเจอ 404 กู้ไม่ได้
      await purgeExpired(DB);
      const row = await DB.prepare(
        `UPDATE certificates SET deleted_at=NULL WHERE id=?1 AND deleted_at IS NOT NULL RETURNING *`
      ).bind(+id).first();
      if (!row) {
        const exists = await DB.prepare(`SELECT id, deleted_at FROM certificates WHERE id=?1`).bind(+id).first();
        if (!exists) return json({ error: 'ไม่พบใบนี้ (อาจถูกลบถาวรหลังครบ 14 วันแล้ว)' }, 404);
        return bad('ใบนี้ไม่ได้อยู่ในถังขยะ');
      }
      return json(row);
    }

    case 'POST certificates':
      return createCertificate(await request.json(), DB);

    case 'PUT certificates/:id':
      return updateCertificate(+id, await request.json(), DB);
  }

  return json({ error: 'ไม่พบ endpoint นี้' }, 404);
}

// ตรวจข้อมูลใบรับรอง ใช้ร่วมกันทั้งตอนออกใหม่และตอนแก้ไข
// คืน { error } ถ้าไม่ผ่าน หรือ { fields } ถ้าผ่าน
function validateCertificate(b) {
  const doc_date = str(b.doc_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc_date)) return { error: 'วันที่ไม่ถูกต้อง' };

  const payer_name = str(b.payer_name);
  const payee_name = str(b.payee_name);
  if (!payer_name) return { error: 'ต้องระบุชื่อผู้จ่ายเงิน' };
  if (!payee_name) return { error: 'ต้องระบุชื่อผู้รับเงิน' };

  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return { error: 'ต้องมีรายการอย่างน้อย 1 รายการ' };

  // เงินเป็น integer สตางค์เท่านั้น และรวมยอดใหม่ฝั่ง server เสมอ ไม่เชื่อ total จาก client
  const clean = [];
  for (const it of items) {
    const desc = str(it.desc);
    const amount_satang = it.amount_satang;
    if (!desc) return { error: 'รายการต้องไม่ว่าง' };
    if (!Number.isInteger(amount_satang) || amount_satang <= 0)
      return { error: `จำนวนเงินของ "${desc}" ต้องเป็นตัวเลขมากกว่า 0` };
    clean.push({ desc, amount_satang });
  }

  return {
    doc_date, payer_name, payee_name,
    payer_position: str(b.payer_position),
    period_from: isoDate(b.period_from),
    period_to: isoDate(b.period_to),
    approver_name: str(b.approver_name),   // ไม่บังคับ เว้นว่างไว้เซ็นสดได้
    approver_position: str(b.approver_position),
    note: str(b.note),
    items_json: JSON.stringify(clean),
    total_satang: clean.reduce((s, it) => s + it.amount_satang, 0),
  };
}

async function createCertificate(b, DB) {
  const v = validateCertificate(b);
  if (v.error) return bad(v.error);

  const co = await DB.prepare(`SELECT * FROM companies WHERE id=?1 AND active=1`)
    .bind(+b.company_id || 0).first();
  if (!co) return bad('ไม่พบบริษัทที่เลือก');

  // ปี พ.ศ. เอาจากวันที่ที่ผู้ใช้เลือก ไม่ใช่นาฬิกา Worker (Worker รันเป็น UTC)
  const year = Number(v.doc_date.slice(0, 4)) + 543;

  // จองเลขที่ด้วย statement เดียวที่ atomic — D1 ไม่มี interactive transaction
  // ponytail: การจอง counter กับ INSERT เป็นคนละ round trip (batch() ส่ง RETURNING ต่อกันไม่ได้)
  // ถ้า INSERT พลาดจะเหลือเลขว่างหนึ่งเลข ยอมรับได้ ระบบเอกสารทั่วไปก็เป็นแบบนี้
  const c = await DB.prepare(
    `INSERT INTO counters (company_id, year, last_no) VALUES (?1, ?2, 1)
     ON CONFLICT(company_id, year) DO UPDATE SET last_no = last_no + 1
     RETURNING last_no`
  ).bind(co.id, year).first();
  const doc_no = `${co.code}-${year}/${String(c.last_no).padStart(4, '0')}`;

  const row = await DB.prepare(
    `INSERT INTO certificates (
       doc_no, company_id, company_name, company_branch, company_address, company_tax_id,
       doc_date, payer_name, payer_position, payee_name, period_from, period_to,
       approver_name, approver_position, items_json, total_satang, note, created_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18) RETURNING *`
  ).bind(
    doc_no, co.id, co.name, co.branch, co.address, co.tax_id,
    v.doc_date, v.payer_name, v.payer_position, v.payee_name, v.period_from, v.period_to,
    v.approver_name, v.approver_position, v.items_json, v.total_satang, v.note,
    new Date().toISOString()
  ).first();

  return json(row, 201);
}

async function updateCertificate(id, b, DB) {
  const existing = await DB.prepare(`SELECT * FROM certificates WHERE id=?1`).bind(id).first();
  if (!existing) return json({ error: 'ไม่พบใบนี้' }, 404);
  if (existing.deleted_at) return json({ error: 'ใบนี้อยู่ในถังขยะ กรุณากู้คืนก่อนแก้ไข' }, 400);

  const v = validateCertificate(b);
  if (v.error) return bad(v.error);

  // เปลี่ยนบริษัทได้ -> snapshot ใหม่จากบริษัทที่เลือก
  // ถ้าเป็นบริษัทเดิมที่ถูกลบไปแล้ว -> คง snapshot เดิมไว้ ยังแก้ใบได้
  // (ต้องรู้บริษัทก่อน เพราะเลขที่เอกสารต้องขึ้นต้นด้วยรหัสของบริษัทนี้)
  const co = await DB.prepare(`SELECT * FROM companies WHERE id=?1 AND active=1`)
    .bind(+b.company_id || 0).first();
  const snap = co
    ? { id: co.id, name: co.name, branch: co.branch, address: co.address, tax_id: co.tax_id,
        code: co.code }
    : (+b.company_id === existing.company_id
        ? { id: existing.company_id, name: existing.company_name, branch: existing.company_branch,
            address: existing.company_address, tax_id: existing.company_tax_id,
            // บริษัทถูกลบไปแล้ว -> เอารหัสจากเลขที่ใบเดิม
            code: (existing.doc_no.split('-')[0] || '') }
        : null);
  if (!snap) return bad('ไม่พบบริษัทที่เลือก');

  // เลขที่เอกสาร: แก้ได้ แต่ต้องอยู่ในรูป <รหัสบริษัท>-<ปี พ.ศ.>/<ลำดับ>
  // รหัสต้องตรงกับบริษัทในใบ และปีต้องตรงกับวันที่ในใบ ไม่งั้นเอกสารจะขัดกันเอง
  const year = Number(v.doc_date.slice(0, 4)) + 543;
  let doc_no = str(b.doc_no).toUpperCase() || existing.doc_no;
  const m = /^([A-Z0-9]{2,10})-(\d{4})\/(\d{1,6})$/.exec(doc_no);
  if (!m) return bad(`เลขที่เอกสารต้องอยู่ในรูป ${snap.code || 'INS'}-${year}/0001`);
  const seq = Number(m[3]);
  if (seq < 1) return bad('ลำดับในเลขที่เอกสารต้องมากกว่า 0');
  doc_no = `${m[1]}-${m[2]}/${String(seq).padStart(4, '0')}`;   // ปรับให้เป็นรูปแบบมาตรฐาน

  if (m[1] !== snap.code)
    return bad(`เลขที่ ${doc_no} ขึ้นต้นด้วยรหัส ${m[1]} แต่ใบนี้เป็นของบริษัท ${snap.name} ` +
               `(รหัส ${snap.code}) ต้องแก้เลขที่ให้ขึ้นต้นด้วย ${snap.code}-`);

  if (Number(m[2]) !== year)
    return bad(`เลขที่ ${doc_no} เป็นปี พ.ศ. ${m[2]} แต่วันที่ในใบเป็นปี พ.ศ. ${year} ` +
               `ต้องแก้ให้ตรงกัน`);

  if (doc_no !== existing.doc_no) {
    const dup = await DB.prepare(`SELECT id FROM certificates WHERE doc_no=?1 AND id<>?2`)
      .bind(doc_no, id).first();
    if (dup) return bad(`เลขที่ ${doc_no} ถูกใช้ไปแล้วในใบอื่น`);

    // ดันเลขรันของ "บริษัทนี้ ปีนี้" ให้สูงกว่าเลขที่เพิ่งตั้งเอง
    // ไม่งั้นใบถัดไปของบริษัทนี้จะชนกับใบนี้ (บริษัทอื่นไม่กระทบ)
    await DB.prepare(
      `INSERT INTO counters (company_id, year, last_no) VALUES (?1, ?2, ?3)
       ON CONFLICT(company_id, year) DO UPDATE SET last_no = MAX(last_no, ?3)`
    ).bind(snap.id, year, seq).run();
  }

  // created_at ไม่แตะ — วันที่ออกใบครั้งแรกต้องคงเดิมเสมอ
  const row = await DB.prepare(
    `UPDATE certificates SET
       doc_no=?18,
       company_id=?2, company_name=?3, company_branch=?4, company_address=?5, company_tax_id=?6,
       doc_date=?7, payer_name=?8, payer_position=?9, payee_name=?10, period_from=?11,
       period_to=?12, approver_name=?13, items_json=?14, total_satang=?15, note=?16,
       updated_at=?17, approver_position=?19
     WHERE id=?1 RETURNING *`
  ).bind(
    id, snap.id, snap.name, snap.branch, snap.address, snap.tax_id,
    v.doc_date, v.payer_name, v.payer_position, v.payee_name, v.period_from, v.period_to,
    v.approver_name, v.items_json, v.total_satang, v.note, new Date().toISOString(),
    doc_no, v.approver_position
  ).first();

  return json(row);
}
