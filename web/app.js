// Student app: the pick flow (CLAUDE.md 5.1), pantry device setup (docs/PLAN.md 5.4) and the offline
// queue on pantry devices (CLAUDE.md section 9). Student IDs are never logged, put in URLs, or shown in full.
import { api, ApiFailure } from './lib/api.js';
import * as store from './lib/store.js';
import { Scanner, cameraAvailable } from './lib/scanner.js';

const app = document.getElementById('app');
const banner = document.getElementById('banner');
const REMEMBER_KEY = 'foodbank.student';
const PANTRY_KEY = 'foodbank.pantry';

const state = {
  device: null, // Set on pantry devices: {device_id, device_key, label, location_id, location_name}.
  pantryId: '', // Student phones: from the QR poster link.
  catalog: null,
  photos: {},
  student: null,
  basket: [],
  unknown: [],
  online: navigator.onLine,
  pending: 0,
};
let queue = null;
let scanner = null;
let idleTimer = null;
let wedge = null;

// ---------- Small helpers ----------

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.keys(props || {}).forEach((key) => {
    const value = props[key];
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = true;
    else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  });
  children.flat(Infinity).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

/** Bilingual text: BM first, English below in a lighter style. */
function bi(ms, en, tag) {
  return el(tag || 'span', { class: 'bi' }, el('span', { lang: 'ms' }, ms), el('span', { lang: 'en', class: 'en' }, en));
}

function errorText(err) {
  if (err instanceof ApiFailure) return bi(err.ms, err.message);
  return bi('Maaf, berlaku ralat. Sila cuba lagi.', 'Sorry, something went wrong. Please try again.');
}

function call(action, payload) {
  return api(action, payload, { device: state.device, pantryId: state.pantryId }).then(
    (data) => { setOnline(true); return data; },
    (err) => {
      if (err.network) setOnline(false);
      if (err.code === 'DEVICE_REVOKED' && state.device) forgetDevice();
      throw err;
    }
  );
}

function newUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

const settings = () => (state.catalog ? state.catalog.settings : {});
const itemById = (id) => state.catalog.items.filter((i) => i.item_id === id)[0];
const pantryName = () => (state.device ? state.device.location_name : state.catalog && state.catalog.location ? state.catalog.location.name : '');

function readRemembered() {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
  } catch (err) {
    return null;
  }
}

function writeRemembered(student) {
  try {
    if (student) localStorage.setItem(REMEMBER_KEY, JSON.stringify(student));
    else localStorage.removeItem(REMEMBER_KEY);
  } catch (err) {
    // Private browsing: nothing is remembered.
  }
}

// ---------- Connection banner and status ----------

function setOnline(online) {
  state.online = online;
  updateBanner();
}

function updateBanner() {
  if (state.online) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.replaceChildren(state.device
    ? bi('Mod luar talian: lawatan disimpan pada peranti ini dan dihantar apabila ada sambungan.', 'Offline mode: visits are saved on this device and sent when the connection is back.')
    : bi('Tiada sambungan internet. Sila gunakan peranti pantri.', 'No internet connection. Please use the pantry device.'));
}

async function refreshPending() {
  if (!queue) return;
  const entries = await queue.entries();
  state.pending = entries.length;
  const status = document.getElementById('status');
  if (status) status.replaceChildren(statusText());
}

function statusText() {
  const parts = [pantryName()];
  if (state.device) parts.push(state.device.label, state.pending ? state.pending + ' menunggu / waiting' : 'semua dihantar / all sent');
  return parts.filter(Boolean).join(' · ');
}

// ---------- Idle reset ----------

function startIdleTimer() {
  stopIdleTimer();
  const seconds = settings().inactivity_seconds || 60;
  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => endVisit(), seconds * 1000);
  };
  reset();
  document.addEventListener('pointerdown', reset, true);
  document.addEventListener('keydown', reset, true);
  startIdleTimer.reset = reset;
}

function stopIdleTimer() {
  clearTimeout(idleTimer);
  if (startIdleTimer.reset) {
    document.removeEventListener('pointerdown', startIdleTimer.reset, true);
    document.removeEventListener('keydown', startIdleTimer.reset, true);
  }
}

