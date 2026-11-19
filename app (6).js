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
const DAFTAR = ["angin", "hujan", "cahaya"];

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
      buat("text", { class: "sekarang-teks", x: xs + 6, y: M.t + 12 }).textContent = "Sekarang";
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
        const xc = fx(d.t + o.ember / 2), y = fy(d.v), h = dasar - y, r = Math.min(4, lb / 2, h);
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
      const pakaiTren = o.jenis === "garis" && data.length > 150;
      const jendela = Math.max(5, Math.round(data.length / 90));

      for (const seg of potongan) {
        if (seg.length === 1) {
          buat("circle", { cx: fx(seg[0].t), cy: fy(seg[0].v), r: 2.5, fill: S.warna });
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
//  - angin  : kecepatan baling-baling turbin dan garis angin
//  - hujan  : banyak tetesan = laju hujan 10 menit terakhir, tabung = total hari ini
//  - cahaya : warna langit (malam, senja, siang), besar sinar matahari, kilau panel surya
// Warna langit di ketiga gambar ikut nilai cahaya, jadi malam hari semuanya gelap.
// ============================================================

const adegan = (() => {
  const gerakKurang = matchMedia("(prefers-reduced-motion: reduce)");
  const k = { angin: 0, hujan: 0, cahaya: 0, laju: 0, ada: false, lajuPaksa: null };
  const animasi = { sudut: 0, geser: 0, waktu: 0 };
  let berjalan = false, lalu = 0, hitungLajuTerakhir = 0;

  const acak = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
  const garisAngin = Array.from({ length: 16 }, () => ({ x: acak(), y: 0.08 + acak() * 0.55, p: 0.5 + acak() * 0.8 }));
  const tetes      = Array.from({ length: 170 }, () => ({ x: acak(), y: acak(), v: 0.75 + acak() * 0.5 }));
  const bintang    = Array.from({ length: 26 },  () => ({ x: acak(), y: acak() * 0.62, r: 0.6 + acak() * 1.1 }));

  const campur = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const rgb = (c, al = 1) => `rgba(${c.map(Math.round).join(",")},${al})`;
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const jepit = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  const MALAM = [hex("#0b1d3a"), hex("#1d3c68")];
  const SENJA = [hex("#2f64b5"), hex("#ff9a6b")];
  const SIANG = [hex("#0099ff"), hex("#8fd2ff")];
  const PUTIH = hex("#fdfdfe");
  const AMBER = hex("#ff3b1a");

  // 0 = malam, 1 = siang penuh (20.000 lux ke atas)
  const terang = () => k.ada ? jepit(Math.log10(k.cahaya + 1) / Math.log10(20001)) : 0.85;

  function warnaLangit(t) {
    return t < 0.5 ? [0, 1].map(i => campur(MALAM[i], SENJA[i], t / 0.5))
                   : [0, 1].map(i => campur(SENJA[i], SIANG[i], (t - 0.5) / 0.5));
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
    return { c, w, h };
  }

  function langit(c, w, h, t, gelap = 0) {
    let [atas, bawah] = warnaLangit(t);
    if (gelap) { const abu = hex("#5d6f86"); atas = campur(atas, abu, gelap); bawah = campur(bawah, abu, gelap); }
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgb(atas)); g.addColorStop(1, rgb(bawah));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const tampakBintang = jepit(1 - t / 0.35);
    if (tampakBintang > 0) {
      for (const b of bintang) {
        const kedip = 0.6 + 0.4 * Math.sin(animasi.waktu * 1.7 + b.x * 40);
        c.fillStyle = rgb(PUTIH, tampakBintang * kedip * 0.9);
        c.beginPath(); c.arc(b.x * w, b.y * h, b.r, 0, 7); c.fill();
      }
    }
    return { atas, bawah };
  }

  function bukit(c, w, h, t, tinggi, warna, al) {
    c.fillStyle = rgb(warna, al);
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) c.lineTo(x, h - tinggi - Math.sin(x / w * Math.PI * 1.3 + tinggi) * tinggi * 0.35);
    c.lineTo(w, h); c.closePath(); c.fill();
  }

  const warnaTanah = t => campur(hex("#17345a"), hex("#cfe6fb"), jepit(t * 1.2));

  function turbin(c, x, yDasar, tinggiMenara, skala, sudut, t) {
    const badan = campur(hex("#b9c9dc"), PUTIH, t);
    const atas = yDasar - tinggiMenara;
    c.fillStyle = rgb(badan);
    c.beginPath();
    c.moveTo(x - 4 * skala, yDasar); c.lineTo(x - 1.6 * skala, atas);
    c.lineTo(x + 1.6 * skala, atas); c.lineTo(x + 4 * skala, yDasar); c.closePath(); c.fill();
    const panjang = tinggiMenara * 0.62;
    for (let i = 0; i < 3; i++) {
      c.save(); c.translate(x, atas); c.rotate(sudut + i * (Math.PI * 2 / 3));
      c.beginPath();
      c.moveTo(0, -2.6 * skala);
      c.quadraticCurveTo(panjang * 0.35, -5.5 * skala, panjang, -0.6 * skala);
      c.lineTo(panjang, 0.6 * skala);
      c.quadraticCurveTo(panjang * 0.35, 2.2 * skala, 0, 2.6 * skala);
      c.closePath(); c.fill();
      c.restore();
    }
    c.fillStyle = rgb(AMBER);
    c.beginPath(); c.arc(x, atas, 3.6 * skala, 0, 7); c.fill();
  }

  function gambarAngin(dt) {
    const s = siapkan("adegan-angin"); if (!s) return;
    const { c, w, h } = s, t = terang();
    langit(c, w, h, t);
    const v = k.angin;

    // garis angin: makin kencang makin banyak dan cepat
    const banyak = Math.round(jepit(v / 7) * garisAngin.length);
    c.strokeStyle = rgb(PUTIH, 0.7); c.lineWidth = 1.6; c.lineCap = "round";
    for (let i = 0; i < banyak; i++) {
      const g = garisAngin[i];
      g.x += dt * (0.05 + v * 0.045) * g.p;
      if (g.x > 1.15) { g.x = -0.15; g.y = 0.08 + acak() * 0.55; }
      const panjang = (14 + v * 5) * g.p, x = g.x * w, y = g.y * h;
      c.beginPath(); c.moveTo(x - panjang, y);
      c.quadraticCurveTo(x - panjang * 0.4, y - 3, x, y); c.stroke();
    }

    const tanah = warnaTanah(t);
    bukit(c, w, h, t, h * 0.2, tanah, 0.45);
    turbin(c, w * 0.26, h * 0.86, h * 0.36, 0.7, animasi.sudut * 0.85 + 0.6, t);
    bukit(c, w, h, t, h * 0.11, tanah, 1);
    turbin(c, w * 0.64, h * 0.95, h * 0.58, 1.05, animasi.sudut, t);
  }

  function hitungLaju() {
    if (k.lajuPaksa !== null) return k.lajuPaksa;
    const seri = live.hujan;
    if (seri.length < 2) return 0;
    const akhir = seri[seri.length - 1], batas = akhir.t - 10 * MENIT;
    let awal = seri.find(d => d.t >= batas) || seri[0];
    let naik = akhir.v >= awal.v ? akhir.v - awal.v : akhir.v;   // angka sempat di-nol-kan
    const lama = Math.max(MENIT, akhir.t - awal.t);
    let laju = naik * (10 * MENIT / lama);
    // tip yang baru saja masuk (1,5 menit terakhir) tetap terlihat sebagai gerimis
    for (let i = seri.length - 1; i > 0 && seri[i].t > akhir.t - 90e3; i--) {
      if (seri[i].v > seri[i - 1].v) { laju = Math.max(laju, 0.3); break; }
    }
    return laju;
  }

  function awan(c, x, y, s, warna) {
    c.fillStyle = rgb(warna);
    c.beginPath();
    c.arc(x, y, 14 * s, Math.PI * 0.5, Math.PI * 1.5);
    c.arc(x + 14 * s, y - 10 * s, 15 * s, Math.PI, Math.PI * 1.85);
    c.arc(x + 34 * s, y - 6 * s, 13 * s, Math.PI * 1.2, Math.PI * 1.95);
    c.arc(x + 46 * s, y, 14 * s, Math.PI * 1.5, Math.PI * 0.5);
    c.closePath(); c.fill();
  }

  function gambarHujan(dt) {
    const s = siapkan("adegan-hujan"); if (!s) return;
    const { c, w, h } = s, t = terang();
    const now = performance.now();
    if (now - hitungLajuTerakhir > 1000) { k.laju = hitungLaju(); hitungLajuTerakhir = now; }
    const kuat = k.laju <= 0 ? 0 : jepit(0.18 + Math.log10(1 + k.laju) / Math.log10(1 + 8) * 0.82);

    langit(c, w, h, t, kuat * 0.55);
    const tanah = warnaTanah(t);
    const yTanah = h * 0.88;

    // tetesan
    const banyak = Math.round(kuat * tetes.length);
    c.strokeStyle = rgb(campur(PUTIH, hex("#cfe6ff"), 0.4), 0.85);
    c.lineWidth = 1.5; c.lineCap = "round";
    const lebarHujan = w - 56;
    for (let i = 0; i < banyak; i++) {
      const d = tetes[i];
      d.y += dt * (1.3 + kuat * 1.2) * d.v;
      if (d.y > 1) { d.y = 0; d.x = acak(); }
      const x = 8 + d.x * (lebarHujan - 8), y = h * 0.34 + d.y * (yTanah - h * 0.34);
      const p = 7 + kuat * 7;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - p * 0.22, y + p); c.stroke();
    }

    // awan: makin lebat makin abu-abu
    const warnaAwan = campur(campur(PUTIH, hex("#8796ab"), kuat), hex("#2a4366"), jepit(1 - t * 1.4) * 0.6);
    const geser = (animasi.geser * (4 + kuat * 10)) % (w + 120);
    const posisi = [[0.08, 0.32, 1.25], [0.46, 0.26, 1.05], [0.8, 0.36, 0.85]];
    for (const [px, py, sk] of posisi) {
      let x = ((px * (w + 120) + geser) % (w + 120)) - 80;
      awan(c, x, py * h, sk * (h / 150), warnaAwan);
    }

    // tanah
    c.fillStyle = rgb(tanah);
    c.fillRect(0, yTanah, w, h - yTanah);

    // tabung penakar: total hari ini (penuh = 50 mm)
    const tx = w - 34, ty = h * 0.22, tw = 18, th = yTanah - ty - 6;
    const isi = jepit(k.hujan / 50);
    c.fillStyle = rgb(PUTIH, 0.25); c.fillRect(tx, ty, tw, th);
    c.fillStyle = rgb(hex("#2a78d6"));
    c.fillRect(tx, ty + th * (1 - isi), tw, th * isi);
    c.strokeStyle = rgb(PUTIH); c.lineWidth = 2; c.strokeRect(tx, ty, tw, th);
    c.lineWidth = 1;
    for (const mm of [20, 50]) {
      const y = ty + th * (1 - mm / 50) + 0.5;
      c.beginPath(); c.moveTo(tx - 5, y); c.lineTo(tx, y); c.stroke();
    }
  }

  function gambarCahaya() {
    const s = siapkan("adegan-cahaya"); if (!s) return;
    const { c, w, h } = s, t = terang();
    const { atas } = langit(c, w, h, t);
    const cx = w * 0.5, cy = h * 0.42;

    const matahari = jepit((t - 0.15) / 0.2);       // 0 = bulan, 1 = matahari
    if (matahari < 1) {                              // bulan sabit
      const r = 15;
      c.globalAlpha = 1 - matahari;
      c.fillStyle = rgb(hex("#f4f1e4"));
      c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
      c.fillStyle = rgb(atas);
      c.beginPath(); c.arc(cx + 7, cy - 4, r * 0.92, 0, 7); c.fill();
      c.globalAlpha = 1;
    }
    if (matahari > 0) {
      const r = 13 + 9 * t;
      c.globalAlpha = matahari;
      const glow = c.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * (2 + 3 * t));
      glow.addColorStop(0, `rgba(255,226,122,${0.25 + 0.5 * t})`);
      glow.addColorStop(1, "rgba(255,226,122,0)");
      c.fillStyle = glow; c.beginPath(); c.arc(cx, cy, r * (2 + 3 * t), 0, 7); c.fill();

      c.strokeStyle = `rgba(255,230,140,${0.35 + 0.65 * t})`;
      c.lineWidth = 2.4; c.lineCap = "round";
      const putar = animasi.waktu * 0.25;
      for (let i = 0; i < 12; i++) {
        const a = putar + i * Math.PI / 6;
        const r1 = r + 6, r2 = r + 6 + (6 + 18 * t) * (i % 2 ? 0.65 : 1);
        c.beginPath(); c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); c.stroke();
      }
      const isi = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r);
      isi.addColorStop(0, "#fff6c4"); isi.addColorStop(1, "#ffc93a");
      c.fillStyle = isi; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
      c.globalAlpha = 1;
    }

    // tanah dan panel surya
    const yTanah = h * 0.86;
    c.fillStyle = rgb(warnaTanah(t)); c.fillRect(0, yTanah, w, h - yTanah);

    const pw = Math.min(150, w * 0.42), ph = h * 0.2, px = w * 0.5 - pw / 2, py = yTanah - ph - 8, miring = pw * 0.12;
    c.fillStyle = rgb(campur(hex("#9fb3c8"), PUTIH, t));
    c.fillRect(w * 0.5 - 2, py + ph, 4, yTanah - py - ph);
    const sudut = [[px + miring, py], [px + pw + miring, py], [px + pw, py + ph], [px, py + ph]];
    c.fillStyle = "#123a6b";
    c.beginPath(); sudut.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill();

    // kilau bergerak, makin terang makin jelas
    c.save(); c.clip();
    const kilauX = px + ((animasi.waktu * 40) % (pw * 2.2)) - pw * 0.6;
    const kilau = c.createLinearGradient(kilauX, 0, kilauX + pw * 0.4, 0);
    kilau.addColorStop(0, "rgba(255,255,255,0)");
    kilau.addColorStop(0.5, `rgba(255,255,255,${0.55 * t})`);
    kilau.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = kilau; c.fillRect(px, py, pw + miring, ph);
    c.restore();

    c.strokeStyle = "rgba(255,255,255,0.45)"; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const f = i / 4;
      c.beginPath(); c.moveTo(px + miring + pw * f, py); c.lineTo(px + pw * f, py + ph); c.stroke();
    }
    c.beginPath(); c.moveTo(px + miring / 2, py + ph / 2); c.lineTo(px + pw + miring / 2, py + ph / 2); c.stroke();
  }

  function gambarSemua(dt) {
    animasi.waktu += dt;
    animasi.geser += dt;
    const omega = k.angin < 0.3 ? 0 : Math.min(k.angin, 16) * 0.9;   // rad per detik
    animasi.sudut = (animasi.sudut + omega * dt) % (Math.PI * 2);
    gambarAngin(dt); gambarHujan(dt); gambarCahaya();
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
function tambahKenaikanHujan(baris) {
  let hariLalu = null, lalu = 0;
  for (const b of baris) {
    const h = awalHari(b.t);
    if (h !== hariLalu) { hariLalu = h; b.naik = b.hujan; }
    else b.naik = Math.max(0, b.hujan - lalu);
    lalu = b.hujan;
  }
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

  tambahKenaikanHujan(baris);
  const mode = pilihMode(jumlahHari);
  Object.assign(riwayat, { baris, mode, dari, sampai, halaman: 1 });
  riwayat.tampil = mode === "asli" ? baris : kelompokkan(baris, mode === "jam" ? JAM : HARI);

  const namaMode = { asli: "data asli per menit", jam: "rata-rata per jam", hari: "rekap per hari" }[mode];
  const rentangTeks = dari === sampai ? tgl(dari) : `${tgl(dari)} sampai ${tgl(sampai)}`;
  info.textContent = baris.length
    ? `${baris.length.toLocaleString("id-ID")} pembacaan, ${rentangTeks}. Ditampilkan sebagai ${namaMode}.`
    : `Tidak ada data pada ${rentangTeks}.`;

  gambarRiwayat();
  isiRingkasan();
  isiTabel();
}

function gambarRiwayat() {
  const { tampil, mode, dari, sampai } = riwayat;
  const rentang = [dari, sampai + HARI];
  const ember = mode === "jam" ? JAM : HARI;
  const labelWaktu = {
    asli: t => `${tgl(t, false)} ${jam(t)}`,
    jam:  t => `${tgl(t, false)} ${jam(t)} sampai ${jam(t + JAM)}`,
    hari: t => tgl(t)
  }[mode];
  const celah = mode === "asli" ? 3 * MENIT : ember * 1.5;
  const pesanKosong = "Tidak ada data pada rentang ini. Pilih tanggal lain.";

  // Titik rata-rata diletakkan di tengah periodenya
  const geser = mode === "asli" ? 0 : ember / 2;
  const seri = s => tampil.map(b => ({ t: b.t + geser, v: b[s] }));

  grafikRiwayat.angin.setData(seri("angin"), rentang, { jenis: "garis", celah, labelWaktu, pesanKosong });
  grafikRiwayat.cahaya.setData(seri("cahaya"), rentang, { jenis: "garis", celah, labelWaktu, pesanKosong });

  if (mode === "asli") {
    grafikRiwayat.hujan.setData(seri("hujan"), rentang, { jenis: "tangga", celah, labelWaktu, pesanKosong });
    $("judul-hujan").innerHTML = `Curah hujan, akumulasi harian <span class="satuan-judul">mm</span>`;
  } else {
    grafikRiwayat.hujan.setData(tampil.map(b => ({ t: b.t, v: b.hujan })), rentang,
                                { jenis: "batang", ember, labelWaktu, pesanKosong });
    $("judul-hujan").innerHTML =
      `Curah hujan per ${mode === "jam" ? "jam" : "hari"} <span class="satuan-judul">mm</span>`;
  }
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
}

function kolomTabel() {
  if (riwayat.mode === "asli") {
    return {
      kepala: ["Waktu", "Angin (m/s)", "Hujan hari itu (mm)", "Cahaya (lux)"],
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
  const { getDatabase, ref, onValue, query, orderByKey, startAt, endAt, get, update } = fbDb;
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

  function contoh(t) {
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
    return { t, angin: +angin.toFixed(2), hujan, cahaya: +cahaya.toFixed(2) };
  }

  let akunDemo = null;
  const tunda = ms => new Promise(r => setTimeout(r, ms));
  sumber = {
    async bacaHistori(dari, sampai) {
      const hasil = [], akhir = Math.min(sampai, sekarangWIB());
      for (let t = Math.ceil(dari / MENIT) * MENIT; t <= akhir; t += MENIT) hasil.push(contoh(t));
      return hasil;
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

// Kursor di satu grafik histori ikut muncul di dua grafik lainnya
for (const s of DAFTAR) {
  grafikRiwayat[s].padaKursor(t => DAFTAR.forEach(lain => grafikRiwayat[lain].setKursor(t)));
}

document.querySelectorAll(".tab button").forEach(t => t.addEventListener("click", () => bukaTab(t.dataset.tab)));
window.addEventListener("hashchange", () => bukaTab(location.hash.slice(1)));

$("saring").addEventListener("submit", e => { e.preventDefault(); tampilkanRiwayat(); });
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
