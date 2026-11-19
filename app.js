// ============================================================
// Monitoring Potensi Energi Terbarukan - Kelompok 12 Polinela
// Membaca data yang dikirim ESP32 ke Firebase:
//   /weather/keadaan_sekarang  -> pembacaan terbaru (tiap 5 detik)
//   /weather/histori/<YYYYMMDD_HHMMSS> -> arsip (tiap 1 menit)
// Isi tiap data: anemometer (m/s), rain_gauge (mm), sensor_cahaya (lux),
//                waktu ("DD/MM/YYYY HH:MM:SS", WIB)
// Website ini hanya membaca. Satu-satunya yang mengubah Firebase adalah tombol
// "Hapus data" di tab Histori, dan itu harus masuk dengan akun Firebase dulu.
// ============================================================

// ===== PENGATURAN =====

const firebaseConfig = {
  apiKey: "AIzaSyD-eCZun9Chghk2z0rdPrEuIKkMojrM5g0",
  authDomain: "monitoring-ver-j.firebaseapp.com",
  databaseURL: "https://monitoring-ver-j-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "monitoring-ver-j",
  storageBucket: "monitoring-ver-j.firebasestorage.app",
  messagingSenderId: "237639687534",
  appId: "1:237639687534:web:4e61c13e6537455c34757f"
};

const JALUR_SEKARANG = "/weather/keadaan_sekarang";
const JALUR_HISTORI  = "/weather/histori";

const VERSI_FIREBASE      = "10.14.0";
const JENDELA_LIVE_MENIT  = 15;   // panjang grafik di tab Live
const BATAS_DIAM_DETIK    = 30;   // tanpa data baru selama ini = alat terputus
const MAKS_RENTANG_HARI   = 31;   // batas rentang tanggal sekali tampil
const BARIS_PER_HALAMAN   = 50;
const KATA_HAPUS          = "HAPUS";   // harus diketik sebelum data dihapus

// Tambahkan ?demo di akhir alamat untuk melihat tampilan dengan angka contoh
const DEMO = new URLSearchParams(location.search).has("demo") || window.MODE_DEMO === true;

const MENIT = 60e3, JAM = 3600e3, HARI = 86400e3;

// ===== SENSOR =====

const SENSOR = {
  angin: {
    kunci: "anemometer", satuan: "m/s", desimal: 2, warna: "var(--seri-angin)",
    // Skala Beaufort (m/s)
    batas: [0, 0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9],
    nama:  ["Tenang", "Teduh", "Sepoi lemah", "Sepoi lembut", "Sepoi sedang", "Sepoi segar", "Sepoi kuat"],
    lebih: "Angin kencang"
  },
  hujan: {
    kunci: "rain_gauge", satuan: "mm", desimal: 2, warna: "var(--seri-hujan)",
    // Kategori hujan harian BMKG (mm/hari)
    batas: [0, 0.5, 20, 50, 100, 150],
    nama:  ["Tidak hujan", "Hujan ringan", "Hujan sedang", "Hujan lebat", "Hujan sangat lebat"],
    lebih: "Hujan ekstrem"
  },
  cahaya: {
    kunci: "sensor_cahaya", satuan: "lux", desimal: 0, warna: "var(--seri-cahaya)",
    batas: [0, 10, 1000, 10000, 32000, 100000],
    nama:  ["Gelap", "Redup", "Mendung atau teduh", "Terang", "Matahari langsung"],
    lebih: "Matahari langsung"
  }
};
// Bukan sensor: dipakai grafik "Jumlah data tercatat"
SENSOR.data = { kunci: null, satuan: "data", desimal: 0, warna: "var(--seri-data)" };

const DAFTAR = ["angin", "hujan", "cahaya"];
const DAFTAR_GRAFIK = [...DAFTAR, "data"];

// Kenaikan hujan lebih dari ini per menit dianggap gangguan (noise kabel), bukan hujan
const BATAS_HUJAN_PER_MENIT = 10;   // mm

// ===== ALAT BANTU WAKTU & ANGKA =====
// Semua waktu disimpan sebagai "jam dinding WIB" dalam milidetik
// (dibaca dengan fungsi getUTC*), supaya tidak terpengaruh zona waktu browser.

const p2 = n => String(n).padStart(2, "0");
const $  = id => document.getElementById(id);

const sekarangWIB = () => Date.now() + 7 * JAM;

function uraiWaktu(teks) {           // "13/11/2026 14:35:01" -> ms
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(teks || "").trim());
  if (!m) return null;
  const t = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
  return waktuWajar(t) ? t : null;
}

function uraiKunci(kunci) {          // "20261113_143501" -> ms
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(kunci);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return waktuWajar(t) ? t : null;
}

function waktuWajar(t) {
  const y = new Date(t).getUTCFullYear();
  return Number.isFinite(t) && y >= 2024 && y <= 2099;
}

function kunciDari(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}_` +
         `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}`;
}

const awalHari = t => Math.floor(t / HARI) * HARI;

function tgl(t, pakaiTahun = true) {
  const d = new Date(t);
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}` + (pakaiTahun ? `/${d.getUTCFullYear()}` : "");
}
function jam(t, pakaiDetik = false) {
  const d = new Date(t);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` + (pakaiDetik ? `:${p2(d.getUTCSeconds())}` : "");
}
const isoTgl  = t => new Date(t).toISOString().slice(0, 10);          // untuk <input type="date">
const dariIso = s => { const t = Date.parse(s + "T00:00:00Z"); return Number.isFinite(t) ? t : null; };

function angka(v, desimal) {
  if (!Number.isFinite(v)) return "–";
  return v.toLocaleString("id-ID", { minimumFractionDigits: desimal, maximumFractionDigits: desimal });
}
const angkaSensor = (s, v) => angka(v, SENSOR[s].desimal);

function bersih(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ============================================================
// GRAFIK (SVG buatan sendiri, tanpa library)
// ============================================================

const NS = "http://www.w3.org/2000/svg";
const semuaGrafik = [];

function skalaRapi(maks) {
  const kasar = maks / 4;
  const pangkat = Math.pow(10, Math.floor(Math.log10(kasar)));
  const langkah = [1, 2, 2.5, 5, 10].map(k => k * pangkat).find(k => k >= kasar);
  return { langkah, atas: Math.ceil(maks / langkah - 1e-9) * langkah };
}

const LANGKAH_WAKTU = [MENIT, 2 * MENIT, 5 * MENIT, 15 * MENIT, 30 * MENIT, JAM, 2 * JAM, 3 * JAM,
                       6 * JAM, 12 * JAM, HARI, 2 * HARI, 7 * HARI, 14 * HARI];

let nomorGrafik = 0;

// Kurva halus yang tidak "melenceng" melewati titik data (monotone cubic)
function jalurHalus(titik) {
  const p = titik.filter((q, i) => !i || q[0] > titik[i - 1][0]);
  const n = p.length, f = v => v.toFixed(1);
  if (n < 3) return p.map((q, i) => `${i ? "L" : "M"}${f(q[0])},${f(q[1])}`).join("");
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0
         : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  let d = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(p[i][0] + h)},${f(p[i][1] + t[i] * h)} ${f(p[i + 1][0] - h)},${f(p[i + 1][1] - t[i + 1] * h)} ${f(p[i + 1][0])},${f(p[i + 1][1])}`;
  }
  return d;
}

// Rata-rata bergerak untuk garis tren (data per menit yang naik-turun)
function rataBergerak(seg, lebarJendela) {
  const setengah = Math.floor(lebarJendela / 2), hasil = [];
  let jumlah = 0, a = 0, b = -1;
  for (let i = 0; i < seg.length; i++) {
    const kiri = Math.max(0, i - setengah), kanan = Math.min(seg.length - 1, i + setengah);
    while (b < kanan) jumlah += seg[++b].v;
    while (a < kiri) jumlah -= seg[a++].v;
    hasil.push({ t: seg[i].t, v: jumlah / (b - a + 1) });
  }
  return hasil;
}

/**
 * opsi: { sensor, tinggi, jenis: "garis" | "tangga" | "batang", celah, ember, labelWaktu, pesanKosong }
 *  - celah: jarak waktu (ms) yang dianggap alat mati, garis diputus di situ
 *  - ember: lebar satu batang (ms) untuk jenis "batang"
 */
