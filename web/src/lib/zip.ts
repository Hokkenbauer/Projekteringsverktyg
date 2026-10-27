/**
 * En enkel ZIP-skrivare (utan komprimering) för filer som skapas i webbläsaren, t.ex. Word-filer (.docx).
 * Word-filer är ZIP-arkiv med XML; okomprimerade filer går bra att öppna i Word och LibreOffice.
 */

const CRC_TABELL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABELL[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipFil = { namn: string; data: Uint8Array | string };

/** Packar filerna till ett ZIP-arkiv. Text sparas som UTF-8. */
export function zip(filer: ZipFil[]): Uint8Array {
  const kod = new TextEncoder();
  const nu = new Date();
  const tid = (nu.getHours() << 11) | (nu.getMinutes() << 5) | Math.floor(nu.getSeconds() / 2);
  const dag = ((nu.getFullYear() - 1980) << 9) | ((nu.getMonth() + 1) << 5) | nu.getDate();

  const delar: Uint8Array[] = [];
  const katalog: Uint8Array[] = [];
  let pos = 0;
  for (const f of filer) {
    const namn = kod.encode(f.namn);
    const data = typeof f.data === "string" ? kod.encode(f.data) : f.data;
    const crc = crc32(data);

    const lokal = new Uint8Array(30 + namn.length);
    const l = new DataView(lokal.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true); // namn i UTF-8
    l.setUint16(8, 0, true); // ingen komprimering
    l.setUint16(10, tid, true);
    l.setUint16(12, dag, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, namn.length, true);
    lokal.set(namn, 30);

    const central = new Uint8Array(46 + namn.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, tid, true);
    c.setUint16(14, dag, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, namn.length, true);
    c.setUint32(42, pos, true);
    central.set(namn, 46);

    delar.push(lokal, data);
    katalog.push(central);
    pos += lokal.length + data.length;
  }
  const katalogStorlek = katalog.reduce((s, x) => s + x.length, 0);
  const slut = new Uint8Array(22);
  const e = new DataView(slut.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, filer.length, true);
  e.setUint16(10, filer.length, true);
  e.setUint32(12, katalogStorlek, true);
  e.setUint32(16, pos, true);

  const alla = [...delar, ...katalog, slut];
  const ut = new Uint8Array(alla.reduce((s, x) => s + x.length, 0));
  let i = 0;
  for (const x of alla) { ut.set(x, i); i += x.length; }
  return ut;
}
