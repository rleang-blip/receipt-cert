// ใบรับรองแทนใบเสร็จรับเงิน — Cloudflare Worker + D1
// ทุก path ที่ไม่ใช่ /api/* ส่งต่อให้ static assets

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const bad = (msg) => json({ error: msg }, 400);
const str = (v) => (v == null ? '' : String(v).trim());

// field ที่ยอมให้ autocomplete ได้ — whitelist เพราะชื่อคอลัมน์ bind ไม่ได้
const NAME_FIELDS = {
  payer: 'payer_name',
  position: 'payer_position',
  payee: 'payee_name',
  payee_address: 'payee_address',
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
};

async function api(request, env, url) {
  const [, resource, id] = url.pathname.split('/').filter(Boolean);
  const q = url.searchParams;
  const DB = env.DB;
  const route = `${request.method} ${resource}${id ? '/:id' : ''}`;

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
      const row = await DB.prepare(
        `INSERT INTO companies (name, branch, address, tax_id) VALUES (?1,?2,?3,?4) RETURNING *`
      ).bind(str(b.name), str(b.branch), str(b.address), str(b.tax_id)).first();
      return json(row, 201);
    }

    case 'PUT companies/:id': {
      const b = await request.json();
      if (!str(b.name)) return bad('ต้องระบุชื่อบริษัท');
      const row = await DB.prepare(
        `UPDATE companies SET name=?2, branch=?3, address=?4, tax_id=?5
         WHERE id=?1 AND active=1 RETURNING *`
      ).bind(+id, str(b.name), str(b.branch), str(b.address), str(b.tax_id)).first();
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
         WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} LIKE ?1
         ORDER BY v LIMIT 50`
      ).bind(`%${q.get('q') || ''}%`).all();
      return json(results.map((r) => r.v));
    }

    /* ---------- ใบรับรอง ---------- */

    case 'GET certificates': {
      const search = str(q.get('q'));
      // ponytail: LIMIT 200 ถ้าใบเกินพันค่อยใส่ pagination
      const { results } = await DB.prepare(
        `SELECT id, doc_no, doc_date, company_name, payer_name, payee_name, total_satang
         FROM certificates
         WHERE (?1 = '' OR doc_no LIKE ?2 OR payer_name LIKE ?2 OR payee_name LIKE ?2)
           AND (?3 = 0  OR company_id = ?3)
           AND (?4 = '' OR doc_date >= ?4)
           AND (?5 = '' OR doc_date <= ?5)
         ORDER BY id DESC LIMIT 200`
      ).bind(search, `%${search}%`, +q.get('company_id') || 0, str(q.get('from')), str(q.get('to'))).all();
      return json(results);
    }

    case 'GET certificates/:id': {
      const row = await DB.prepare(`SELECT * FROM certificates WHERE id=?1`).bind(+id).first();
      return row ? json(row) : json({ error: 'ไม่พบใบนี้' }, 404);
    }

    case 'DELETE certificates/:id': {
      await DB.prepare(`DELETE FROM certificates WHERE id=?1`).bind(+id).run();
      return json({ ok: true });
    }

    case 'POST certificates':
      return createCertificate(await request.json(), DB);
  }

  return json({ error: 'ไม่พบ endpoint นี้' }, 404);
}

async function createCertificate(b, DB) {
  const doc_date = str(b.doc_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc_date)) return bad('วันที่ไม่ถูกต้อง');

  const payer_name = str(b.payer_name);
  const payee_name = str(b.payee_name);
  if (!payer_name) return bad('ต้องระบุชื่อผู้จ่ายเงิน');
  if (!payee_name) return bad('ต้องระบุชื่อผู้รับเงิน');

  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return bad('ต้องมีรายการอย่างน้อย 1 รายการ');

  // เงินเป็น integer สตางค์เท่านั้น และรวมยอดใหม่ฝั่ง server เสมอ ไม่เชื่อ total จาก client
  const clean = [];
  for (const it of items) {
    const desc = str(it.desc);
    const amount_satang = it.amount_satang;
    if (!desc) return bad('รายการต้องไม่ว่าง');
    if (!Number.isInteger(amount_satang) || amount_satang <= 0)
      return bad(`จำนวนเงินของ "${desc}" ต้องเป็นตัวเลขมากกว่า 0`);
    clean.push({ desc, amount_satang });
  }
  const total_satang = clean.reduce((s, it) => s + it.amount_satang, 0);

  const co = await DB.prepare(`SELECT * FROM companies WHERE id=?1 AND active=1`)
    .bind(+b.company_id || 0).first();
  if (!co) return bad('ไม่พบบริษัทที่เลือก');

  // ปี พ.ศ. เอาจากวันที่ที่ผู้ใช้เลือก ไม่ใช่นาฬิกา Worker (Worker รันเป็น UTC)
  const year = Number(doc_date.slice(0, 4)) + 543;

  // จองเลขที่ด้วย statement เดียวที่ atomic — D1 ไม่มี interactive transaction
  // ponytail: การจอง counter กับ INSERT เป็นคนละ round trip (batch() ส่ง RETURNING ต่อกันไม่ได้)
  // ถ้า INSERT พลาดจะเหลือเลขว่างหนึ่งเลข ยอมรับได้ ระบบเอกสารทั่วไปก็เป็นแบบนี้
  const c = await DB.prepare(
    `INSERT INTO counters (year, last_no) VALUES (?1, 1)
     ON CONFLICT(year) DO UPDATE SET last_no = last_no + 1
     RETURNING last_no`
  ).bind(year).first();
  const doc_no = `${year}/${String(c.last_no).padStart(4, '0')}`;

  const row = await DB.prepare(
    `INSERT INTO certificates (
       doc_no, company_id, company_name, company_branch, company_address, company_tax_id,
       doc_date, payer_name, payer_position, payee_name, payee_address, payee_idcard,
       items_json, total_satang, note, created_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) RETURNING *`
  ).bind(
    doc_no, co.id, co.name, co.branch, co.address, co.tax_id,
    doc_date, payer_name, str(b.payer_position), payee_name, str(b.payee_address), str(b.payee_idcard),
    JSON.stringify(clean), total_satang, str(b.note), new Date().toISOString()
  ).first();

  return json(row, 201);
}