function buatGrafik(el, opsi) {
  const o = { tinggi: 190, jenis: "garis", celah: 3 * MENIT, minMaks: 1, ...opsi };
  const S = SENSOR[o.sensor];
  el.classList.add("grafik");
  el.innerHTML = `<svg role="img"></svg><div class="tip" hidden></div><p class="kosong" hidden></p>`;
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), kosong = el.querySelector(".kosong");
  const M = { l: 52, r: 14, t: 12, b: 26 };

  let data = [], rentang = null, lebar = 0, pendengar = null;
  let fx = null, fy = null, gKursor = null;

  function buat(nama, atribut, induk = svg) {
    const n = document.createElementNS(NS, nama);
    for (const k in atribut) n.setAttribute(k, atribut[k]);
    induk.appendChild(n);
    return n;
  }

  function gambar() {
    nomorGrafik++;
    lebar = el.clientWidth;
    if (!lebar) return;                       // tab sedang tersembunyi
    const tinggi = o.tinggi;
    svg.setAttribute("viewBox", `0 0 ${lebar} ${tinggi}`);
    svg.setAttribute("height", tinggi);
    svg.replaceChildren();
    tip.hidden = true;

    const pw = lebar - M.l - M.r, ph = tinggi - M.t - M.b;
    const [t0, t1] = rentang || (data.length ? [data[0].t, data[data.length - 1].t + 1] : [0, 1]);

    let maks = o.minMaks;
    for (const d of data) if (d.v > maks) maks = d.v;
    const { langkah, atas } = skalaRapi(maks);

    fx = t => M.l + ((t - t0) / (t1 - t0)) * pw;
    fy = v => M.t + ph - (v / atas) * ph;

    // --- sumbu Y: garis kisi tipis + angka
    const desY = langkah >= 1 ? 0 : (Math.abs(langkah * 10 - Math.round(langkah * 10)) < 1e-9 ? 1 : 2);
    for (let v = 0; v <= atas + 1e-9; v += langkah) {
      const y = Math.round(fy(v)) + 0.5;
      buat("line", { x1: M.l, x2: lebar - M.r, y1: y, y2: y, class: v === 0 ? "dasar" : "kisi" });
      buat("text", { x: M.l - 8, y: y + 4, "text-anchor": "end" }).textContent = angka(v, desY);
    }

    // --- sumbu X: waktu
    const target = Math.max(2, Math.floor(pw / 70));
    const lw = LANGKAH_WAKTU.find(s => (t1 - t0) / s <= target) || LANGKAH_WAKTU[LANGKAH_WAKTU.length - 1];
    const banyakHari = (t1 - t0) > 1.1 * HARI;
    for (let t = Math.ceil(t0 / lw) * lw; t <= t1; t += lw) {
      const x = fx(t);
      if (x > lebar - M.r - 14) continue;
      let label;
      if (lw >= HARI) label = tgl(t, false);
      else if (banyakHari && t % HARI === 0) label = tgl(t, false);
      else label = jam(t);
      buat("line", { x1: x, x2: x, y1: M.t + ph, y2: M.t + ph + 4, class: "dasar" });
      buat("text", { x, y: tinggi - 7, "text-anchor": "middle" }).textContent = label;
    }

    // --- daerah yang belum terjadi (tanggal hari ini), diberi arsir tipis
    const kini = sekarangWIB();
    if (o.tandaSekarang && rentang && kini > t0 && kini < t1) {
      const xs = fx(kini);
      buat("rect", { class: "nanti", x: xs, y: M.t, width: Math.max(0, lebar - M.r - xs), height: ph });
      buat("line", { class: "sekarang", x1: xs, x2: xs, y1: M.t, y2: M.t + ph });
      const muatKanan = xs + 62 < lebar - M.r;
      buat("text", { class: "sekarang-teks", x: muatKanan ? xs + 6 : xs - 6, y: M.t + 12,
                     "text-anchor": muatKanan ? "start" : "end" }).textContent = "Sekarang";
    }

    // --- isi
    kosong.hidden = data.length > 0;
    if (!data.length) { kosong.textContent = o.pesanKosong || "Belum ada data."; gKursor = null; return; }

    // gradasi warna: pekat di garis, memudar ke dasar
    const id = `g${nomorGrafik}`;
    const defs = buat("defs", {});
    const gl = buat("linearGradient", { id: id + "l", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    buat("stop", { offset: "0%",   style: `stop-color:${S.warna};stop-opacity:0.34` }, gl);
    buat("stop", { offset: "70%",  style: `stop-color:${S.warna};stop-opacity:0.08` }, gl);
    buat("stop", { offset: "100%", style: `stop-color:${S.warna};stop-opacity:0` }, gl);
    const gb = buat("linearGradient", { id: id + "b", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    buat("stop", { offset: "0%",   style: `stop-color:${S.warna};stop-opacity:1` }, gb);
    buat("stop", { offset: "100%", style: `stop-color:${S.warna};stop-opacity:0.45` }, gb);

    const dasar = M.t + ph;
    if (o.jenis === "batang") {
      const lb = Math.max(2, Math.min(34, (o.ember / (t1 - t0)) * pw - 2));
      for (const d of data) {
        if (d.v <= 0) continue;
        const h = Math.max(2, dasar - fy(d.v)), y = dasar - h;
        const xc = fx(d.t + o.ember / 2), r = Math.min(4, lb / 2, h);
        buat("path", {
          fill: `url(#${id}b)`,
          d: `M${xc - lb / 2},${dasar} V${y + r} q0,${-r} ${r},${-r} H${xc + lb / 2 - r} q${r},0 ${r},${r} V${dasar} Z`
        });
      }
    } else {
      // potong garis di tempat alat tidak mengirim data
      const potongan = [];
      let kini2 = [];
      data.forEach((d, i) => {
        if (i && d.t - data[i - 1].t > o.celah) { potongan.push(kini2); kini2 = []; }
        kini2.push(d);
      });
      potongan.push(kini2);

      // data per menit yang rapat: garis asli dibuat tipis, ditambah garis tren yang halus
      const pakaiTren = o.tren && o.jenis === "garis" && data.length > 150;
      const jendela = Math.max(5, Math.round(data.length / 90));

      for (const seg of potongan) {
        if (seg.length === 1) {
          buat("circle", { class: "titik", cx: fx(seg[0].t), cy: fy(seg[0].v), r: 4, fill: S.warna });
          continue;
        }
        const titik = seg.map(d => [fx(d.t), fy(d.v)]);
        let jalur;
        if (o.jenis === "tangga") {
          jalur = titik.map(([x, y], i) => i ? `H${x.toFixed(1)}V${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`).join("");
        } else {
          jalur = pakaiTren ? titik.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("")
                            : jalurHalus(titik);
        }
        const xa = titik[0][0].toFixed(1), xb = titik[titik.length - 1][0].toFixed(1);
        buat("path", { fill: `url(#${id}l)`, d: `${jalur}L${xb},${dasar}L${xa},${dasar}Z` });
        buat("path", { class: pakaiTren ? "garis tipis" : "garis", stroke: S.warna, d: jalur });
        if (pakaiTren && seg.length > 2) {
          const tren = rataBergerak(seg, jendela).map(d => [fx(d.t), fy(d.v)]);
          buat("path", { class: "garis tren-latar", d: jalurHalus(tren) });
          buat("path", { class: "garis tren", stroke: S.warna, d: jalurHalus(tren) });
        }
      }
      if (o.titikAkhir) {
        const z = data[data.length - 1];
        buat("circle", { class: "cahaya-titik", cx: fx(z.t), cy: fy(z.v), r: 10, fill: S.warna });
        buat("circle", { class: "titik", cx: fx(z.t), cy: fy(z.v), r: 5, fill: S.warna });
      }
    }

    gKursor = buat("g", { visibility: "hidden" });
    buat("line", { class: "kursor-garis", y1: M.t, y2: M.t + ph }, gKursor);
    buat("circle", { class: "cahaya-titik", r: 10, fill: S.warna }, gKursor);
    buat("circle", { class: "titik", r: 5, fill: S.warna }, gKursor);
  }

  function terdekat(t) {
    let a = 0, b = data.length - 1;
    while (b - a > 1) { const m = (a + b) >> 1; (data[m].t <= t ? (a = m) : (b = m)); }
    if (o.jenis === "batang") return data[data[b].t <= t ? b : a];
    return Math.abs(data[a].t - t) <= Math.abs(data[b].t - t) ? data[a] : data[b];
  }

  function setKursor(t) {
    if (!gKursor || !data.length || t == null) {
      if (gKursor) gKursor.setAttribute("visibility", "hidden");
      tip.hidden = true;
      return;
    }
    const d = terdekat(t);
    const x = fx(o.jenis === "batang" ? d.t + o.ember / 2 : d.t), y = fy(d.v);
    gKursor.setAttribute("visibility", "visible");
    const [garis, cahaya, titik] = gKursor.children;
    garis.setAttribute("x1", x); garis.setAttribute("x2", x);
    for (const c of [cahaya, titik]) {
      c.setAttribute("cx", x); c.setAttribute("cy", y);
      c.setAttribute("visibility", o.jenis === "batang" ? "hidden" : "inherit");
    }

    tip.innerHTML = `${(o.labelWaktu || (w => `${tgl(w, false)} ${jam(w, true)}`))(d.t)}` +
                    `<b><i style="background:${S.warna}"></i>${angkaSensor(o.sensor, d.v)} ${S.satuan}</b>`;
    tip.hidden = false;
    const lt = tip.offsetWidth;
    let kiri = x + 12;
    if (kiri + lt > lebar - 4) kiri = x - 12 - lt;
    tip.style.left = Math.max(4, kiri) + "px";
  }

  function dariPointer(e) {
    if (!data.length || !fx) return;
    const kotak = svg.getBoundingClientRect();
    const px = Math.min(Math.max(e.clientX - kotak.left, M.l), lebar - M.r);
    const [t0, t1] = rentang || [data[0].t, data[data.length - 1].t + 1];
    const t = t0 + ((px - M.l) / (lebar - M.l - M.r)) * (t1 - t0);
    if (pendengar) pendengar(t); else setKursor(t);
  }
  svg.addEventListener("pointermove", dariPointer);
  svg.addEventListener("pointerdown", dariPointer);
  svg.addEventListener("pointerleave", () => { if (pendengar) pendengar(null); else setKursor(null); });

  new ResizeObserver(() => { if (el.clientWidth !== lebar) gambar(); }).observe(el);

  const api = {
    setData(baru, r = null, ubah = {}) { data = baru; rentang = r; Object.assign(o, ubah); gambar(); },
    setKursor,
    padaKursor(fn) { pendengar = fn; },
    gambar
  };
  semuaGrafik.push(api);
  return api;
}

// ============================================================
// STATUS & PERINGATAN
// ============================================================

function setStatus(keadaan, teks) {
  $("status").dataset.keadaan = keadaan;
  $("status-teks").textContent = teks;
}

const pesan = new Map();
function peringatan(id, teks, jenis = "") {
  if (teks) pesan.set(id, { teks, jenis }); else pesan.delete(id);
  const kotak = $("peringatan");
  kotak.replaceChildren(...[...pesan.values()].map(m => {
    const p = document.createElement("p");
    p.textContent = m.teks;
    if (m.jenis) p.className = m.jenis;
    return p;
  }));
  kotak.hidden = pesan.size === 0;
}

// ============================================================
// ANIMASI ADEGAN
// Gambar di atas tiap pembacaan Live, digerakkan oleh angka sensor:
//  - angin  : putaran baling-baling, garis hembusan, awan, dan rumput bergoyang
//  - hujan  : banyak tetesan & riak = laju hujan 10 menit terakhir, isi penakar = total hari ini
//  - cahaya : tinggi & warna matahari (atau bulan), kilau panel surya,
//             aliran energi di kabel dan isi baterai
// Warna langit di ketiga gambar ikut nilai cahaya, jadi malam hari semuanya gelap.
// ============================================================

const adegan = (() => {
  const gerakKurang = matchMedia("(prefers-reduced-motion: reduce)");
  const k = { angin: 0, hujan: 0, cahaya: 0, laju: 0, ada: false, lajuPaksa: null };
  const anim = { sudut: 0, waktu: 0, awanAngin: 0, awanHujan: 0 };
  let berjalan = false, lalu = 0, hitungLajuTerakhir = 0;

  const acak = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
  const hembusan = Array.from({ length: 12 },  () => ({ x: acak() * 1.3 - 0.15, y: 0.1 + acak() * 0.4, p: 0.6 + acak() * 0.7 }));
  const tetes    = Array.from({ length: 150 }, () => ({ x: acak(), y: acak(), v: 0.75 + acak() * 0.5 }));
  const bintang  = Array.from({ length: 30 },  () => ({ x: acak(), y: acak() * 0.55, r: 0.5 + acak() * 1.1 }));
  const rumput   = Array.from({ length: 46 },  () => ({ x: acak(), h: 3 + acak() * 5, f: acak() * 6 }));
  const riak     = [];
  const awanAngin = [{ x: 0.08, y: 0.22, s: 0.75 }, { x: 0.6, y: 0.3, s: 0.55 }];
  const awanHujan = [
    { x: 0.02, y: 0.26, s: 1.15, depan: false }, { x: 0.4, y: 0.2, s: 1.05, depan: false },
    { x: 0.74, y: 0.27, s: 0.95, depan: false }, { x: 0.22, y: 0.35, s: 0.9, depan: true },
    { x: 0.58, y: 0.37, s: 1.0, depan: true }
  ];
  const energi = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];

  const campur = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const rgb = (c, al = 1) => `rgba(${c.map(Math.round).join(",")},${al})`;
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const jepit = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (P, Q, u) => [P[0] + (Q[0] - P[0]) * u, P[1] + (Q[1] - P[1]) * u];

  const PUTIH = hex("#ffffff"), AMBER = hex("#ff3b1a"), HITAM = hex("#0a1a22");
  const LANGIT = {
    malam: [hex("#0b1d3a"), hex("#21416e")],
    senja: [hex("#3b5fa6"), hex("#f5a882")],
    siang: [hex("#0b93f5"), hex("#a3daff")]
  };
  const BUKIT_JAUH  = [hex("#1c3447"), hex("#9fd9b0")];   // malam, siang
  const BUKIT_DEKAT = [hex("#122d2b"), hex("#5cb97f")];

  // 0 = malam, 1 = siang penuh (20.000 lux ke atas)
  const terang = () => k.ada ? jepit(Math.log10(k.cahaya + 1) / Math.log10(20001)) : 0.85;

  function warnaLangit(t) {
    return t < 0.5 ? [0, 1].map(i => campur(LANGIT.malam[i], LANGIT.senja[i], t / 0.5))
                   : [0, 1].map(i => campur(LANGIT.senja[i], LANGIT.siang[i], (t - 0.5) / 0.5));
  }
  function hijau(pal, t, kelabu = 0) {
    let c = campur(pal[0], pal[1], jepit(t * 1.15));
    return kelabu ? campur(c, hex("#4f6068"), kelabu) : c;
  }

  function siapkan(id) {
    const cv = $(id);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineCap = "round"; c.lineJoin = "round";
    return { c, w, h };
  }

  function langit(c, w, h, t, kelabu = 0) {
    let [atas, bawah] = warnaLangit(t);
    if (kelabu) { const abu = hex("#5d6f86"); atas = campur(atas, abu, kelabu); bawah = campur(bawah, abu, kelabu); }
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgb(atas)); g.addColorStop(1, rgb(bawah));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const tampakBintang = jepit(1 - t / 0.35) * (1 - kelabu);
    if (tampakBintang > 0) {
      for (const b of bintang) {
        const kedip = 0.55 + 0.45 * Math.sin(anim.waktu * 1.6 + b.x * 40);
        c.fillStyle = rgb(PUTIH, tampakBintang * kedip * 0.85);
        c.beginPath(); c.arc(b.x * w, b.y * h, b.r, 0, 7); c.fill();
      }
    }
    return { atas, bawah };
  }

  const yBukit = (x, w, y0, amp, fase, frek) => y0 - Math.sin((x / w) * Math.PI * frek + fase) * amp;

  function bukit(c, w, h, y0, amp, fase, frek, warna) {
    const g = c.createLinearGradient(0, y0 - amp, 0, h);
    g.addColorStop(0, rgb(warna)); g.addColorStop(1, rgb(campur(warna, HITAM, 0.22)));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) c.lineTo(x, yBukit(x, w, y0, amp, fase, frek));
    c.lineTo(w, yBukit(w, w, y0, amp, fase, frek)); c.lineTo(w, h); c.closePath(); c.fill();
  }

  function awan(c, x, y, s, warna, al = 1) {
    const g = c.createLinearGradient(0, y - 24 * s, 0, y + 11 * s);
    g.addColorStop(0, rgb(warna, al));
    g.addColorStop(1, rgb(campur(warna, hex("#6b7f99"), 0.25), al));
    c.fillStyle = g;
    c.beginPath();
    for (const [dx, dy, r] of [[0, 0, 11], [14, -9, 15], [31, -6, 12], [43, 0, 10]]) {
      c.moveTo(x + (dx + r) * s, y + dy * s);
      c.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    }
    c.roundRect(x - 11 * s, y - 3 * s, 64 * s, 14 * s, 7 * s);
    c.fill();
  }

  function geserAwan(a, w, geser) {
    const lebar = w + 150;
    return ((a.x * lebar + geser) % lebar + lebar) % lebar - 95;
  }

  // ---------------- ANGIN ----------------

  function turbin(c, x, yDasar, tinggi, s, sudut, t, kabut = null) {
    let terangT = campur(hex("#a9bacb"), PUTIH, t), gelapT = campur(hex("#76899e"), hex("#cfdbe7"), t);
    if (kabut) { terangT = campur(terangT, kabut.warna, kabut.k); gelapT = campur(gelapT, kabut.warna, kabut.k); }
    const atas = yDasar - tinggi;

    const g = c.createLinearGradient(x - 4 * s, 0, x + 4 * s, 0);
    g.addColorStop(0, rgb(terangT)); g.addColorStop(1, rgb(gelapT));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - 3.6 * s, yDasar); c.lineTo(x - 1.4 * s, atas);
    c.lineTo(x + 1.4 * s, atas); c.lineTo(x + 3.6 * s, yDasar); c.closePath(); c.fill();

    c.fillStyle = rgb(terangT);
    c.beginPath(); c.roundRect(x - 2.6 * s, atas - 2.8 * s, 8.5 * s, 5.6 * s, 2.6 * s); c.fill();

    const pj = tinggi * 0.6;
    c.strokeStyle = rgb(gelapT, 0.8); c.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      c.save(); c.translate(x, atas); c.rotate(sudut + i * (Math.PI * 2 / 3));
      c.beginPath();
      c.moveTo(0, -2.6 * s);
      c.quadraticCurveTo(pj * 0.3, -6 * s, pj, -0.7 * s);
      c.lineTo(pj, 0.5 * s);
      c.quadraticCurveTo(pj * 0.35, 2.2 * s, 0, 2.6 * s);
      c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
    c.fillStyle = rgb(AMBER);
    c.beginPath(); c.arc(x, atas, 3.3 * s, 0, 7); c.fill();
    c.fillStyle = "rgba(255,255,255,0.75)";
    c.beginPath(); c.arc(x - 1 * s, atas - 1 * s, 1.1 * s, 0, 7); c.fill();
  }

  function gambarAngin(dt) {
    const s = siapkan("adegan-angin"); if (!s) return;
    const { c, w, h } = s, t = terang(), v = k.angin;
    const { bawah } = langit(c, w, h, t);

    // awan ikut terbawa angin
    anim.awanAngin += dt * (3 + v * 7);
    const warnaAwan = campur(PUTIH, hex("#2a4366"), jepit(1 - t * 1.4) * 0.65);
    for (const a of awanAngin) awan(c, geserAwan(a, w, anim.awanAngin * (0.6 + a.s * 0.6)), a.y * h, a.s * h / 150, warnaAwan, 0.92);

    // bukit jauh + turbin kecil (sedikit pudar karena jauh)
    const bj = hijau(BUKIT_JAUH, t);
    bukit(c, w, h, h * 0.74, h * 0.07, 0.4, 1.4, bj);
    const x1 = w * 0.24;
    turbin(c, x1, yBukit(x1, w, h * 0.74, h * 0.07, 0.4, 1.4) + 2, h * 0.34, 0.68, anim.sudut * 0.9 + 0.7, t, { warna: bawah, k: 0.28 });

    // bukit dekat + turbin besar
    const bd = hijau(BUKIT_DEKAT, t);
    const yDekat = x => yBukit(x, w, h * 0.9, h * 0.06, 2.2, 1.1);
    bukit(c, w, h, h * 0.9, h * 0.06, 2.2, 1.1, bd);
    const x2 = w * 0.64;
    turbin(c, x2, yDekat(x2) + 2, h * 0.58, 1.05, anim.sudut, t);

    // rumput bergoyang mengikuti angin
    c.strokeStyle = rgb(campur(bd, HITAM, 0.28)); c.lineWidth = 1.3;
    c.beginPath();
    for (const r of rumput) {
      const x = r.x * w, y = yDekat(x) + 1.5;
      const goyang = Math.sin(anim.waktu * (1.6 + v * 0.3) + r.f) * (0.6 + v * 0.25) + v * 0.55;
      c.moveTo(x, y); c.lineTo(x + goyang, y - r.h);
    }
    c.stroke();

    // garis hembusan: makin kencang makin banyak, panjang, dan cepat
    const banyak = Math.round(jepit(v / 7) * hembusan.length);
    c.lineWidth = 1.7;
    for (let i = 0; i < banyak; i++) {
      const g = hembusan[i];
      g.x += dt * (0.05 + v * 0.045) * g.p;
      if (g.x > 1.2) { g.x = -0.2; g.y = 0.1 + acak() * 0.4; }
      const pj = (16 + v * 5) * g.p, x = g.x * w, y = g.y * h;
      const ekor = c.createLinearGradient(x - pj, 0, x, 0);
      ekor.addColorStop(0, "rgba(255,255,255,0)");
      ekor.addColorStop(1, "rgba(255,255,255,0.8)");
      c.strokeStyle = ekor;
      c.beginPath(); c.moveTo(x - pj, y + 2); c.quadraticCurveTo(x - pj * 0.45, y - 3, x, y); c.stroke();
    }
  }

  // ---------------- HUJAN ----------------

  function hitungLaju() {
    if (k.lajuPaksa !== null) return k.lajuPaksa;
    const seri = live.hujan;
    if (seri.length < 2) return 0;
    const akhir = seri[seri.length - 1], batas = akhir.t - 10 * MENIT;
    const awal = seri.find(d => d.t >= batas) || seri[0];
    const naik = akhir.v >= awal.v ? akhir.v - awal.v : akhir.v;   // angka sempat di-nol-kan
    const lama = Math.max(MENIT, akhir.t - awal.t);
    let laju = naik * (10 * MENIT / lama);
    // tip yang baru saja masuk (1,5 menit terakhir) tetap terlihat sebagai gerimis
    for (let i = seri.length - 1; i > 0 && seri[i].t > akhir.t - 90e3; i--) {
      if (seri[i].v > seri[i - 1].v) { laju = Math.max(laju, 0.3); break; }
    }
    return laju;
  }

  function penakar(c, gx, yDasar, yAtas, t, kuat) {
    const lebar = 16, kiri = gx - lebar / 2, bawahKaca = yDasar - 4, tinggiKaca = bawahKaca - yAtas;

    c.fillStyle = rgb(campur(hex("#3e5064"), hex("#8fa3b8"), t));
    c.beginPath(); c.roundRect(kiri - 3, yDasar - 4, lebar + 6, 5, 2); c.fill();

    const kaca = c.createLinearGradient(kiri, 0, kiri + lebar, 0);
    kaca.addColorStop(0, "rgba(255,255,255,0.38)");
    kaca.addColorStop(0.5, "rgba(255,255,255,0.12)");
    kaca.addColorStop(1, "rgba(255,255,255,0.3)");
    c.fillStyle = kaca;
    c.beginPath(); c.roundRect(kiri, yAtas, lebar, tinggiKaca, [0, 0, 4, 4]); c.fill();

    const isi = jepit(k.hujan / 50);
    if (isi > 0) {
      const tinggiAir = Math.max(2, (tinggiKaca - 2) * isi), yAir = bawahKaca - 1 - tinggiAir;
      const air = c.createLinearGradient(0, yAir, 0, bawahKaca);
      air.addColorStop(0, "#6cc0ff"); air.addColorStop(1, "#1f66c9");
      c.fillStyle = air;
      c.beginPath(); c.roundRect(kiri + 1.5, yAir, lebar - 3, tinggiAir, [0, 0, 3, 3]); c.fill();
      const ombak = kuat > 0 ? Math.sin(anim.waktu * 6) * 0.8 : 0;
      c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(kiri + 2.5, yAir + 0.5 + ombak); c.lineTo(kiri + lebar - 2.5, yAir + 0.5 - ombak); c.stroke();
    }

    c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineWidth = 1;
    for (let mm = 10; mm <= 50; mm += 10) {
      const y = bawahKaca - 1 - (tinggiKaca - 2) * (mm / 50);
      c.beginPath(); c.moveTo(kiri + 1.5, y); c.lineTo(kiri + (mm % 50 ? 4.5 : 7), y); c.stroke();
    }
    c.strokeStyle = "rgba(255,255,255,0.95)"; c.lineWidth = 1.5;
    c.beginPath(); c.roundRect(kiri, yAtas, lebar, tinggiKaca, [0, 0, 4, 4]); c.stroke();

    const corong = c.createLinearGradient(gx - 13, 0, gx + 13, 0);
    corong.addColorStop(0, rgb(campur(hex("#7b8ea3"), hex("#f2f6fa"), t)));
    corong.addColorStop(1, rgb(campur(hex("#56687c"), hex("#b9c6d4"), t)));
    c.fillStyle = corong;
    c.beginPath();
    c.moveTo(gx - 13, yAtas - 9); c.lineTo(gx + 13, yAtas - 9);
    c.lineTo(kiri + lebar, yAtas); c.lineTo(kiri, yAtas); c.closePath(); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(gx - 13, yAtas - 9); c.lineTo(gx + 13, yAtas - 9); c.stroke();
  }

  function gambarHujan(dt) {
    const s = siapkan("adegan-hujan"); if (!s) return;
    const { c, w, h } = s, t = terang();
    const now = performance.now();
    if (now - hitungLajuTerakhir > 1000) { k.laju = hitungLaju(); hitungLajuTerakhir = now; }
    const kuat = k.laju <= 0 ? 0 : jepit(0.18 + Math.log10(1 + k.laju) / Math.log10(1 + 8) * 0.82);

    langit(c, w, h, t, kuat * 0.6);
    bukit(c, w, h, h * 0.8, h * 0.05, 1.0, 1.6, hijau(BUKIT_JAUH, t, kuat * 0.45));

    // awan: makin lebat makin abu-abu dan makin cepat bergerak
    anim.awanHujan += dt * (2 + kuat * 6);
    const malam = jepit(1 - t * 1.4) * 0.6;
    const dasarAwan = campur(campur(PUTIH, hex("#7c8ba0"), kuat), hex("#24395a"), malam);
    for (const a of awanHujan) {
      if (a.depan) continue;
      awan(c, geserAwan(a, w, anim.awanHujan * (0.7 + a.s * 0.3)), a.y * h, a.s * h / 150,
           campur(dasarAwan, hex("#9aa8bb"), 0.18), 0.92);
    }

    const gx = w - 30;
    const yTanah = x => yBukit(x, w, h * 0.88, h * 0.03, 0.5, 1.2);

    // tetesan; saat menyentuh tanah muncul riak kecil
    const banyak = Math.round(kuat * tetes.length);
    c.strokeStyle = rgb(campur(PUTIH, hex("#cfe6ff"), 0.4), 0.85);
    c.lineWidth = 1.4;
    c.beginPath();
    const yMulai = h * 0.38;
    for (let i = 0; i < banyak; i++) {
      const d = tetes[i];
      const x = 6 + d.x * (gx - 34), yAkhir = yTanah(x);
      d.y += dt * (1.3 + kuat * 1.2) * d.v;
      let y = yMulai + d.y * (yAkhir - yMulai);
      if (y >= yAkhir) {
        if (riak.length < 40) riak.push({ x: x - 2, y: yAkhir + 2, u: 0 });
        d.y = 0; d.x = acak(); continue;
      }
      const p = 7 + kuat * 7;
      c.moveTo(x, y); c.lineTo(x - p * 0.22, y + p);
    }
    c.stroke();

    for (const a of awanHujan) {
      if (!a.depan) continue;
      awan(c, geserAwan(a, w, anim.awanHujan * (0.7 + a.s * 0.3)), a.y * h, a.s * h / 150, dasarAwan, 1);
    }

    bukit(c, w, h, h * 0.88, h * 0.03, 0.5, 1.2, hijau(BUKIT_DEKAT, t, kuat * 0.35));

    c.lineWidth = 1;
    for (let i = riak.length - 1; i >= 0; i--) {
      const r = riak[i];
      r.u += dt * 2.4;
      if (r.u >= 1) { riak.splice(i, 1); continue; }
      c.strokeStyle = `rgba(255,255,255,${(1 - r.u) * 0.7})`;
      c.beginPath(); c.ellipse(r.x, r.y, 1 + 5 * r.u, 0.5 + 1.6 * r.u, 0, 0, 7); c.stroke();
    }

    penakar(c, gx, yTanah(gx) + 1, h * 0.44, t, kuat);
  }

  // ---------------- CAHAYA ----------------

  function gambarCahaya(dt) {
    const s = siapkan("adegan-cahaya"); if (!s) return;
    const { c, w, h } = s, t = terang();
    const { atas, bawah } = langit(c, w, h, t);
    const tinggiMatahari = jepit((t - 0.25) / 0.75);   // 0 = dekat cakrawala, 1 = tinggi
    const tampakMatahari = jepit((t - 0.15) / 0.2);    // 0 = bulan, 1 = matahari

    if (tampakMatahari < 1) {                           // bulan sabit
      const bx = w * 0.26, by = h * 0.3, r = 12;
      c.globalAlpha = 1 - tampakMatahari;
      const halo = c.createRadialGradient(bx, by, r, bx, by, r * 3.2);
      halo.addColorStop(0, "rgba(240,236,220,0.22)"); halo.addColorStop(1, "rgba(240,236,220,0)");
      c.fillStyle = halo; c.beginPath(); c.arc(bx, by, r * 3.2, 0, 7); c.fill();
      c.fillStyle = "#f3efe0"; c.beginPath(); c.arc(bx, by, r, 0, 7); c.fill();
      c.fillStyle = rgb(campur(atas, bawah, (by - 4) / h));
      c.beginPath(); c.arc(bx + 6, by - 4, r * 0.9, 0, 7); c.fill();
      c.globalAlpha = 1;
    }

    if (tampakMatahari > 0) {
      const e = tinggiMatahari;
      const sx = w * 0.28, sy = h * (0.72 - 0.46 * e), r = 11 + 6 * e;
      const inti = campur(hex("#ffe2bd"), hex("#fffbe8"), e);
      const tepi = campur(hex("#ff8f4f"), hex("#ffc83a"), e);
      c.globalAlpha = tampakMatahari;

      // berkas cahaya lembut yang berputar pelan
      const R = r * (4 + 3 * t);
      c.save(); c.translate(sx, sy); c.rotate(anim.waktu * 0.04);
      const sinar = c.createRadialGradient(0, 0, r, 0, 0, R);
      sinar.addColorStop(0, rgb(tepi, 0.12 + 0.1 * t));
      sinar.addColorStop(1, rgb(tepi, 0));
      c.fillStyle = sinar;
      for (let i = 0; i < 12; i++) {
        c.rotate(Math.PI / 6);
        const lebarSinar = i % 2 ? 0.045 : 0.07;
        c.beginPath(); c.moveTo(0, 0);
        c.lineTo(R * Math.cos(-lebarSinar), R * Math.sin(-lebarSinar));
        c.lineTo(R * Math.cos(lebarSinar), R * Math.sin(lebarSinar));
        c.closePath(); c.fill();
      }
      c.restore();

      const rh = r * (2.6 + 2.4 * t);
      const halo = c.createRadialGradient(sx, sy, r * 0.8, sx, sy, rh);
      halo.addColorStop(0, rgb(tepi, 0.45 + 0.3 * t));
      halo.addColorStop(0.45, rgb(tepi, 0.14 + 0.1 * t));
      halo.addColorStop(1, rgb(tepi, 0));
      c.fillStyle = halo; c.beginPath(); c.arc(sx, sy, rh, 0, 7); c.fill();

      const denyut = (anim.waktu * 0.45) % 1;
      c.strokeStyle = rgb(inti, (1 - denyut) * 0.35 * t); c.lineWidth = 1.5;
      c.beginPath(); c.arc(sx, sy, r * (1.25 + denyut * 1.7), 0, 7); c.stroke();

      const cakram = c.createRadialGradient(sx - r * 0.35, sy - r * 0.35, 1, sx, sy, r);
      cakram.addColorStop(0, rgb(inti)); cakram.addColorStop(1, rgb(tepi));
      c.fillStyle = cakram; c.beginPath(); c.arc(sx, sy, r, 0, 7); c.fill();
      c.globalAlpha = 1;
    }

    bukit(c, w, h, h * 0.8, h * 0.05, 2.0, 1.5, hijau(BUKIT_JAUH, t));
    const yDekat = x => yBukit(x, w, h * 0.9, h * 0.03, 0.8, 1.1);
    bukit(c, w, h, h * 0.9, h * 0.03, 0.8, 1.1, hijau(BUKIT_DEKAT, t));

    // ---- panel surya ----
    const cx = w * 0.58, yTanah = yDekat(cx);
    const pw = Math.min(140, w * 0.38), ph = h * 0.22, kaki = h * 0.1, miring = pw * 0.16;
    const yBawahP = yTanah - kaki, yAtasP = yBawahP - ph;
    const A = [cx - pw / 2 + miring, yAtasP], B = [cx + pw / 2 + miring, yAtasP];
    const C = [cx + pw / 2, yBawahP], D = [cx - pw / 2, yBawahP];
    const poligon = pts => { c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); };

    // bayangan memanjang saat matahari rendah
    c.fillStyle = `rgba(8,30,30,${0.14 + 0.12 * tampakMatahari * t})`;
    c.beginPath();
    c.ellipse(cx + pw * 0.14 + (1 - tinggiMatahari) * pw * 0.18, yTanah + 2,
              pw * 0.55 * (1 + (1 - tinggiMatahari) * 0.35), 4, 0, 0, 7);
    c.fill();

    const besi = campur(hex("#3a4a5c"), hex("#7d8fa3"), t);
    c.strokeStyle = rgb(besi); c.lineWidth = 3;
    c.beginPath();
    for (const f of [0.18, 0.82]) {
      const xb = A[0] + (B[0] - A[0]) * f;
      c.moveTo(xb, yAtasP + 4); c.lineTo(xb - 2, yTanah);
    }
    c.stroke();
    c.lineWidth = 3.4;
    c.beginPath();
    for (const f of [0.18, 0.82]) {
      const xd = D[0] + (C[0] - D[0]) * f;
      c.moveTo(xd, yBawahP); c.lineTo(xd, yTanah);
    }
    c.stroke();

    // rangka perak
    c.fillStyle = rgb(campur(hex("#8193a8"), hex("#e9eef4"), t));
    poligon([A, B, C, D]); c.fill();

    // sel surya
    const tengah = [(A[0] + B[0] + C[0] + D[0]) / 4, (yAtasP + yBawahP) / 2];
    const dalam = P => [P[0] + (tengah[0] - P[0]) * 0.05, P[1] + (tengah[1] - P[1]) * 0.14];
    const [a, b, cc, d] = [A, B, C, D].map(dalam);
    const sel = c.createLinearGradient(a[0], a[1], cc[0], cc[1]);
    sel.addColorStop(0, rgb(campur(hex("#0c2b55"), hex("#2366b8"), 0.3 + 0.7 * t)));
    sel.addColorStop(1, rgb(campur(hex("#061830"), hex("#103c78"), 0.3 + 0.7 * t)));
    c.fillStyle = sel; poligon([a, b, cc, d]); c.fill();

    const pantul = c.createLinearGradient(0, a[1], 0, d[1]);
    pantul.addColorStop(0, rgb(atas, 0.38)); pantul.addColorStop(1, rgb(atas, 0));
    c.fillStyle = pantul; poligon([a, b, cc, d]); c.fill();

    const titikPada = (u, v) => lerp(lerp(a, b, u), lerp(d, cc, u), v);
    c.strokeStyle = "rgba(175,210,248,0.45)"; c.lineWidth = 0.8;
    c.beginPath();
    for (let i = 1; i < 6; i++) { const p = titikPada(i / 6, 0), q = titikPada(i / 6, 1); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); }
    for (let j = 1; j < 3; j++) { const p = titikPada(0, j / 3), q = titikPada(1, j / 3); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); }
    c.stroke();

    // kilau berjalan, makin terang makin jelas
    c.save(); poligon([a, b, cc, d]); c.clip();
    const kx = D[0] - pw * 0.5 + ((anim.waktu * 30) % (pw * 2.2));
    const kilau = c.createLinearGradient(kx, 0, kx + pw * 0.35, 0);
    kilau.addColorStop(0, "rgba(255,255,255,0)");
    kilau.addColorStop(0.5, `rgba(255,255,255,${0.55 * tampakMatahari * t})`);
    kilau.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = kilau; c.fillRect(D[0] - 10, yAtasP - 2, pw + miring + 20, ph + 4);
    c.restore();

    c.strokeStyle = `rgba(255,255,255,${0.35 + 0.4 * t})`; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke();

    // ---- kabel, aliran energi, baterai ----
    const bx = w - 22, yB = yDekat(bx);
    const P0 = [C[0] - 8, yBawahP + 1], P1 = [C[0] + 6, yB + 2], P2 = [bx - 8, yB - 9];
    const padaKabel = u => {
      const m = 1 - u;
      return [m * m * P0[0] + 2 * m * u * P1[0] + u * u * P2[0], m * m * P0[1] + 2 * m * u * P1[1] + u * u * P2[1]];
    };
    c.strokeStyle = rgb(besi); c.lineWidth = 2;
    c.beginPath(); c.moveTo(P0[0], P0[1]); c.quadraticCurveTo(P1[0], P1[1], P2[0], P2[1]); c.stroke();

    const daya = jepit((t - 0.2) / 0.8);          // 0 saat gelap, 1 saat terik
    if (daya > 0) {
      const kecepatan = 0.2 + 0.7 * daya;
      for (const u0 of energi) {
        const [ex, ey] = padaKabel((u0 + anim.waktu * kecepatan) % 1);
        c.fillStyle = `rgba(255,214,90,${0.3 * daya})`;
        c.beginPath(); c.arc(ex, ey, 5, 0, 7); c.fill();
        c.fillStyle = `rgba(255,226,120,${0.45 + 0.55 * daya})`;
        c.beginPath(); c.arc(ex, ey, 2, 0, 7); c.fill();
      }
    }

    const lb = 16, tb = 24, xb = bx - lb / 2, ybAtas = yB - tb - 1;
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.beginPath(); c.roundRect(bx - 3.5, ybAtas - 3, 7, 3.5, 1); c.fill();
    c.fillStyle = "rgba(8,28,58,0.55)";
    c.beginPath(); c.roundRect(xb, ybAtas, lb, tb, 3); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 1.5; c.stroke();
    const nyala = Math.round(daya * 4);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i < nyala ? "#ffcf4a" : "rgba(255,255,255,0.16)";
      c.beginPath(); c.roundRect(xb + 3, ybAtas + tb - 3 - (i + 1) * 4.6 + 1, lb - 6, 3.4, 1); c.fill();
    }
  }

  function gambarSemua(dt) {
    anim.waktu += dt;
    const omega = k.angin < 0.3 ? 0 : Math.min(k.angin, 16) * 0.9;   // rad per detik
    anim.sudut = (anim.sudut + omega * dt) % (Math.PI * 2);
    gambarAngin(dt); gambarHujan(dt); gambarCahaya(dt);
  }

  const bolehGerak = () => !document.hidden && !$("panel-live").hidden && !gerakKurang.matches;

  function putar(ms) {
    const dt = Math.min(0.1, (ms - lalu) / 1000);
    lalu = ms;
    gambarSemua(dt);
    if (bolehGerak()) requestAnimationFrame(putar); else berjalan = false;
  }

  function mulai() {
    if (berjalan) return;
    if (!bolehGerak()) { if (!$("panel-live").hidden) gambarSemua(0); return; }
    berjalan = true;
    lalu = performance.now();
    requestAnimationFrame(putar);
  }

  document.addEventListener("visibilitychange", mulai);
  gerakKurang.addEventListener?.("change", mulai);
  new ResizeObserver(() => { if (!berjalan) gambarSemua(0); }).observe($("panel-live"));

  return {
    set(nilai) {
      Object.assign(k, { angin: nilai.angin, hujan: nilai.hujan, cahaya: nilai.cahaya, ada: true });
      hitungLajuTerakhir = 0;
      if (!berjalan) gambarSemua(0);
    },
    mulai,
    uji(o) { Object.assign(k, o, { ada: true }); hitungLajuTerakhir = 0; gambarSemua(0); }   // untuk pratinjau
  };
})();