function leaveScreen() {
  if (scanner) {
    scanner.stop();
    scanner = null;
  }
  if (wedge) {
    document.removeEventListener('keydown', wedge, true);
    wedge = null;
  }
  stopIdleTimer();
}

function endVisit() {
  state.student = null;
  state.basket = [];
  state.unknown = [];
  renderStart();
}

const APP_NAME = 'Food Bank UiTMCPP';

// Fixed icon markup (never user data), turned into SVG elements.
const ICONS = {
  basket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10h15l-1.5 8.3a2 2 0 0 1-2 1.7H8a2 2 0 0 1-2-1.7z"/><path d="M9 10l2.5-5.5M15 10l-2.5-5.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

function icon(name) {
  const holder = document.createElement('span');
  holder.innerHTML = ICONS[name];
  return holder.firstElementChild;
}

function brandBar() {
  return el('div', { class: 'brand' },
    el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('basket')),
    el('span', { class: 'brand-name' }, APP_NAME),
    pantryName() ? el('span', { class: 'pill' }, pantryName()) : null);
}

function screen(...children) {
  leaveScreen();
  app.replaceChildren(el('div', { class: 'screen' }, brandBar(), ...children));
  window.scrollTo(0, 0);
}

function footer() {
  return el('footer', null,
    state.device ? el('p', { id: 'status', class: 'muted' }, statusText()) : null,
    el('p', null, state.device
      ? el('button', { class: 'link', onclick: renderSync }, 'Status penghantaran / Sync status')
      : el('button', { class: 'link', onclick: renderSetup }, 'Pantry device setup (staff)')));
}

// ---------- Screens ----------

function renderMessage(ms, en, retry) {
  screen(el('section', { class: 'card center' },
    bi(ms, en, 'p'),
    retry ? el('button', { class: 'primary', onclick: retry }, bi('Cuba lagi', 'Try again')) : null),
    footer());
}

function privacyNotice() {
  const namelist = settings().student_mode === 'ROSTER';
  return el('details', { class: 'notice' },
    el('summary', null, bi('Notis privasi', 'Privacy notice')),
    namelist
      ? bi('Kami menggunakan ID pelajar anda untuk mendapatkan nama dan program anda daripada senarai nama pelajar (atau meminta nama dan fakulti anda jika anda tiada dalam senarai), dan merekod barang yang anda ambil. Tujuannya supaya rekod tepat dan Bahagian Hal Ehwal Pelajar (HEP) boleh menghubungi anda jika anda memerlukan bantuan lanjut. Rekod disimpan selama 1 tahun selepas lawatan terakhir anda dan hanya boleh dilihat oleh staf yang dibenarkan.',
        'We use your student ID to find your name and programme in the student namelist (or ask for your name and faculty if you are not on it), and record the items you take. This keeps records accurate and lets Student Affairs (HEP) contact you if you need more help. Records are kept for 1 year after your last visit and only authorised staff can see them.', 'p')
      : bi('Kami merekod ID pelajar, nama dan fakulti anda serta barang yang anda ambil, supaya rekod tepat dan Bahagian Hal Ehwal Pelajar (HEP) boleh menghubungi anda jika anda memerlukan bantuan lanjut. Rekod disimpan selama 1 tahun selepas lawatan terakhir anda dan hanya boleh dilihat oleh staf yang dibenarkan.',
        'We record your student ID, name, faculty and the items you take, to keep accurate records and so that Student Affairs (HEP) can contact you if you need more help. Records are kept for 1 year after your last visit and only authorised staff can see them.', 'p'));
}

/** The student shown in screen headers: name and programme once known, otherwise the masked ID. */
function studentLine() {
  const s = state.student;
  if (!s.name) return 'ID ' + StudentId.mask(s.id);
  return Names.display(s.name) + (s.program ? ' · ' + s.program : '');
}

