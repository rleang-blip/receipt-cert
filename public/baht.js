// แปลงจำนวนเงิน (หน่วย: สตางค์ จำนวนเต็ม) เป็นคำอ่านภาษาไทย
// รับเป็นสตางค์เสมอ ไม่รับ float บาท — เลี่ยงปัญหา 1200.499999
// เทสต์: เปิด public/test_baht.html ในเบราว์เซอร์

(function (root) {
  var DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  var UNITS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  // อ่านเลข 1..999999 หนึ่งกลุ่ม
  // hasPrefix = มีกลุ่มที่สูงกว่านำหน้าอยู่ (เช่น 1,000,001 -> "หนึ่งล้านเอ็ด" ไม่ใช่ "หนึ่งล้านหนึ่ง")
  function readGroup(n, hasPrefix) {
    if (n === 0) return '';
    var str = String(n), len = str.length, out = '';
    for (var i = 0; i < len; i++) {
      var d = +str[i];
      var pos = len - i - 1; // 0=หน่วย 1=สิบ 2=ร้อย ...
      if (d === 0) continue;
      if (pos === 0 && d === 1 && (len > 1 || hasPrefix)) out += 'เอ็ด';
      else if (pos === 1 && d === 1) out += '';        // สิบ ไม่ใช่ หนึ่งสิบ
      else if (pos === 1 && d === 2) out += 'ยี่';      // ยี่สิบ ไม่ใช่ สองสิบ
      else out += DIGITS[d];
      out += UNITS[pos];
    }
    return out;
  }

  // อ่านจำนวนเต็มบวก แบ่งกลุ่มละ 6 หลักคั่นด้วย "ล้าน"
  function readNumber(n) {
    var groups = [];
    while (n > 0) { groups.unshift(n % 1000000); n = Math.floor(n / 1000000); }
    if (!groups.length) return '';
    var out = '';
    for (var i = 0; i < groups.length; i++) {
      out += readGroup(groups[i], i > 0);
      if (i < groups.length - 1) out += 'ล้าน';
    }
    return out;
  }

  function bahtText(satang) {
    satang = Math.round(Number(satang) || 0);
    if (satang === 0) return 'ศูนย์บาทถ้วน';
    var sign = satang < 0 ? 'ลบ' : '';
    satang = Math.abs(satang);
    var baht = Math.floor(satang / 100), st = satang % 100;
    var out = '';
    if (baht > 0) out += readNumber(baht) + 'บาท';
    out += st > 0 ? readNumber(st) + 'สตางค์' : 'ถ้วน';
    return sign + out;
  }

  root.bahtText = bahtText;
  root.readNumber = readNumber;
})(typeof globalThis !== 'undefined' ? globalThis : this);