// ============================================================
// TAB LIVE
// ============================================================

const live = { angin: [], hujan: [], cahaya: [] };
const grafikLive = {};
let waktuTerakhir = null;      // waktu data terakhir (jam alat)
let terimaTerakhir = 0;        // kapan browser menerima data baru
let terhubung = false;

function bangunSkala(s) {
  const S = SENSOR[s], el = $("skala-" + s);
  el.innerHTML =
    `<div class="skala-jarum" hidden></div>` +
    `<div class="skala-ruas">${S.nama.map(() => "<span></span>").join("")}</div>` +
    `<div class="skala-angka">${S.batas.map(b => `<span>${b.toLocaleString("id-ID")}</span>`).join("")}</div>`;
}

function perbaruiSkala(s, v) {
  const S = SENSOR[s], el = $("skala-" + s), n = S.nama.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (v < S.batas[k + 1]) { i = k; break; }
  const lewat = v >= S.batas[n];
  const dalam = lewat ? 1 : (v - S.batas[i]) / (S.batas[i + 1] - S.batas[i]);
  const posisi = ((i + Math.min(1, Math.max(0, dalam))) / n) * 100;

  el.querySelectorAll(".skala-ruas span").forEach((ruas, k) => ruas.classList.toggle("aktif", k === i));
  const jarum = el.querySelector(".skala-jarum");
  jarum.hidden = false;
  jarum.style.left = posisi + "%";

  let teks = lewat ? S.lebih : S.nama[i];
  if (s === "angin") teks = lewat ? "Skala Beaufort 7 ke atas" : `Skala Beaufort ${i}`;
  $("kategori-" + s).textContent = teks;
}

