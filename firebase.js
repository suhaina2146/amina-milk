// ============================================================
// AMINA MILK – firebase.js
// SETUP: Only replace the config values below.
// Everything else (collections, settings, indexes) is created
// automatically on first login. You only need to manually set
//   role: "admin"   on your user doc in Firestore console.
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyCjHkVkZb2RUjPG-dFi_Q1hYVDhY8OtKw8",
  authDomain: "educational-notification.firebaseapp.com",
  projectId: "educational-notification",
  storageBucket: "educational-notification.firebasestorage.app",
  messagingSenderId: "811687039959",
  appId: "1:811687039959:web:5227b6a5f234bf632c7192",
  measurementId: "G-5B174QPK2J"
};

// ── Security token embedded in every QR code ──────────────
const AM_SECURITY_TOKEN = "AMINA_MILK_SECURE_v1_2025";
const AM_QR_PREFIX      = "AMINAMILK://";

// ── Firebase init ──────────────────────────────────────────
firebase.initializeApp(FIREBASE_CONFIG);
const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();

// Enable offline persistence (IndexedDB) automatically
db.enablePersistence({synchronizeTabs: true}).catch(() => {});

// ============================================================
// AUTO-BOOTSTRAP
// Called once after every successful login.
// Creates missing collections / documents silently.
// ============================================================
async function bootstrapSystem(uid, role) {
  try {
    const batch = db.batch();

    // 1. Ensure user doc exists (admin already has role; staff created by admin)
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      // First-ever login: create a bare user doc (role already set manually by admin in console)
      batch.set(userRef, {
        email: auth.currentUser.email,
        role: role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        active: true
      }, { merge: true });
    }

    // 2. Global settings doc (only if missing)
    const settingsRef = db.collection("settings").doc("global");
    const settingsSnap = await settingsRef.get();
    if (!settingsSnap.exists) {
      batch.set(settingsRef, {
        bizName:      "Amina Milk",
        bizPhone:     "",
        bizAddress:   "",
        defaultQty:   1,
        deliveryStart:"06:00",
        deliveryEnd:  "10:00",
        currency:     "₹",
        pricePerLitre:0,
        createdAt:    firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    // 3. Stats meta doc (aggregated counters, updated on each delivery)
    const statsRef = db.collection("meta").doc("stats");
    const statsSnap = await statsRef.get();
    if (!statsSnap.exists) {
      batch.set(statsRef, {
        totalCustomers:  0,
        totalDeliveries: 0,
        totalMilkLitres: 0,
        lastUpdated:     firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    await batch.commit();

    // 4. Load & cache settings into CACHE so pages can read them instantly
    const gs = (await settingsRef.get()).data() || {};
    CACHE.set("settings", gs);

  } catch (e) {
    // Non-fatal – app still works without bootstrap
    console.warn("Bootstrap warning:", e.message);
  }
}

// ============================================================
// AUTH
// ============================================================
async function signIn(email, password) {
  return auth.signInWithEmailAndPassword(email, password);
}
async function signOut() {
  return auth.signOut();
}

// getUserRole: reads Firestore users/{uid}.role
// If the doc doesn't exist yet (very first login before any write),
// returns null so the login page can show a clear error.
async function getUserRole(uid) {
  try {
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists ? (snap.data().role || null) : null;
  } catch { return null; }
}

// ============================================================
// CUSTOMERS
// ============================================================
function generateCustomerId() {
  const ts  = Date.now().toString(36).toUpperCase().slice(-5);
  const rnd = Math.floor(100 + Math.random() * 900);
  return `AM${ts}${rnd}`;
}

function generateQRData(customerId) {
  const payload = { t: AM_SECURITY_TOKEN, id: customerId, ts: Date.now() };
  return AM_QR_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function validateQRData(raw) {
  try {
    if (!raw || !raw.startsWith(AM_QR_PREFIX)) return null;
    const payload = JSON.parse(decodeURIComponent(escape(atob(raw.replace(AM_QR_PREFIX, "")))));
    if (payload.t !== AM_SECURITY_TOKEN) return null;
    return payload.id;
  } catch { return null; }
}

async function addCustomer(data, uid) {
  const cid    = generateCustomerId();
  const qrData = generateQRData(cid);
  const doc = {
    ...data,
    customerId: cid,
    qrData,
    createdBy: uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    active: true
  };
  await db.collection("customers").doc(cid).set(doc);

  // Bump meta counter
  db.collection("meta").doc("stats").update({
    totalCustomers: firebase.firestore.FieldValue.increment(1)
  }).catch(() => {});

  CACHE.del("customers"); // invalidate cache
  return { cid, qrData, doc };
}

async function getCustomers() {
  const snap = await db.collection("customers")
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .get();
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  CACHE.set("customers", list);
  return list;
}

async function updateCustomer(cid, data) {
  CACHE.del("customers");
  return db.collection("customers").doc(cid).update(data);
}

async function deleteCustomer(cid) {
  CACHE.del("customers");
  return db.collection("customers").doc(cid).update({ active: false });
}

async function searchCustomers(q) {
  q = (q || "").trim().toLowerCase();
  // Use cached list first for speed
  const cached = CACHE.get("customers", 600000) || [];
  const base   = cached.length ? cached : (await getCustomers());
  return base.filter(c =>
    (c.name    || "").toLowerCase().includes(q) ||
    (c.mobile  || "").includes(q)               ||
    (c.customerId || "").toLowerCase().includes(q) ||
    (c.address || "").toLowerCase().includes(q)
  );
}

// ============================================================
// DELIVERIES
// ============================================================
async function submitDelivery(delivery) {
  const todayStr = new Date().toISOString().slice(0, 10);
  // Duplicate check
  const dup = await db.collection("deliveries")
    .where("customerId", "==", delivery.customerId)
    .where("date",       "==", todayStr)
    .get();
  if (!dup.empty) throw new Error("DUPLICATE");

  delivery.timestamp = firebase.firestore.FieldValue.serverTimestamp();
  delivery.date      = todayStr;
  delivery.time      = new Date().toLocaleTimeString("en-IN");

  const ref = await db.collection("deliveries").add(delivery);

  // Bump meta counters
  db.collection("meta").doc("stats").update({
    totalDeliveries: firebase.firestore.FieldValue.increment(1),
    totalMilkLitres: firebase.firestore.FieldValue.increment(delivery.deliveredQty || 0),
    lastUpdated:     firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});

  return ref.id;
}

async function updateDelivery(deliveryId, data) {
  return db.collection("deliveries").doc(deliveryId).update(data);
}

async function getTodayDeliveries() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const snap = await db.collection("deliveries").where("date", "==", todayStr).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getTodayDeliveryForCustomer(customerId) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const snap = await db.collection("deliveries")
    .where("customerId", "==", customerId)
    .where("date",       "==", todayStr)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function getDeliveries(filters = {}) {
  let q = db.collection("deliveries");
  if (filters.customerId) q = q.where("customerId", "==", filters.customerId);
  if (filters.staffId)    q = q.where("staffId",    "==", filters.staffId);
  if (filters.dateFrom)   q = q.where("date", ">=", filters.dateFrom);
  if (filters.dateTo)     q = q.where("date", "<=", filters.dateTo);
  const snap = await q.orderBy("date", "desc").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ============================================================
// STAFF  (admin creates staff accounts via client SDK)
// After createStaffUser the admin stays logged in because we
// use a secondary app instance so the main session is unaffected.
// ============================================================
let _secondaryApp = null;
async function createStaffUser(email, password, name, phone) {
  // Use secondary Firebase app to avoid signing out the admin
  if (!_secondaryApp) {
    _secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, "secondary");
  }
  const secAuth = _secondaryApp.auth();
  const cred    = await secAuth.createUserWithEmailAndPassword(email, password);
  const uid     = cred.user.uid;
  await secAuth.signOut();

  // Write user doc with role:"staff"
  await db.collection("users").doc(uid).set({
    name,
    email,
    phone:     phone || "",
    role:      "staff",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    active:    true
  });
  return uid;
}

async function getStaff() {
  const snap = await db.collection("users")
    .where("role",   "==", "staff")
    .where("active", "==", true)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function deactivateStaff(uid) {
  return db.collection("users").doc(uid).update({ active: false });
}

// ============================================================
// SETTINGS  (read/write global settings doc)
// ============================================================
async function getSettings() {
  const cached = CACHE.get("settings", 3600000);
  if (cached) return cached;
  const snap = await db.collection("settings").doc("global").get();
  const data  = snap.exists ? snap.data() : {};
  CACHE.set("settings", data);
  return data;
}

async function saveSettings(data) {
  await db.collection("settings").doc("global").set(data, { merge: true });
  CACHE.set("settings", { ...(CACHE.get("settings", 999999) || {}), ...data });
}

// ============================================================
// SEARCH HISTORY
// ============================================================
async function saveSearchHistory(uid, query, customerId) {
  return db.collection("searchHistory").add({
    uid, query, customerId,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function getRecentSearches(uid, limit = 8) {
  try {
    const snap = await db.collection("searchHistory")
      .where("uid", "==", uid)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

async function getFrequentSearches(uid) {
  try {
    const yr = new Date();
    yr.setFullYear(yr.getFullYear() - 1);
    const snap = await db.collection("searchHistory")
      .where("uid",       "==", uid)
      .where("timestamp", ">=", yr)
      .get();
    const freq = {};
    snap.docs.forEach(d => {
      const { customerId, query } = d.data();
      if (customerId) {
        freq[customerId] = freq[customerId] || { count: 0, query };
        freq[customerId].count++;
      }
    });
    return Object.entries(freq)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([id, v]) => ({ customerId: id, ...v }));
  } catch { return []; }
}

// ============================================================
// STATISTICS
// ============================================================
async function getStats() {
  const todayStr  = new Date().toISOString().slice(0, 10);
  const [todaySnap, custSnap] = await Promise.all([
    db.collection("deliveries").where("date", "==", todayStr).get(),
    db.collection("customers").where("active", "==", true).get()
  ]);
  const todayDels  = todaySnap.docs.map(d => d.data());
  const totalMilk  = todayDels.reduce((s, d) => s + (d.deliveredQty || 0), 0);
  const extraMilk  = todayDels.reduce((s, d) => s + (d.extraQty    || 0), 0);
  return {
    todayServed:    todayDels.length,
    totalPending:   Math.max(0, custSnap.size - todayDels.length),
    totalMilk,
    extraMilk,
    totalCustomers: custSnap.size
  };
}

// ============================================================
// OFFLINE CACHE  (LocalStorage with TTL)
// ============================================================
const CACHE = {
  set(k, v) {
    try { localStorage.setItem("am_" + k, JSON.stringify({ v, t: Date.now() })); } catch {}
  },
  get(k, ttl = 300000) {
    try {
      const d = JSON.parse(localStorage.getItem("am_" + k));
      if (d && Date.now() - d.t < ttl) return d.v;
    } catch {}
    return null;
  },
  del(k) { try { localStorage.removeItem("am_" + k); } catch {} }
};

// ============================================================
// QR HELPERS
// ============================================================
function renderQR(data, el, size = 200) {
  el.innerHTML = "";
  if (window.QRCode) {
    new QRCode(el, {
      text:         data,
      width:        size,
      height:       size,
      correctLevel: QRCode.CorrectLevel.H
    });
  }
}

async function downloadQR(data, filename) {
  const div = document.createElement("div");
  div.style.cssText = "position:fixed;left:-9999px;top:-9999px";
  document.body.appendChild(div);
  renderQR(data, div, 400);
  setTimeout(() => {
    const canvas = div.querySelector("canvas");
    if (canvas) {
      const a = document.createElement("a");
      a.href     = canvas.toDataURL("image/png");
      a.download = (filename || "qr") + ".png";
      a.click();
    }
    document.body.removeChild(div);
  }, 600);
}