function initials(name) {
  const words = Names.display(name).split(' ').filter((w) => /^[A-Za-z]/.test(w) && !/^(bin|binti|bt|bte)$/.test(w));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function renderStart() {
  if (!state.catalog) return;
  const remembered = state.device ? null : readRemembered();
  const input = el('input', {
    id: 'student-id', inputmode: 'numeric', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    maxlength: '20', value: remembered ? remembered.id : '', 'aria-describedby': 'id-error',
  });
  const error = el('p', { id: 'id-error', class: 'error', role: 'alert' });
  const next = el('button', { class: 'primary big', type: 'submit' }, bi('Seterusnya', 'Next'));
  const form = el('form', { class: 'card', novalidate: true },
    el('label', { for: 'student-id' }, bi('Masukkan atau imbas ID pelajar anda', 'Enter or scan your student ID')),
    input, error, next,
    remembered ? el('button', { class: 'link', type: 'button', onclick: () => { writeRemembered(null); renderStart(); } },
      bi('Bukan anda? Padam butiran tersimpan', 'Not you? Clear saved details')) : null);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = StudentId.normalise(input.value);
    if (!StudentId.isValid(id, settings().student_id_pattern)) {
      error.replaceChildren(bi('ID pelajar tidak sah. Sila semak dan cuba lagi.', 'That student ID is not valid. Please check it and try again.'));
      input.focus();
      return;
    }
    const rememberedForId = remembered && remembered.id === id ? remembered : null;
    state.student = { id };
    if (settings().student_mode !== 'ROSTER') return renderDetails(rememberedForId);
    // Namelist: look the student up. A pantry device without a connection asks for details instead,
    // and the server uses the namelist record when the visit syncs.
    if (state.device && !state.online) return renderDetails(rememberedForId, 'offline');
    next.disabled = true;
    let found;
    try {
      found = await call('checkStudent', { id });
    } catch (err) {
      next.disabled = false;
      if (err.network && state.device) return renderDetails(rememberedForId, 'offline');
      error.replaceChildren(errorText(err));
      return;
    }
    if (!found.found) return renderDetails(rememberedForId, 'not-listed');
    state.student = { id, name: found.name, program: found.program, onList: true };
    renderConfirm();
  });
  screen(
    el('header', { class: 'top' }, el('h1', null, bi('Ambil apa yang anda perlukan', 'Take what you need'))),
    privacyNotice(),
    form,
    footer());
  input.focus();
}