function terimaSekarang(val) {
  if (!val) {
    setStatus("terputus", "Belum ada data di Firebase");
    return;
  }
  const t = uraiWaktu(val.waktu);
  const nilai = {};
  for (const s of DAFTAR) nilai[s] = bersih(val[SENSOR[s].kunci]);

  for (const s of DAFTAR) {
    $("nilai-" + s).textContent = angkaSensor(s, nilai[s]);
    perbaruiSkala(s, nilai[s]);
  }
  adegan.set(nilai);

  if (t === null) {
    if (waktuTerakhir === null) setStatus("terputus", "Waktu dari alat tidak terbaca");
    return;
  }
  const pertama = waktuTerakhir === null;
  const baru = t !== waktuTerakhir;

  if (baru) {
    waktuTerakhir = t;
    // Data pertama dianggap segar hanya kalau jamnya dekat dengan jam sekarang
    const segar = !pertama || Math.abs(sekarangWIB() - t) < BATAS_DIAM_DETIK * 1000;
    if (segar) { terimaTerakhir = performance.now(); terhubung = true; }
    for (const s of DAFTAR) {
      const seri = live[s];
      if (!seri.length || t > seri[seri.length - 1].t) seri.push({ t, v: nilai[s] });
    }
    gambarLive();
  }
  perbaruiStatus();
}

