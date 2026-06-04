// ============================================================
// AMINA MILK – firebase.js  (v2 – fixed initialization)
// ① Replace the 6 config values below with your Firebase project.
// ② In Firestore console: users/{your-uid} → role = "admin"
// ③ Everything else is auto-created on first login.
// ============================================================
var FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCjHkVkZb2RUjPG-dFi_Q1hYVDhY8OtKw8",
  authDomain:        "educational-notification.firebaseapp.com",
  projectId:         "educational-notification",
  storageBucket:     "educational-notification.firebasestorage.app",
  messagingSenderId: "811687039959",
  appId:             "1:811687039959:web:5227b6a5f234bf632c7192"
};

// ── QR security constants ─────────────────────────────────
var AM_SECURITY_TOKEN = "AMINA_MILK_SECURE_v1_2025";
var AM_QR_PREFIX      = "AMINAMILK://";

// ── Firebase globals (var so they hoist safely) ───────────
var auth, db, storage;

(function initFirebase() {
  // Guard against double-init (e.g. hot reload)
  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }
  auth    = firebase.auth();
  db      = firebase.firestore();
  storage = firebase.storage();

  // Offline persistence via IndexedDB – non-fatal if it fails
  db.enablePersistence({ synchronizeTabs: true }).catch(function() {});
})();