/** A student found on the namelist confirms it is them; the tap also records their consent. */
function renderConfirm() {
  const s = state.student;
  const yes = el('button', { class: 'primary big' }, bi('Ya, ini saya', "Yes, that's me"));
  yes.addEventListener('click', () => {
    state.student.consent = true;
    renderBasket();
  });
  screen(
    el('header', { class: 'top' }, el('h1', null, bi('Adakah ini anda?', 'Is this you?'))),
    el('section', { class: 'card identity' },
      el('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(s.name)),
      el('p', { class: 'identity-name' }, Names.display(s.name)),
      s.program ? el('p', { class: 'identity-program' }, s.program) : null,
      el('p', { class: 'subtle' }, 'ID ' + StudentId.mask(s.id)),
      yes,
      el('p', { class: 'consent-note' }, bi('Dengan menekan butang ini, anda bersetuju data anda digunakan seperti dalam notis privasi.',
        'By tapping this button, you agree to your data being used as described in the privacy notice.')),
      el('button', { class: 'link', onclick: endVisit }, bi('Bukan saya', "That's not me"))),
    privacyNotice(),
    footer());
  startIdleTimer();
  yes.focus();
}

function renderDetails(remembered, reason) {
  const prior = remembered || state.student;
  const name = el('input', { id: 'name', autocomplete: 'name', maxlength: '100', value: prior.name || '' });
  const faculty = el('select', { id: 'faculty' },
    el('option', { value: '' }, 'Pilih fakulti / Choose faculty'),
    state.catalog.faculties.map((f) => el('option', { value: f.code, selected: f.code === prior.faculty_code }, f.ms + (f.en && f.en !== f.ms ? ' / ' + f.en : ''))));
  const consent = el('input', { id: 'consent', type: 'checkbox', checked: !!prior.consent });
  const remember = state.device ? null : el('input', { id: 'remember', type: 'checkbox', checked: !!remembered });
  const error = el('p', { class: 'error', role: 'alert' });
  const form = el('form', { class: 'card', novalidate: true },
    el('label', { for: 'name' }, bi('Nama penuh', 'Full name')), name,
    el('label', { for: 'faculty' }, bi('Fakulti', 'Faculty')), faculty,
    el('label', { class: 'check', for: 'consent' }, consent,
      bi('Saya bersetuju data saya digunakan seperti dalam notis privasi.', 'I agree to my data being used as described in the privacy notice.')),
    remember ? el('label', { class: 'check', for: 'remember' }, remember,
      bi('Ingat butiran saya pada telefon ini', 'Remember my details on this phone')) : null,
    error,
    el('button', { class: 'primary big', type: 'submit' }, bi('Seterusnya', 'Next')),
    el('button', { class: 'link', type: 'button', onclick: endVisit }, bi('Batal', 'Cancel')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const problem =
      name.value.trim().length < 2 ? ['Sila masukkan nama penuh anda.', 'Please enter your full name.'] :
      !faculty.value ? ['Sila pilih fakulti anda.', 'Please choose your faculty.'] :
      !consent.checked ? ['Sila tandakan kotak persetujuan untuk meneruskan.', 'Please tick the consent box to continue.'] : null;
    if (problem) {
      error.replaceChildren(bi(problem[0], problem[1]));
      return;
    }
    state.student = { id: state.student.id, name: name.value.trim(), faculty_code: faculty.value, consent: true };
    writeRemembered(remember && remember.checked ? state.student : null);
    renderBasket();
  });
  const why = reason === 'not-listed'
    ? bi('ID anda tiada dalam senarai nama. Sila masukkan butiran anda.', "Your ID isn't on the namelist. Please enter your details.", 'p')
    : reason === 'offline'
      ? bi('Tiada sambungan, jadi nama anda tidak dapat dicari. Sila masukkan butiran anda.', 'No connection, so your name could not be looked up. Please enter your details.', 'p')
      : null;
  screen(el('header', { class: 'top' }, el('h1', null, bi('Butiran anda', 'Your details')),
    el('p', { class: 'subtle' }, 'ID ' + StudentId.mask(state.student.id))),
    why ? el('div', { class: 'notice info' }, why) : null,
    privacyNotice(), form, footer());
  startIdleTimer();
  (prior.name ? faculty : name).focus();
}

function renderBasket() {
  const message = el('div', { class: 'message', role: 'status', 'aria-live': 'polite' });
  const list = el('ul', { class: 'basket', 'aria-label': 'Bakul / Basket' });
  const largeNotice = el('p', { class: 'notice warn', hidden: true },
    bi('Anda mengambil 10 atau lebih bagi satu barang. Ini dibenarkan, tetapi staf akan menyemaknya.', 'You are taking 10 or more of one item. That is allowed, but staff will review it.'));
  const done = el('button', { class: 'primary big', disabled: true }, '');
  const tiles = {}; // item_id -> {tile, count}: the badge shows how many are in the basket.
  const grid = el('div', { class: 'grid', id: 'grid' }, state.catalog.items.map((item) => {
    const count = el('span', { class: 'tile-count', 'aria-hidden': 'true' });
    const tile = el('button', { class: 'tile', 'aria-label': 'Tambah / Add ' + item.name, onclick: () => add(item.item_id) },
      photoFor(item),
      el('span', { class: 'tile-name' }, item.name),
      item.unit ? el('span', { class: 'muted' }, item.unit) : null,
      count);
    tiles[item.item_id] = { tile, count };
    return tile;
  }));

  const video = el('video', { class: 'camera', playsinline: true, muted: true, hidden: true, 'aria-label': 'Kamera / Camera' });
  const cameraButton = cameraAvailable()
    ? el('button', { class: 'secondary' }, bi('Imbas kod bar dengan kamera', 'Scan a barcode with the camera'))
    : null;
  if (cameraButton) {
    cameraButton.addEventListener('click', async () => {
      if (scanner) {
        scanner.stop();
        scanner = null;
        video.hidden = true;
        cameraButton.replaceChildren(bi('Imbas kod bar dengan kamera', 'Scan a barcode with the camera'));
        return;
      }
      try {
        scanner = new Scanner(video, handleCode);
        video.hidden = false;
        cameraButton.replaceChildren(bi('Tutup kamera', 'Close camera'));
        await scanner.start();
      } catch (err) {
        if (scanner) scanner.stop();
        scanner = null;
        video.hidden = true;
        cameraButton.replaceChildren(bi('Imbas kod bar dengan kamera', 'Scan a barcode with the camera'));
        show(bi('Kamera tidak dapat dibuka. Sila pilih barang daripada senarai.', 'The camera could not be opened. Please choose items from the list.'));
      }
    });
  }

  function show(content, isError) {
    message.className = 'message' + (isError ? ' error' : '');
    message.replaceChildren(content);
  }

  function add(itemId, n) {
    const line = state.basket.filter((l) => l.item_id === itemId)[0];
    if (line) line.qty += n || 1;
    else state.basket.push({ item_id: itemId, qty: n || 1 });
    state.basket = state.basket.filter((l) => l.qty > 0);
    const item = itemById(itemId);
    show(bi('Ditambah: ' + item.name, 'Added: ' + item.name));
    draw();
  }

  function change(itemId, delta) {
    const line = state.basket.filter((l) => l.item_id === itemId)[0];
    if (!line) return;
    line.qty = Math.max(0, Math.min(line.qty + delta, settings().max_line_qty || 999));
    state.basket = state.basket.filter((l) => l.qty > 0);
    draw();
  }

  function handleCode(raw) {
    const key = Gtin.lookupKey(raw);
    const itemId = key && (state.catalog.barcodes[key] || (itemById(key) ? key : null));
    if (itemId) return add(itemId);
    if (key && state.unknown.indexOf(key) < 0 && state.unknown.length < 20) state.unknown.push(key);
    show(bi('Barang tidak dikenali, sila pilih daripada senarai.', 'Item not recognised, please select from the list.'), true);
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const lines = new Map(); // item_id -> <li>. Lines are updated in place so only a new line animates in.
  const emptyLine = el('li', { class: 'empty' }, bi('Bakul kosong. Imbas atau pilih barang di bawah.', 'Your basket is empty. Scan or choose items below.'));
  const qtyOf = (itemId) => (state.basket.filter((l) => l.item_id === itemId)[0] || { qty: 0 }).qty;

  function makeLine(itemId) {
    const item = itemById(itemId);
    return el('li', { class: 'line' },
      el('span', { class: 'line-name' }, item.name),
      el('span', { class: 'stepper' },
        el('button', { class: 'round', 'aria-label': 'Kurang / Less ' + item.name, onclick: () => change(itemId, -1) }, '−'),
        el('span', { class: 'qty', 'aria-live': 'polite' }),
        el('button', { class: 'round', 'aria-label': 'Tambah / More ' + item.name, onclick: () => change(itemId, 1) }, '+')),
      el('button', { class: 'round ghost', 'aria-label': 'Buang / Remove ' + item.name, onclick: () => change(itemId, -qtyOf(itemId)) }, '×'));
  }

  function draw() {
    lines.forEach((li, itemId) => {
      if (!qtyOf(itemId)) {
        li.remove();
        lines.delete(itemId);
      }
    });
    if (state.basket.length) emptyLine.remove();
    else if (!emptyLine.isConnected) list.append(emptyLine);
    state.basket.forEach((line) => {
      if (!lines.has(line.item_id)) {
        lines.set(line.item_id, makeLine(line.item_id));
        list.append(lines.get(line.item_id));
      }
      lines.get(line.item_id).querySelector('.qty').textContent = String(line.qty);
    });
    Object.keys(tiles).forEach((itemId) => {
      const qty = qtyOf(itemId);
      if (qty) {
        tiles[itemId].tile.setAttribute('data-in-basket', '');
        tiles[itemId].count.textContent = String(qty);
      } else {
        tiles[itemId].tile.removeAttribute('data-in-basket');
      }
    });
    const count = state.basket.reduce((sum, l) => sum + l.qty, 0);
    largeNotice.hidden = !state.basket.some((l) => l.qty >= (settings().large_qty_threshold || 10));
    done.disabled = count === 0;
    done.replaceChildren(bi('Selesai (' + count + ' barang)', 'Done (' + count + ' items)'));
  }

  done.addEventListener('click', () => confirmVisit(done, show));

  screen(
    el('header', { class: 'top' },
      el('h1', null, bi('Bakul anda', 'Your basket')),
      el('p', { class: 'subtle student-line' }, studentLine())),
    el('section', { class: 'card' }, list, largeNotice, message,
      el('button', { class: 'link', onclick: endVisit }, bi('Batal lawatan', 'Cancel visit'))),
    el('section', { class: 'card' }, cameraButton, video,
      el('p', { class: 'muted' }, bi('Imbas kod bar, atau ketik gambar barang untuk menambah 1.', 'Scan a barcode, or tap an item to add 1.'))),
    grid,
    el('div', { class: 'checkout' }, done), // Stays at the bottom of the screen while the student scrolls the items.
    footer());
  draw();
  loadPhotos();
  startIdleTimer();

  // USB barcode scanners type the code quickly and press Enter. Typing by hand is too slow to count.
  let buffer = '';
  let lastKey = 0;
  wedge = (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const now = Date.now();
    if (now - lastKey > 100) buffer = '';
    lastKey = now;
    if (e.key === 'Enter') {
      if (buffer.length >= 6) {
        e.preventDefault();
        handleCode(buffer);
      }
      buffer = '';
    } else if (e.key.length === 1) {
      buffer += e.key;
    }
  };
  document.addEventListener('keydown', wedge, true);
}

function photoFor(item) {
  const img = el('img', { class: 'tile-photo', alt: '', 'data-item': item.item_id, loading: 'lazy' });
  const photo = state.photos[item.item_id];
  if (photo && photo.version === item.photo_version) img.src = photo.data;
  return img;
}

async function loadPhotos() {
  const missing = state.catalog.items.filter((i) => i.photo_version && (!state.photos[i.item_id] || state.photos[i.item_id].version !== i.photo_version));
  if (!missing.length || !state.online) return;
  try {
    const result = await call('photos', { item_ids: missing.map((i) => i.item_id) });
    for (const id of Object.keys(result.photos)) {
      state.photos[id] = result.photos[id];
      await store.set('photos', id, result.photos[id]);
      document.querySelectorAll('img[data-item="' + CSS.escape(id) + '"]').forEach((img) => { img.src = result.photos[id].data; });
    }
  } catch (err) {
    // Photos are optional; the names still show.
  }
}

async function confirmVisit(button, show) {
  button.disabled = true;
  const s = state.student;
  const visit = {
    visit_id: newUuid(),
    occurred_at: new Date().toISOString(),
    // On the namelist the server already knows the name; otherwise send the typed details.
    student: s.onList
      ? { id: s.id, consent: s.consent === true }
      : { id: s.id, name: s.name, faculty_code: s.faculty_code, consent: s.consent === true },
    lines: state.basket.map((l) => ({ item_id: l.item_id, qty: l.qty })),
    unknown_barcodes: state.unknown.slice(),
  };
  if (state.device) {
    // Pantry device: save on the device first, then send in the background. Never makes the student wait.
    await queue.add(visit);
    renderThanks(!state.online);
    syncNow();
    return;
  }
  try {
    await call('submitVisit', visit);
    renderThanks(false);
  } catch (err) {
    button.disabled = false;
    show(errorText(err), true);
  }
}

function renderThanks(savedOffline) {
  const seconds = settings().thanks_seconds || 5;
  const name = state.student && state.student.name ? Names.display(state.student.name) : '';
  state.student = null;
  state.basket = [];
  state.unknown = [];
  screen(el('section', { class: 'card thanks' },
    el('div', { class: 'success-mark', 'aria-hidden': 'true' }, icon('check')),
    bi(name ? 'Terima kasih ' + name + '.' : 'Terima kasih.', name ? 'Thank you, ' + name + '.' : 'Thank you.', 'h1'),
    el('div', { class: 'meal' }, bi('Selamat menjamu selera!', 'Enjoy your meal!', 'p')),
    savedOffline
      ? bi('Lawatan anda disimpan pada peranti ini dan akan dihantar apabila ada sambungan.', 'Your visit is saved on this device and will be sent when the connection is back.', 'p')
      : bi('Lawatan anda telah direkodkan.', 'Your visit has been recorded.', 'p'),
    el('button', { class: 'secondary', onclick: renderStart }, bi('Seterusnya', 'Next person')),
    el('div', { class: 'countdown', 'aria-hidden': 'true' }, el('span', { style: 'animation-duration:' + seconds + 's' }))),
  footer());
  idleTimer = setTimeout(renderStart, seconds * 1000);
}

// ---------- Pantry device setup and sync ----------

function renderSetup() {
  const code = el('input', { id: 'code', autocomplete: 'off', autocapitalize: 'characters', maxlength: '9', placeholder: 'ABCD-EFGH' });
  const error = el('p', { class: 'error', role: 'alert' });
  const save = el('button', { class: 'primary', type: 'submit' }, 'Set up this device');
  const staffUrl = window.APP_CONFIG.staffUrl;
  const form = el('form', { class: 'card', novalidate: true },
    el('ol', { class: 'steps' },
      el('li', null, 'Sign in to the staff app with your UiTM account.'),
      el('li', null, 'Open Devices and get a setup code for this pantry. It works once, for 10 minutes.'),
      el('li', null, 'Enter the code below.')),
    staffUrl ? el('a', { class: 'secondary', href: staffUrl, target: '_blank', rel: 'noopener' }, 'Staff sign-in (opens the staff app)') : null,
    el('label', { for: 'code', style: 'margin-top:24px' }, 'Setup code'), code, error, save,
    el('button', { class: 'link', type: 'button', onclick: renderStart }, 'Back'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      const device = await call('redeemSetupCode', { code: code.value });
      state.device = device;
      await store.set('kv', 'device', device);
      await store.askToPersist();
      if (!(await store.isPersistent())) {
        error.textContent = 'Warning: this browser cannot keep data after the page closes (private mode?). Offline visits would be lost.';
      }
      await loadCatalog();
      renderStart();
    } catch (err) {
      save.disabled = false;
      error.replaceChildren(errorText(err));
    }
  });
  screen(el('header', { class: 'top' }, el('h1', null, 'Pantry device setup'),
    el('p', { class: 'subtle' }, 'For staff. Turns this laptop or phone into a pantry device that keeps working offline.')), form);
  code.focus();
}

async function renderSync() {
  const entries = await queue.entries();
  const send = el('button', { class: 'primary' }, 'Hantar sekarang / Send now');
  const note = el('p', { class: 'muted', role: 'status' });
  send.addEventListener('click', async () => {
    send.disabled = true;
    const result = await syncNow();
    note.textContent = result.ok ? 'Sent.' : 'Could not send yet: ' + (state.online ? 'the server is busy.' : 'no connection.');
    setTimeout(renderSync, 800);
  });
  const rows = entries.map((entry) => {
    const time = new Date(entry.occurred_at).toLocaleString('ms-MY', { dateStyle: 'short', timeStyle: 'short' });
    const count = entry.visit.lines.reduce((sum, l) => sum + l.qty, 0);
    const actions = entry.sync_status === 'rejected' ? [
      el('button', { class: 'secondary', onclick: async () => { await queue.retry(entry.visit_id); renderSync(); } }, 'Retry'),
      el('button', { class: 'danger', onclick: async () => {
        if (!confirm('Delete this visit from the device? It will never reach the server. Write it down first if the items were really taken.')) return;
        await queue.discard(entry.visit_id);
        renderSync();
      } }, 'Discard'),
    ] : [];
    return el('tr', null, el('td', null, time), el('td', null, String(count)),
      el('td', null, entry.sync_status === 'rejected' ? 'Needs staff: ' + entry.error : 'Waiting'), el('td', null, actions));
  });
  const forget = el('button', { class: 'link', onclick: async () => {
    if (entries.length) return alert('Send or deal with every waiting visit first.');
    if (!confirm('Remove this device\'s pantry setup? It becomes a normal student phone.')) return;
    await forgetDevice();
  } }, 'Remove pantry setup from this device');
  screen(
    el('header', { class: 'top' }, el('h1', null, bi('Status penghantaran', 'Sync status')), el('p', { class: 'subtle' }, statusText())),
    el('section', { class: 'card' },
      entries.length
        ? el('table', null, el('thead', null, el('tr', null, el('th', null, 'Time'), el('th', null, 'Items'), el('th', null, 'Status'), el('th'))), el('tbody', null, rows))
        : el('p', null, 'Semua lawatan telah dihantar. / Every visit has been sent.'),
      el('div', { class: 'actions' }, send, el('button', { class: 'secondary', onclick: renderStart }, 'Back')),
      note),
    el('p', null, forget));
}

async function forgetDevice() {
  state.device = null;
  await store.remove('kv', 'device');
  renderMessage('Peranti ini tidak lagi berdaftar sebagai peranti pantri.', 'This device is no longer set up as a pantry device. Scan the pantry QR poster to use it as a student phone.');
}

let syncing = null;
function syncNow() {
  if (!queue || !state.device) return Promise.resolve({ ok: true });
  if (!syncing) {
    syncing = queue.sync().then(async (result) => {
      syncing = null;
      await refreshPending();
      return result;
    });
  }
  return syncing;
}

// ---------- Catalogue ----------

async function loadCatalog() {
  try {
    const fresh = await call('catalog', { version: state.catalog ? state.catalog.version : '' });
    if (!fresh.unchanged) {
      state.catalog = fresh;
      await store.set('kv', 'catalog', fresh);
    }
    return true;
  } catch (err) {
    if (err.code === 'PANTRY_UNKNOWN') state.catalog = null;
    throw err;
  }
}

/** True on the start screen before anyone has typed, so it is safe to redraw it. */
function idleOnStart() {
  const input = document.getElementById('student-id');
  return !!input && !input.value;
}

/**
 * Fetches the latest catalogue without making anyone wait. Redraws the start screen only if the list changed
 * and no one has started a visit; otherwise the new list is used from the next visit.
 */
async function refreshCatalog() {
  const before = state.catalog ? state.catalog.version : '';
  try {
    await loadCatalog();
  } catch (err) {
    if (err.code === 'PANTRY_UNKNOWN') {
      renderMessage('Pantri tidak dikenali. Sila imbas poster QR di pantri.', 'Pantry not recognised. Please scan the QR poster at the pantry.');
    }
    return; // Offline or busy: keep the saved list.
  }
  if (state.catalog && state.catalog.version !== before && idleOnStart()) renderStart();
}

// ---------- Start-up ----------

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('p')) {
    try { localStorage.setItem(PANTRY_KEY, params.get('p')); } catch (err) { /* private mode */ }
    history.replaceState(null, '', location.pathname);
  }
  state.device = (await store.get('kv', 'device')) || null;
  try { state.pantryId = params.get('p') || localStorage.getItem(PANTRY_KEY) || ''; } catch (err) { state.pantryId = params.get('p') || ''; }

  if (!state.device && !state.pantryId) {
    return renderMessage('Sila imbas poster QR di pantri untuk bermula.', 'Please scan the QR poster at the pantry to start.');
  }

  queue = VisitQueue.create(store.queueStorage, (visits) => call('syncVisits', { visits }).then((data) => data.results));
  // A saved catalogue belongs to one pantry: never show it for another (for example after scanning another QR poster).
  const cached = await store.get('kv', 'catalog');
  const pantryNow = state.device ? state.device.location_id : state.pantryId;
  if (cached && cached.location && cached.location.location_id === pantryNow) {
    state.catalog = cached;
    for (const item of cached.items) {
      const photo = await store.get('photos', item.item_id);
      if (photo) state.photos[item.item_id] = photo;
    }
  }

  if (state.catalog) {
    // Show the saved list straight away; Apps Script can take several seconds to answer after a deploy.
    updateBanner();
    renderStart();
    refreshCatalog();
  } else {
    try {
      await loadCatalog();
    } catch (err) {
      return err.code === 'PANTRY_UNKNOWN'
        ? renderMessage('Pantri tidak dikenali. Sila imbas poster QR di pantri.', 'Pantry not recognised. Please scan the QR poster at the pantry.')
        : renderMessage('Senarai barang tidak dapat dimuatkan. Semak sambungan internet.', 'The item list could not be loaded. Check the internet connection.', () => location.reload());
    }
    updateBanner();
    renderStart();
  }
  await refreshPending();
  syncNow();

  window.addEventListener('online', () => { setOnline(true); syncNow(); });
  window.addEventListener('offline', () => setOnline(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (state.pending) syncNow(); }, 60 * 1000);
  // Pick up new items and photos every 5 minutes, but only between visits.
  setInterval(() => { if (idleOnStart()) refreshCatalog(); }, 5 * 60 * 1000);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