function gambarLive() {
  if (waktuTerakhir === null) return;
  const t1 = waktuTerakhir, t0 = t1 - JENDELA_LIVE_MENIT * MENIT;
  for (const s of DAFTAR) {
    while (live[s].length && live[s][0].t < t0) live[s].shift();
    grafikLive[s].setData(live[s], [t0, t1 + 20e3]);
  }
}

function perbaruiStatus() {
  if (waktuTerakhir === null) return;
  if (terhubung && performance.now() - terimaTerakhir > BATAS_DIAM_DETIK * 1000) terhubung = false;
  if (terhubung) {
    setStatus("terhubung", `Alat terhubung, data pukul ${jam(waktuTerakhir, true)}`);
  } else {
    setStatus("terputus", `Alat tidak mengirim data sejak ${tgl(waktuTerakhir)} ${jam(waktuTerakhir, true)}`);
  }
}

function isiAwalLive(baris) {
  for (const s of DAFTAR) {
    const lama = baris.map(b => ({ t: b.t, v: b[s] }));
    const batas = live[s].length ? live[s][0].t : Infinity;
    live[s].unshift(...lama.filter(d => d.t < batas));
  }
  gambarLive();
}

// ============================================================
// TAB GRAFIK & HISTORI
// ============================================================

const grafikRiwayat = {};
const riwayat = { baris: [], tampil: [], mode: "asli", dari: 0, sampai: 0, halaman: 1, muat: 0 };
let sumber = null;             // { bacaHistori(dari, sampai) } diisi Firebase atau demo

function pilihMode(jumlahHari) {
  const pilihan = $("mode").value;
  if (pilihan !== "auto") return pilihan;
  return jumlahHari <= 1 ? "asli" : jumlahHari <= 7 ? "jam" : "hari";
}