// ============================================================
// AUTO-BOOTSTRAP  – runs once per login session
// Creates all required Firestore docs if they don't exist yet.
// ============================================================
async function bootstrapSystem(uid, role) {
  try {
    // 1. User doc – only write if missing (admin set role manually)
    var userRef  = db.collection("users").doc(uid);
    var userSnap = await userRef.get();
    if (!userSnap.exists) {
      await userRef.set({
        email:     auth.currentUser ? auth.currentUser.email : "",
        role:      role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        active:    true
      }, { merge: true });
    }

    // 2. Global settings doc
    var settRef  = db.collection("settings").doc("global");
    var settSnap = await settRef.get();
    if (!settSnap.exists) {
      await settRef.set({
        bizName:       "Amina Milk",
        bizPhone:      "",
        bizAddress:    "",
        defaultQty:    1,
        deliveryStart: "06:00",
        deliveryEnd:   "10:00",
        currency:      "₹",
        pricePerLitre: 0,
        createdAt:     firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    // 3. Stats meta doc
    var metaRef  = db.collection("meta").doc("stats");
    var metaSnap = await metaRef.get();
    if (!metaSnap.exists) {
      await metaRef.set({
        totalCustomers:  0,
        totalDeliveries: 0,
        totalMilkLitres: 0,
        lastUpdated:     firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    // Cache settings locally
    var gs = (await settRef.get()).data() || {};
    CACHE.set("settings", gs);

  } catch (e) {
    console.warn("Bootstrap (non-fatal):", e.message);
  }
}

// ============================================================
// AUTH
// ============================================================
function signIn(email, password) {
  return auth.signInWithEmailAndPassword(email, password);
}
function signOut() {
  return auth.signOut();
}
async function getUserRole(uid) {
  try {
    var snap = await db.collection("users").doc(uid).get();
    return snap.exists ? (snap.data().role || null) : null;
  } catch (e) { return null; }
}

// ============================================================
// CUSTOMERS
// ============================================================
function generateCustomerId() {
  var ts  = Date.now().toString(36).toUpperCase().slice(-5);
  var rnd = Math.floor(100 + Math.random() * 900);
  return "AM" + ts + rnd;
}
function generateQRData(customerId) {
  var payload = { t: AM_SECURITY_TOKEN, id: customerId, ts: Date.now() };
  return AM_QR_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}
function validateQRData(raw) {
  try {
    if (!raw || !raw.startsWith(AM_QR_PREFIX)) return null;
    var payload = JSON.parse(decodeURIComponent(escape(atob(raw.replace(AM_QR_PREFIX, "")))));
    return payload.t === AM_SECURITY_TOKEN ? payload.id : null;
  } catch (e) { return null; }
}
async function addCustomer(data, uid) {
  var cid    = generateCustomerId();
  var qrData = generateQRData(cid);
  var doc    = Object.assign({}, data, {
    customerId: cid,
    qrData:     qrData,
    createdBy:  uid,
    createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
    active:     true
  });
  await db.collection("customers").doc(cid).set(doc);
  db.collection("meta").doc("stats").update({
    totalCustomers: firebase.firestore.FieldValue.increment(1)
  }).catch(function(){});
  CACHE.del("customers");
  return { cid: cid, qrData: qrData, doc: doc };
}
async function getCustomers() {
  var snap = await db.collection("customers")
    .where("active","==",true).orderBy("createdAt","desc").get();
  var list = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
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
  var base = CACHE.get("customers", 600000) || (await getCustomers());
  return base.filter(function(c) {
    return (c.name       || "").toLowerCase().includes(q) ||
           (c.mobile     || "").includes(q) ||
           (c.customerId || "").toLowerCase().includes(q) ||
           (c.address    || "").toLowerCase().includes(q);
  });
}

// ============================================================
// DELIVERIES
// ============================================================
async function submitDelivery(delivery) {
  var todayStr = new Date().toISOString().slice(0,10);
  var dup = await db.collection("deliveries")
    .where("customerId","==",delivery.customerId)
    .where("date","==",todayStr).get();
  if (!dup.empty) throw new Error("DUPLICATE");
  delivery.timestamp = firebase.firestore.FieldValue.serverTimestamp();
  delivery.date      = todayStr;
  delivery.time      = new Date().toLocaleTimeString("en-IN");
  var ref = await db.collection("deliveries").add(delivery);
  db.collection("meta").doc("stats").update({
    totalDeliveries: firebase.firestore.FieldValue.increment(1),
    totalMilkLitres: firebase.firestore.FieldValue.increment(delivery.deliveredQty || 0),
    lastUpdated:     firebase.firestore.FieldValue.serverTimestamp()
  }).catch(function(){});
  return ref.id;
}
async function updateDelivery(deliveryId, data) {
  return db.collection("deliveries").doc(deliveryId).update(data);
}
async function getTodayDeliveries() {
  var todayStr = new Date().toISOString().slice(0,10);
  var snap = await db.collection("deliveries").where("date","==",todayStr).get();
  return snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
}
async function getTodayDeliveryForCustomer(customerId) {
  var todayStr = new Date().toISOString().slice(0,10);
  var snap = await db.collection("deliveries")
    .where("customerId","==",customerId).where("date","==",todayStr).get();
  return snap.empty ? null : Object.assign({id:snap.docs[0].id}, snap.docs[0].data());
}
async function getDeliveries(filters) {
  filters = filters || {};
  var q = db.collection("deliveries");
  if (filters.customerId) q = q.where("customerId","==",filters.customerId);
  if (filters.staffId)    q = q.where("staffId","==",filters.staffId);
  if (filters.dateFrom)   q = q.where("date",">=",filters.dateFrom);
  if (filters.dateTo)     q = q.where("date","<=",filters.dateTo);
  var snap = await q.orderBy("date","desc").get();
  return snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
}

// ============================================================
// STAFF
// ============================================================
var _secondaryApp = null;
async function createStaffUser(email, password, name, phone) {
  // Secondary app instance keeps admin session alive
  if (!_secondaryApp) {
    _secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, "secondary");
  }
  var secAuth = _secondaryApp.auth();
  var cred    = await secAuth.createUserWithEmailAndPassword(email, password);
  var uid     = cred.user.uid;
  await secAuth.signOut();
  await db.collection("users").doc(uid).set({
    name:      name,
    email:     email,
    phone:     phone || "",
    role:      "staff",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    active:    true
  });
  return uid;
}
async function getStaff() {
  var snap = await db.collection("users")
    .where("role","==","staff").where("active","==",true).get();
  return snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
}
async function deactivateStaff(uid) {
  return db.collection("users").doc(uid).update({ active: false });
}

// ============================================================
// SETTINGS
// ============================================================
async function getSettings() {
  var cached = CACHE.get("settings", 3600000);
  if (cached) return cached;
  var snap = await db.collection("settings").doc("global").get();
  var data = snap.exists ? snap.data() : {};
  CACHE.set("settings", data);
  return data;
}
async function saveSettings(data) {
  await db.collection("settings").doc("global").set(data, { merge: true });
  var existing = CACHE.get("settings", 999999) || {};
  CACHE.set("settings", Object.assign(existing, data));
}

// ============================================================
// SEARCH HISTORY
// ============================================================
function saveSearchHistory(uid, query, customerId) {
  return db.collection("searchHistory").add({
    uid: uid, query: query, customerId: customerId,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
}
async function getRecentSearches(uid, limit) {
  limit = limit || 8;
  try {
    var snap = await db.collection("searchHistory")
      .where("uid","==",uid).orderBy("timestamp","desc").limit(limit).get();
    return snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
  } catch(e) { return []; }
}
async function getFrequentSearches(uid) {
  try {
    var yr = new Date(); yr.setFullYear(yr.getFullYear()-1);
    var snap = await db.collection("searchHistory")
      .where("uid","==",uid).where("timestamp",">=",yr).get();
    var freq = {};
    snap.docs.forEach(function(d) {
      var x = d.data();
      if (x.customerId) {
        freq[x.customerId] = freq[x.customerId] || { count:0, query:x.query };
        freq[x.customerId].count++;
      }
    });
    return Object.entries(freq)
      .sort(function(a,b){ return b[1].count - a[1].count; })
      .slice(0,5)
      .map(function(e){ return Object.assign({ customerId:e[0] }, e[1]); });
  } catch(e) { return []; }
}

// ============================================================
// STATISTICS
// ============================================================
async function getStats() {
  var todayStr = new Date().toISOString().slice(0,10);
  var results  = await Promise.all([
    db.collection("deliveries").where("date","==",todayStr).get(),
    db.collection("customers").where("active","==",true).get()
  ]);
  var todayDels  = results[0].docs.map(function(d){ return d.data(); });
  var totalMilk  = todayDels.reduce(function(s,d){ return s+(d.deliveredQty||0); }, 0);
  var extraMilk  = todayDels.reduce(function(s,d){ return s+(d.extraQty||0); }, 0);
  return {
    todayServed:    todayDels.length,
    totalPending:   Math.max(0, results[1].size - todayDels.length),
    totalMilk:      totalMilk,
    extraMilk:      extraMilk,
    totalCustomers: results[1].size
  };
}

// ============================================================
// OFFLINE CACHE  (LocalStorage + TTL)
// ============================================================
var CACHE = {
  set: function(k,v){ try{ localStorage.setItem("am_"+k, JSON.stringify({v:v,t:Date.now()})); }catch(e){} },
  get: function(k,ttl){ ttl=ttl||300000; try{ var d=JSON.parse(localStorage.getItem("am_"+k)); if(d&&Date.now()-d.t<ttl)return d.v; }catch(e){} return null; },
  del: function(k){ try{ localStorage.removeItem("am_"+k); }catch(e){} }
};

// ============================================================
// QR HELPERS
// ============================================================
function renderQR(data, el, size) {
  size = size || 200;
  el.innerHTML = "";
  if (window.QRCode) {
    new QRCode(el, { text:data, width:size, height:size, correctLevel:QRCode.CorrectLevel.H });
  }
}
function downloadQR(data, filename) {
  var div = document.createElement("div");
  div.style.cssText = "position:fixed;left:-9999px;top:-9999px";
  document.body.appendChild(div);
  renderQR(data, div, 400);
  setTimeout(function() {
    var canvas = div.querySelector("canvas");
    if (canvas) {
      var a = document.createElement("a");
      a.href     = canvas.toDataURL("image/png");
      a.download = (filename||"qr") + ".png";
      a.click();
    }
    document.body.removeChild(div);
  }, 600);
}