// rain_gauge adalah akumulasi harian. Hujan dalam satu periode dihitung dari
// jumlah kenaikannya, jadi tetap benar walau angka sempat di-nol-kan.
// Kenaikan yang mustahil untuk hujan sungguhan (lebih dari BATAS_HUJAN_PER_MENIT)
// dianggap gangguan dan tidak dihitung. Hasilnya: b.naik dan b.hujanBersih.
function tambahKenaikanHujan(baris) {
  let hariLalu = null, lalu = 0, tLalu = 0, akumulasi = 0, lonjakan = 0;
  for (const b of baris) {
    const h = awalHari(b.t);
    let naik;
    if (h !== hariLalu) { hariLalu = h; naik = b.hujan; tLalu = h; akumulasi = 0; }
    else naik = Math.max(0, b.hujan - lalu);
    const menit = Math.max(1, (b.t - tLalu) / MENIT);
    if (naik / menit > BATAS_HUJAN_PER_MENIT) { naik = 0; lonjakan++; }
    akumulasi += naik;
    b.naik = naik;
    b.hujanBersih = akumulasi;
    lalu = b.hujan;
    tLalu = b.t;
  }
  return lonjakan;
}

function kelompokkan(baris, ember) {
  const peta = new Map();
  for (const b of baris) {
    const k = Math.floor(b.t / ember) * ember;
    let g = peta.get(k);
    if (!g) peta.set(k, g = { t: k, n: 0, angin: 0, anginMaks: 0, hujan: 0, cahaya: 0 });
    g.n++;
    g.angin += b.angin;
    g.cahaya += b.cahaya;
    g.hujan += b.naik;
    if (b.angin > g.anginMaks) g.anginMaks = b.angin;
  }
  const hasil = [...peta.values()].sort((a, b) => a.t - b.t);
  for (const g of hasil) { g.angin /= g.n; g.cahaya /= g.n; }
  return hasil;
}

async function tampilkanRiwayat() {
  const dari = dariIso($("tgl-dari").value), sampai = dariIso($("tgl-sampai").value);
  const info = $("saring-info");
  if (dari === null || sampai === null) { info.textContent = "Isi tanggal Dari dan Sampai dulu."; return; }
  if (sampai < dari) { info.textContent = "Tanggal Sampai harus sama atau setelah tanggal Dari."; return; }
  const jumlahHari = (sampai - dari) / HARI + 1;
  if (jumlahHari > MAKS_RENTANG_HARI) {
    info.textContent = `Rentang paling lama ${MAKS_RENTANG_HARI} hari sekali tampil. Persempit tanggalnya.`;
    return;
  }
  tandaiCepat(dari, sampai);

  const urutan = ++riwayat.muat;
  info.textContent = "Mengambil data dari Firebase…";
  let baris;
  try {
    baris = await sumber.bacaHistori(dari, sampai + HARI - 1000);
  } catch (e) {
    if (urutan !== riwayat.muat) return;
    info.textContent = "Data histori gagal diambil. " + jelaskanGalat(e);
    return;
  }
  if (urutan !== riwayat.muat) return;        // sudah ada permintaan yang lebih baru

  const lonjakan = tambahKenaikanHujan(baris);
  const mode = pilihMode(jumlahHari);
  Object.assign(riwayat, { baris, mode, dari, sampai, halaman: 1 });
  riwayat.tampil = mode === "asli" ? baris : kelompokkan(baris, mode === "jam" ? JAM : HARI);

  const namaMode = { asli: "data asli per menit", jam: "rata-rata per jam", hari: "rekap per hari" }[mode];
  const rentangTeks = dari === sampai ? tgl(dari) : `${tgl(dari)} sampai ${tgl(sampai)}`;
  if (baris.length) {
    info.textContent = `${baris.length.toLocaleString("id-ID")} pembacaan, ${rentangTeks}. Ditampilkan sebagai ${namaMode}.` +
      (lonjakan ? ` ${lonjakan.toLocaleString("id-ID")} lonjakan hujan yang tidak wajar (lebih dari ${BATAS_HUJAN_PER_MENIT} mm per menit) tidak dihitung di grafik dan total.` : "");
  } else {
    info.textContent = `Tidak ada data pada ${rentangTeks}.`;
    // Bantu cari: kapan terakhir alat menyimpan data?
    sumber.dataTerakhir().then(t => {
      if (urutan !== riwayat.muat || t == null) return;
      const hariData = awalHari(t);
      info.innerHTML = `Tidak ada data pada ${rentangTeks}. Data terakhir tercatat ${tgl(t)} pukul ${jam(t)}. ` +
        `<button type="button" class="tautan" data-lompat="${isoTgl(hariData)}">Tampilkan ${tgl(hariData)}</button>`;
    }).catch(() => {});
  }

  gambarRiwayat();
  isiRingkasan();
  isiTabel();
}

function gambarRiwayat() {
  const { tampil, baris, mode, dari, sampai } = riwayat;
  const rentang = [dari, sampai + HARI];
  const ember = mode === "jam" ? JAM : HARI;
  const labelWaktu = {
    asli: t => `${tgl(t, false)} ${jam(t)}`,
    jam:  t => `${tgl(t, false)} ${jam(t)} sampai ${jam(t + JAM)}`,
    hari: t => tgl(t)
  }[mode];
  const pesanKosong = "Tidak ada data pada rentang ini. Pilih tanggal lain.";
  const judul = (id, teks, satuan) => { $(id).innerHTML = `${teks} <span class="satuan-judul">${satuan}</span>`; };

  if (mode === "hari") {
    // Rekap per hari memakai batang, supaya hari tanpa data tetap terlihat jelas kosong
    const batang = s => tampil.map(b => ({ t: b.t, v: b[s] }));
    const opsi = { jenis: "batang", ember, labelWaktu, pesanKosong, tren: false };
    grafikRiwayat.angin.setData(batang("angin"), rentang, opsi);
    grafikRiwayat.hujan.setData(batang("hujan"), rentang, opsi);
    grafikRiwayat.cahaya.setData(batang("cahaya"), rentang, opsi);
    judul("judul-angin", "Kecepatan angin, rata-rata per hari", "m/s");
    judul("judul-hujan", "Curah hujan per hari", "mm");
    judul("judul-cahaya", "Intensitas cahaya, rata-rata per hari", "lux");
  } else {
    const celah = mode === "asli" ? 3 * MENIT : ember * 1.5;
    const geser = mode === "asli" ? 0 : ember / 2;      // titik rata-rata di tengah periodenya
    const seri = s => tampil.map(b => ({ t: b.t + geser, v: b[s] }));
    const opsi = { jenis: "garis", celah, labelWaktu, pesanKosong, tren: mode === "asli" };
    grafikRiwayat.angin.setData(seri("angin"), rentang, opsi);
    grafikRiwayat.cahaya.setData(seri("cahaya"), rentang, opsi);
    if (mode === "asli") {
      grafikRiwayat.hujan.setData(tampil.map(b => ({ t: b.t, v: b.hujanBersih })), rentang,
                                  { ...opsi, jenis: "tangga", tren: false });
      judul("judul-angin", "Kecepatan angin", "m/s");
      judul("judul-hujan", "Curah hujan, akumulasi harian", "mm");
      judul("judul-cahaya", "Intensitas cahaya", "lux");
    } else {
      grafikRiwayat.hujan.setData(tampil.map(b => ({ t: b.t, v: b.hujan })), rentang,
                                  { jenis: "batang", ember, labelWaktu, pesanKosong, tren: false });
      judul("judul-angin", "Kecepatan angin, rata-rata per jam", "m/s");
      judul("judul-hujan", "Curah hujan per jam", "mm");
      judul("judul-cahaya", "Intensitas cahaya, rata-rata per jam", "lux");
    }
  }

  // Jumlah data yang tersimpan: per jam untuk rentang pendek, per hari untuk rekap harian
  const emberData = mode === "hari" ? HARI : JAM;
  const hitung = new Map();
  for (const b of baris) {
    const kk = Math.floor(b.t / emberData) * emberData;
    hitung.set(kk, (hitung.get(kk) || 0) + 1);
  }
  const seriData = [...hitung].sort((p, q) => p[0] - q[0]).map(([t, v]) => ({ t, v }));
  grafikRiwayat.data.setData(seriData, rentang, {
    jenis: "batang", ember: emberData, pesanKosong, tren: false,
    labelWaktu: emberData === HARI ? t => tgl(t) : t => `${tgl(t, false)} ${jam(t)} sampai ${jam(t + JAM)}`
  });
  judul("judul-data", "Jumlah data tercatat", emberData === HARI ? "per hari" : "per jam");
}

function isiRingkasan() {
  const b = riwayat.baris;
  const rata = s => b.length ? b.reduce((j, x) => j + x[s], 0) / b.length : NaN;
  const maks = s => b.length ? b.reduce((m, x) => Math.max(m, x[s]), 0) : NaN;
  const total = b.length ? b.reduce((j, x) => j + x.naik, 0) : NaN;
  const butir = (label, nilai) => `<div><dt>${label}</dt><dd>${nilai}</dd></div>`;

  $("ringkas-angin").innerHTML  = butir("Rata-rata", angka(rata("angin"), 2)) + butir("Tertinggi", angka(maks("angin"), 2));
  $("ringkas-hujan").innerHTML  = butir("Total", angka(total, 2));
  $("ringkas-cahaya").innerHTML = butir("Rata-rata", angka(rata("cahaya"), 0)) + butir("Tertinggi", angka(maks("cahaya"), 0));

  // Kelengkapan: data tersimpan dibanding seharusnya (1 data per menit sampai sekarang)
  const seharusnya = Math.max(0, (Math.min(riwayat.sampai + HARI, sekarangWIB()) - riwayat.dari) / MENIT);
  const lengkap = seharusnya ? Math.min(100, (b.length / seharusnya) * 100) : NaN;
  $("ringkas-data").innerHTML = butir("Total", b.length.toLocaleString("id-ID")) +
    butir("Kelengkapan", Number.isFinite(lengkap) ? `${angka(lengkap, 0)}%` : "–");
}

function kolomTabel() {
  if (riwayat.mode === "asli") {
    return {
      kepala: ["Waktu", "Angin (m/s)", "Hujan tercatat hari itu (mm)", "Cahaya (lux)"],
      baris: b => [`${tgl(b.t)} ${jam(b.t, true)}`, angka(b.angin, 2), angka(b.hujan, 2), angka(b.cahaya, 0)],
      csv:   b => [`${tgl(b.t)} ${jam(b.t, true)}`, b.angin.toFixed(2), b.hujan.toFixed(2), b.cahaya.toFixed(2)]
    };
  }
  const perJam = riwayat.mode === "jam";
  const waktu = b => perJam ? `${tgl(b.t)} ${jam(b.t)} sampai ${jam(b.t + JAM)}` : tgl(b.t);
  return {
    kepala: [perJam ? "Jam" : "Tanggal", "Angin rata-rata (m/s)", "Angin tertinggi (m/s)",
             "Hujan (mm)", "Cahaya rata-rata (lux)", "Jumlah data"],
    baris: b => [waktu(b), angka(b.angin, 2), angka(b.anginMaks, 2), angka(b.hujan, 2), angka(b.cahaya, 0),
                 b.n.toLocaleString("id-ID")],
    csv:   b => [waktu(b), b.angin.toFixed(2), b.anginMaks.toFixed(2), b.hujan.toFixed(2), b.cahaya.toFixed(2), b.n]
  };
}

function isiTabel() {
  const kol = kolomTabel(), semua = riwayat.tampil;
  const jumlahHal = Math.max(1, Math.ceil(semua.length / BARIS_PER_HALAMAN));
  riwayat.halaman = Math.min(Math.max(1, riwayat.halaman), jumlahHal);

  $("tabel-kepala").innerHTML = `<tr>${kol.kepala.map(k => `<th scope="col">${k}</th>`).join("")}</tr>`;

  // data terbaru di atas
  const awal = (riwayat.halaman - 1) * BARIS_PER_HALAMAN;
  const potong = [];
  for (let i = semua.length - 1 - awal; i >= 0 && potong.length < BARIS_PER_HALAMAN; i--) potong.push(semua[i]);

  $("tabel-isi").innerHTML = potong.length
    ? potong.map(b => `<tr>${kol.baris(b).map(c => `<td>${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td class="kosong-tabel" colspan="${kol.kepala.length}">Tidak ada data pada rentang ini. Pilih tanggal lain lalu tekan Tampilkan.</td></tr>`;

  $("tabel-info").textContent = semua.length
    ? `${semua.length.toLocaleString("id-ID")} baris, data terbaru di atas.`
    : "Belum ada data.";
  $("hal-info").textContent = `Halaman ${riwayat.halaman} dari ${jumlahHal}`;
  $("hal-sebelum").disabled = riwayat.halaman <= 1;
  $("hal-berikut").disabled = riwayat.halaman >= jumlahHal;
  $("unduh-csv").disabled = semua.length === 0;
  $("hapus-buka").disabled = !riwayat.dari;      // aktif setelah ada rentang yang ditampilkan
}

function unduhCsv() {
  const kol = kolomTabel();
  // Pemisah titik koma dan desimal koma supaya langsung rapi di Excel berbahasa Indonesia
  const sel = v => String(v).replace(".", ",");
  const isi = [kol.kepala.join(";")]
    .concat(riwayat.tampil.map(b => kol.csv(b).map((v, i) => (i ? sel(v) : v)).join(";")))
    .join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + isi], { type: "text/csv;charset=utf-8" }));
  a.download = `histori_${isoTgl(riwayat.dari)}_sd_${isoTgl(riwayat.sampai)}_${riwayat.mode}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function tandaiCepat(dari, sampai) {
  const hariIni = awalHari(sekarangWIB());
  document.querySelectorAll("[data-cepat]").forEach(tombol => {
    const n = +tombol.dataset.cepat;
    const cocok = n === 0 ? dari === hariIni && sampai === hariIni
                : n === 1 ? dari === hariIni - HARI && sampai === hariIni - HARI
                : dari === hariIni - (n - 1) * HARI && sampai === hariIni;
    tombol.setAttribute("aria-pressed", cocok);
  });
}

function setRentangCepat(n) {
  const hariIni = awalHari(sekarangWIB());
  const [dari, sampai] = n === 0 ? [hariIni, hariIni]
                       : n === 1 ? [hariIni - HARI, hariIni - HARI]
                       : [hariIni - (n - 1) * HARI, hariIni];
  $("tgl-dari").value = isoTgl(dari);
  $("tgl-sampai").value = isoTgl(sampai);
  tampilkanRiwayat();
}

// ============================================================
// HAPUS DATA HISTORI
// Yang dihapus: semua data /weather/histori pada rentang tanggal yang sedang
// ditampilkan. Pembacaan Live (/weather/keadaan_sekarang) tidak disentuh.
// Urutannya: hitung data -> masuk akun Firebase -> ketik HAPUS -> hapus.
// ============================================================

const hapus = { kunci: [], sibuk: false, dari: 0, sampai: 0 };

function pesanHapus(teks, proses = false) {
  const p = $("dlg-pesan");
  p.textContent = teks;
  p.classList.toggle("proses", proses);
}

function perbaruiTombolHapus() {
  const n = hapus.kunci.length;
  const siap = n > 0 && !hapus.sibuk && $("dlg-ketik").value.trim() === KATA_HAPUS;
  const tombol = $("dlg-hapus-ya");
  tombol.disabled = !siap;
  tombol.textContent = n ? `Hapus ${n.toLocaleString("id-ID")} data` : "Hapus data";
  $("dlg-batal").disabled = hapus.sibuk;
}

async function perbaruiAkun() {
  let email = null;
  try { email = await sumber.akun(); } catch (e) { /* dianggap belum masuk */ }
  $("dlg-masuk").hidden = !!email;
  $("dlg-akun").hidden = !email;
  $("dlg-akun-email").textContent = email || "";
  return email;
}

async function bukaHapus() {
  if (!sumber || !riwayat.dari) return;
  Object.assign(hapus, { kunci: [], sibuk: false, dari: riwayat.dari, sampai: riwayat.sampai });
  $("dlg-ketik").value = "";
  $("dlg-sandi").value = "";
  pesanHapus("");
  $("dlg-ringkas").textContent = "Menghitung data pada rentang ini…";
  perbaruiTombolHapus();
  $("dlg-hapus").showModal();
  perbaruiAkun();

  const rentangTeks = hapus.dari === hapus.sampai ? `tanggal ${tgl(hapus.dari)}`
                                                  : `tanggal ${tgl(hapus.dari)} sampai ${tgl(hapus.sampai)}`;
  try {
    hapus.kunci = await sumber.kunciHistori(hapus.dari, hapus.sampai + HARI - 1000);
    $("dlg-ringkas").textContent = hapus.kunci.length
      ? `${hapus.kunci.length.toLocaleString("id-ID")} data histori ${rentangTeks} akan dihapus dari Firebase.`
      : `Tidak ada data histori pada ${rentangTeks}, jadi tidak ada yang bisa dihapus.`;
  } catch (e) {
    $("dlg-ringkas").textContent = "Jumlah data gagal dihitung. " + jelaskanGalat(e);
  }
  perbaruiTombolHapus();
}

function jelaskanGalatHapus(e) {
  const kode = String((e && (e.code || e.message)) || e);
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/i.test(kode)) return "Email atau password salah.";
  if (/too-many-requests/i.test(kode)) return "Terlalu banyak percobaan masuk. Tunggu beberapa menit lalu coba lagi.";
  if (/permission/i.test(kode)) return "Firebase menolak penghapusan. Periksa Rules: akun yang masuk harus diizinkan menulis ke /weather.";
  if (/network/i.test(kode)) return "Sambungan internet terputus. Coba lagi.";
  return "Gagal: " + kode;
}

async function jalankanHapus(e) {
  e.preventDefault();
  if (hapus.sibuk || $("dlg-ketik").value.trim() !== KATA_HAPUS || !hapus.kunci.length) return;
  hapus.sibuk = true;
  perbaruiTombolHapus();
  const n = hapus.kunci.length;
  let terhapus = 0;
  try {
    if (!(await sumber.akun())) {
      const email = $("dlg-email").value.trim(), sandi = $("dlg-sandi").value;
      if (!email || !sandi) { pesanHapus("Isi email dan password akun Firebase dulu."); return; }
      pesanHapus("Memeriksa akun…", true);
      await sumber.masuk(email, sandi);
      $("dlg-sandi").value = "";
      await perbaruiAkun();
    }
    await sumber.hapusKunci(hapus.kunci, sudah => {
      terhapus = sudah;
      pesanHapus(`Menghapus ${sudah.toLocaleString("id-ID")} dari ${n.toLocaleString("id-ID")} data…`, true);
    });
    $("dlg-hapus").close();
    peringatan("hapus", `${n.toLocaleString("id-ID")} data histori sudah dihapus dari Firebase.` +
                        (DEMO ? " (Mode contoh: tidak ada data yang benar-benar dihapus.)" : ""), "info");
    setTimeout(() => peringatan("hapus", null), 10000);
    tampilkanRiwayat();
  } catch (err) {
    pesanHapus(jelaskanGalatHapus(err) + (terhapus ? ` Sudah terhapus ${terhapus.toLocaleString("id-ID")} data.` : ""));
  } finally {
    hapus.sibuk = false;
    perbaruiTombolHapus();
  }
}

// ============================================================
// TAB
// ============================================================

let riwayatDimuat = false;

function bukaTab(nama) {
  if (!["live", "grafik", "histori"].includes(nama)) nama = "live";
  document.querySelectorAll(".tab button").forEach(t => t.setAttribute("aria-selected", t.dataset.tab === nama));
  for (const n of ["live", "grafik", "histori"]) $("panel-" + n).hidden = n !== nama;
  $("saring").hidden = nama === "live";
  if (location.hash.slice(1) !== nama) {
    try { history.replaceState(null, "", "#" + nama); } catch (e) { /* halaman dibuka di bingkai pratinjau */ }
  }

  if (nama !== "live" && !riwayatDimuat && sumber) { riwayatDimuat = true; setRentangCepat(0); }
  semuaGrafik.forEach(g => g.gambar());       // grafik di tab tersembunyi belum punya lebar
  adegan.mulai();
}

// ============================================================
// SUMBER DATA: FIREBASE
// ============================================================

function jelaskanGalat(e) {
  const kode = String((e && (e.code || e.message)) || e);
  if (/permission/i.test(kode)) {
    return "Firebase menolak akses baca. Buka Firebase Console, Realtime Database, Rules, lalu izinkan baca untuk /weather.";
  }
  return "Periksa sambungan internet, lalu muat ulang halaman.";
}

function barisDari(kunci, val) {
  if (!val || typeof val !== "object") return null;
  const t = uraiWaktu(val.waktu) ?? uraiKunci(kunci);
  if (t === null) return null;
  return { t, angin: bersih(val.anemometer), hujan: bersih(val.rain_gauge), cahaya: bersih(val.sensor_cahaya) };
}

async function mulaiFirebase() {
  const dasar = `https://www.gstatic.com/firebasejs/${VERSI_FIREBASE}`;
  let fbApp, fbDb;
  try {
    [fbApp, fbDb] = await Promise.all([import(`${dasar}/firebase-app.js`), import(`${dasar}/firebase-database.js`)]);
  } catch (e) {
    setStatus("terputus", "Tidak bisa memuat Firebase");
    peringatan("muat", "Library Firebase gagal dimuat. Periksa sambungan internet, lalu muat ulang halaman.");
    return;
  }
  const { getDatabase, ref, onValue, query, orderByKey, startAt, endAt, limitToLast, get, update } = fbDb;
  const aplikasi = fbApp.initializeApp(firebaseConfig);
  const db = getDatabase(aplikasi);

  // Login hanya dimuat saat tombol "Hapus data" dipakai.
  // Sesi login berakhir saat tab browser ditutup.
  let modAuth = null, auth = null;
  async function siapAuth() {
    if (!auth) {
      modAuth = await import(`${dasar}/firebase-auth.js`);
      const a = modAuth.getAuth(aplikasi);
      await modAuth.setPersistence(a, modAuth.browserSessionPersistence);
      await a.authStateReady();
      auth = a;
    }
    return auth;
  }

  async function bacaHistori(dari, sampai) {
    const q = query(ref(db, JALUR_HISTORI), orderByKey(), startAt(kunciDari(dari)), endAt(kunciDari(sampai)));
    const snap = await get(q);
    const hasil = [];
    snap.forEach(anak => { const b = barisDari(anak.key, anak.val()); if (b) hasil.push(b); });
    return hasil.sort((a, b) => a.t - b.t);
  }
  const rentangKunci = (dari, sampai) =>
    query(ref(db, JALUR_HISTORI), orderByKey(), startAt(kunciDari(dari)), endAt(kunciDari(sampai)));

  sumber = {
    bacaHistori,
    async dataTerakhir() {
      const snap = await get(query(ref(db, JALUR_HISTORI), orderByKey(), limitToLast(1)));
      let t = null;
      snap.forEach(anak => { const b = barisDari(anak.key, anak.val()); if (b) t = b.t; });
      return t;
    },
    async kunciHistori(dari, sampai) {
      const kunci = [];
      (await get(rentangKunci(dari, sampai))).forEach(anak => { kunci.push(anak.key); });
      return kunci;
    },
    async akun() { const a = await siapAuth(); return a.currentUser ? a.currentUser.email : null; },
    async masuk(email, sandi) { await modAuth.signInWithEmailAndPassword(await siapAuth(), email, sandi); },
    async keluar() { await modAuth.signOut(await siapAuth()); },
    async hapusKunci(kunci, kemajuan) {
      const PAKET = 400;                       // dihapus bertahap supaya tidak terlalu besar
      for (let i = 0; i < kunci.length; i += PAKET) {
        const paket = {};
        for (const k of kunci.slice(i, i + PAKET)) paket[k] = null;
        await update(ref(db, JALUR_HISTORI), paket);
        kemajuan(Math.min(kunci.length, i + PAKET));
      }
    }
  };

  onValue(ref(db, JALUR_SEKARANG),
    snap => { peringatan("baca", null); terimaSekarang(snap.val()); },
    galat => { setStatus("terputus", "Data tidak bisa dibaca"); peringatan("baca", jelaskanGalat(galat)); });

  // Isi grafik Live dengan histori 15 menit terakhir supaya tidak mulai dari kosong
  const kini = sekarangWIB();
  bacaHistori(kini - JENDELA_LIVE_MENIT * MENIT, kini + MENIT).then(isiAwalLive).catch(() => {});

  if ($("panel-live").hidden) bukaTab(location.hash.slice(1));
}

// ============================================================
// SUMBER DATA: DEMO (angka contoh, hanya dengan ?demo)
// ============================================================

function mulaiDemo() {
  // Untuk pratinjau: ujiTampil({ angin, hujan, cahaya, laju }) mengganti angka & gambar sekaligus
  window.ujiTampil = o => {
    for (const s of DAFTAR) { $("nilai-" + s).textContent = angkaSensor(s, o[s]); perbaruiSkala(s, o[s]); }
    adegan.uji({ angin: o.angin, hujan: o.hujan, cahaya: o.cahaya, lajuPaksa: o.laju ?? null });
  };
  const acak  = n => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const halus = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return acak(i) * (1 - u) + acak(i + 1) * u; };

  // Alat "mati" pada sebagian hari dan jam, supaya tampilan data bolong ikut teruji
  const hariIniDemo = Math.floor(sekarangWIB() / HARI);
  function mati(t) {
    const hari = Math.floor(t / HARI), jamKe = Math.floor(t / JAM);
    if (jamKe === Math.floor(sekarangWIB() / JAM)) return false;
    if (hari !== hariIniDemo && acak(hari + 0.13) < 0.3) return true;
    return acak(jamKe * 0.917 + 0.77) < 0.08;
  }

  function contoh(t, gangguan = false) {
    const hari = Math.floor(t / HARI), j = (t % HARI) / JAM;
    const matahari = Math.max(0, Math.sin(((j - 6) / 12) * Math.PI));
    const awan = 0.4 + 0.6 * halus(t / (18 * MENIT));
    const cahaya = j < 5.8 || j > 18.2 ? 1 + 4 * halus(t / MENIT) : 96000 * Math.pow(matahari, 1.25) * awan + 40;

    let angin = 1.9 + 3.4 * Math.max(0, Math.sin(((j - 8) / 12) * Math.PI)) + 2.6 * (halus(t / (6 * MENIT)) - 0.5);
    if (angin < 1.45) angin = 0;

    let hujan = 0;
    if (acak(hari + 0.31) < 0.65) {
      const mulai = 13 + 4 * acak(hari + 0.5), lama = 0.5 + 1.5 * acak(hari + 0.7), total = 3 + 34 * acak(hari + 0.9);
      const p = Math.min(1, Math.max(0, (j - mulai) / lama));
      hujan = Math.round((total * p * p * (3 - 2 * p)) / 0.25) * 0.25;
    }
    // contoh gangguan kabel: angka hujan melonjak puluhan mm per menit (harus diabaikan grafik)
    if (gangguan && hari !== hariIniDemo && hari % 9 === 4 && j >= 10) hujan += Math.min(20, (j - 10) * 60) * 40;
    return { t, angin: +angin.toFixed(2), hujan, cahaya: +cahaya.toFixed(2) };
  }

  let akunDemo = null;
  const tunda = ms => new Promise(r => setTimeout(r, ms));
  sumber = {
    async bacaHistori(dari, sampai) {
      const hasil = [], akhir = Math.min(sampai, sekarangWIB());
      for (let t = Math.ceil(dari / MENIT) * MENIT; t <= akhir; t += MENIT) if (!mati(t)) hasil.push(contoh(t, true));
      return hasil;
    },
    async dataTerakhir() {
      for (let t = Math.floor(sekarangWIB() / MENIT) * MENIT, n = 0; n < 60 * 24 * 40; t -= MENIT, n++) if (!mati(t)) return t;
      return null;
    },
    async kunciHistori(dari, sampai) { return (await this.bacaHistori(dari, sampai)).map(b => kunciDari(b.t)); },
    async akun() { return akunDemo; },
    async masuk(email) { await tunda(300); akunDemo = email; },
    async keluar() { akunDemo = null; },
    async hapusKunci(kunci, kemajuan) {      // pura-pura: tidak ada yang dihapus
      for (let i = 0; i < kunci.length; i += 400) { await tunda(120); kemajuan(Math.min(kunci.length, i + 400)); }
    }
  };

  peringatan("demo", "Mode contoh: semua angka di halaman ini buatan, bukan dari alat. Hapus ?demo dari alamat untuk melihat data asli.", "info");

  const kirim = () => {
    const t = Math.floor(sekarangWIB() / 1000) * 1000, c = contoh(t);
    terimaSekarang({ anemometer: c.angin, rain_gauge: c.hujan, sensor_cahaya: c.cahaya,
                     waktu: `${tgl(t)} ${jam(t, true)}` });
  };
  const kini = sekarangWIB();
  kirim();
  sumber.bacaHistori(kini - JENDELA_LIVE_MENIT * MENIT, kini - 5000).then(isiAwalLive);
  setInterval(kirim, 5000);
}

// ============================================================
// MULAI
// ============================================================

for (const s of DAFTAR) {
  bangunSkala(s);
  grafikLive[s] = buatGrafik($("grafik-live-" + s), {
    sensor: s, tinggi: 150, jenis: s === "hujan" ? "tangga" : "garis", celah: 2.5 * MENIT, titikAkhir: true,
    minMaks: s === "cahaya" ? 100 : s === "angin" ? 4 : 1,
    labelWaktu: t => jam(t, true),
    pesanKosong: "Grafik muncul setelah alat mengirim data."
  });
  grafikRiwayat[s] = buatGrafik($("grafik-" + s), {
    sensor: s, tinggi: 220, tandaSekarang: true, minMaks: s === "cahaya" ? 100 : s === "angin" ? 4 : 1,
    pesanKosong: "Pilih tanggal lalu tekan Tampilkan."
  });
}

grafikRiwayat.data = buatGrafik($("grafik-data"), {
  sensor: "data", tinggi: 160, tandaSekarang: true, minMaks: 4, jenis: "batang", ember: JAM,
  pesanKosong: "Pilih tanggal lalu tekan Tampilkan."
});

// Kursor di satu grafik histori ikut muncul di grafik lainnya
for (const s of DAFTAR_GRAFIK) {
  grafikRiwayat[s].padaKursor(t => DAFTAR_GRAFIK.forEach(lain => grafikRiwayat[lain].setKursor(t)));
}

document.querySelectorAll(".tab button").forEach(t => t.addEventListener("click", () => bukaTab(t.dataset.tab)));
window.addEventListener("hashchange", () => bukaTab(location.hash.slice(1)));

$("saring").addEventListener("submit", e => { e.preventDefault(); tampilkanRiwayat(); });
$("saring-info").addEventListener("click", e => {
  const tombol = e.target.closest("[data-lompat]");
  if (!tombol) return;
  $("tgl-dari").value = $("tgl-sampai").value = tombol.dataset.lompat;
  tampilkanRiwayat();
});
document.querySelectorAll("[data-cepat]").forEach(b => b.addEventListener("click", () => setRentangCepat(+b.dataset.cepat)));
$("hal-sebelum").addEventListener("click", () => { riwayat.halaman--; isiTabel(); });
$("hal-berikut").addEventListener("click", () => { riwayat.halaman++; isiTabel(); });
$("unduh-csv").addEventListener("click", unduhCsv);

$("hapus-buka").addEventListener("click", bukaHapus);
$("form-hapus").addEventListener("submit", jalankanHapus);
$("dlg-ketik").addEventListener("input", perbaruiTombolHapus);
$("dlg-batal").addEventListener("click", () => $("dlg-hapus").close());
$("dlg-keluar").addEventListener("click", async () => { await sumber.keluar(); perbaruiAkun(); });
$("dlg-hapus").addEventListener("cancel", e => { if (hapus.sibuk) e.preventDefault(); });   // Esc saat menghapus

const hariIni = awalHari(sekarangWIB());
$("tgl-dari").value = $("tgl-sampai").value = isoTgl(hariIni);
$("tgl-dari").max = $("tgl-sampai").max = isoTgl(hariIni);
isiTabel();

setInterval(perbaruiStatus, 1000);

if (DEMO) mulaiDemo(); else mulaiFirebase();
bukaTab(location.hash.slice(1));
