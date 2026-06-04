// ============================================================
// AMINA MILK – firebase.js
// Replace config values with your Firebase project credentials.
// In Firestore: users/{your-uid} → role = "admin"
// ============================================================
var FIREBASE_CONFIG={
  apiKey:"AIzaSyCjHkVkZb2RUjPG-dFi_Q1hYVDhY8OtKw8",
  authDomain:"educational-notification.firebaseapp.com",
  projectId:"educational-notification",
  storageBucket:"educational-notification.firebasestorage.app",
  messagingSenderId:"811687039959",
  appId:"1:811687039959:web:5227b6a5f234bf632c7192"
};
var AM_TOKEN="AMINA_MILK_SECURE_v1_2025",AM_PREFIX="AMINAMILK://";
var auth,db,storage;

(function(){
  if(!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);
  auth=firebase.auth();db=firebase.firestore();storage=firebase.storage();
  db.enablePersistence({synchronizeTabs:true}).catch(function(){});
})();

// ── BOOTSTRAP ──
async function bootstrapSystem(uid,role){
  try{
    var uRef=db.collection("users").doc(uid);
    if(!(await uRef.get()).exists)await uRef.set({email:auth.currentUser?auth.currentUser.email:"",role,createdAt:firebase.firestore.FieldValue.serverTimestamp(),active:true},{merge:true});
    var sRef=db.collection("settings").doc("global");
    if(!(await sRef.get()).exists)await sRef.set({bizName:"Amina Milk",bizPhone:"",bizAddress:"",defaultQty:1,deliveryStart:"06:00",deliveryEnd:"10:00",currency:"₹",pricePerLitre:0,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    var mRef=db.collection("meta").doc("stats");
    if(!(await mRef.get()).exists)await mRef.set({totalCustomers:0,totalDeliveries:0,totalMilkLitres:0,lastUpdated:firebase.firestore.FieldValue.serverTimestamp()});
    CACHE.set("settings",(await sRef.get()).data()||{});
  }catch(e){console.warn("Bootstrap:",e.message);}
}

// ── AUTH ──
function signIn(e,p){return auth.signInWithEmailAndPassword(e,p);}
function signOut(){return auth.signOut();}
async function getUserRole(uid){
  try{var s=await db.collection("users").doc(uid).get();return s.exists?(s.data().role||null):null;}
  catch{return null;}
}

// ── CUSTOMERS ──
function genCustId(){return"AM"+Date.now().toString(36).toUpperCase().slice(-5)+Math.floor(100+Math.random()*900);}
function genQR(cid){return AM_PREFIX+btoa(unescape(encodeURIComponent(JSON.stringify({t:AM_TOKEN,id:cid,ts:Date.now()}))));}
function validateQR(raw){
  try{
    if(!raw||!raw.startsWith(AM_PREFIX))return null;
    var p=JSON.parse(decodeURIComponent(escape(atob(raw.replace(AM_PREFIX,"")))));
    return p.t===AM_TOKEN?p.id:null;
  }catch{return null;}
}
async function addCustomer(data,uid){
  var cid=genCustId(),qrData=genQR(cid);
  var doc=Object.assign({},data,{customerId:cid,qrData,createdBy:uid,createdAt:firebase.firestore.FieldValue.serverTimestamp(),active:true});
  await db.collection("customers").doc(cid).set(doc);
  db.collection("meta").doc("stats").update({totalCustomers:firebase.firestore.FieldValue.increment(1)}).catch(()=>{});
  CACHE.del("customers");
  return{cid,qrData,doc};
}
async function getCustomers(){
  var snap=await db.collection("customers").where("active","==",true).orderBy("createdAt","desc").get();
  var list=snap.docs.map(d=>Object.assign({id:d.id},d.data()));
  CACHE.set("customers",list);return list;
}
async function updateCustomer(cid,data){CACHE.del("customers");return db.collection("customers").doc(cid).update(data);}
async function deleteCustomer(cid){CACHE.del("customers");return db.collection("customers").doc(cid).update({active:false});}
async function searchCustomers(q){
  q=(q||"").trim().toLowerCase();
  var base=CACHE.get("customers",600000)||(await getCustomers());
  return base.filter(c=>(c.name||"").toLowerCase().includes(q)||(c.mobile||"").includes(q)||(c.customerId||"").toLowerCase().includes(q)||(c.address||"").toLowerCase().includes(q));
}

// ── DELIVERIES ──
async function submitDelivery(d){
  var ds=new Date().toISOString().slice(0,10);
  var dup=await db.collection("deliveries").where("customerId","==",d.customerId).where("date","==",ds).get();
  if(!dup.empty)throw new Error("DUPLICATE");
  d.timestamp=firebase.firestore.FieldValue.serverTimestamp();
  d.date=ds;d.time=new Date().toLocaleTimeString("en-IN");
  var ref=await db.collection("deliveries").add(d);
  db.collection("meta").doc("stats").update({totalDeliveries:firebase.firestore.FieldValue.increment(1),totalMilkLitres:firebase.firestore.FieldValue.increment(d.deliveredQty||0),lastUpdated:firebase.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
  return ref.id;
}
async function updateDelivery(id,data){return db.collection("deliveries").doc(id).update(data);}
async function getTodayDeliveries(){
  var snap=await db.collection("deliveries").where("date","==",new Date().toISOString().slice(0,10)).get();
  return snap.docs.map(d=>Object.assign({id:d.id},d.data()));
}
async function getTodayDeliveryForCustomer(cid){
  var snap=await db.collection("deliveries").where("customerId","==",cid).where("date","==",new Date().toISOString().slice(0,10)).get();
  return snap.empty?null:Object.assign({id:snap.docs[0].id},snap.docs[0].data());
}
async function getDeliveries(f){
  f=f||{};var q=db.collection("deliveries");
  if(f.customerId)q=q.where("customerId","==",f.customerId);
  if(f.staffId)q=q.where("staffId","==",f.staffId);
  if(f.dateFrom)q=q.where("date",">=",f.dateFrom);
  if(f.dateTo)q=q.where("date","<=",f.dateTo);
  var snap=await q.orderBy("date","desc").get();
  return snap.docs.map(d=>Object.assign({id:d.id},d.data()));
}

// ── STAFF ──
var _secApp=null;
async function createStaffUser(email,password,name,phone){
  try{
    if(!_secApp)_secApp=firebase.initializeApp(FIREBASE_CONFIG,"secondary");
  }catch(e){
    // App "secondary" already exists
    _secApp=firebase.app("secondary");
  }
  var secAuth=_secApp.auth();
  var cred=await secAuth.createUserWithEmailAndPassword(email,password);
  var uid=cred.user.uid;
  await secAuth.signOut();
  await db.collection("users").doc(uid).set({name,email,phone:phone||"",role:"staff",createdAt:firebase.firestore.FieldValue.serverTimestamp(),active:true});
  return uid;
}
async function getStaff(){
  var snap=await db.collection("users").where("role","==","staff").where("active","==",true).get();
  return snap.docs.map(d=>Object.assign({id:d.id},d.data()));
}
async function deactivateStaff(uid){return db.collection("users").doc(uid).update({active:false});}

// ── SETTINGS ──
async function getSettings(){
  var c=CACHE.get("settings",3600000);if(c)return c;
  var snap=await db.collection("settings").doc("global").get();
  var data=snap.exists?snap.data():{};CACHE.set("settings",data);return data;
}
async function saveSettings(data){
  await db.collection("settings").doc("global").set(data,{merge:true});
  CACHE.set("settings",Object.assign(CACHE.get("settings",999999)||{},data));
}

// ── SEARCH HISTORY ──
function saveSearchHistory(uid,query,customerId){return db.collection("searchHistory").add({uid,query,customerId,timestamp:firebase.firestore.FieldValue.serverTimestamp()});}
async function getRecentSearches(uid,limit){
  try{var snap=await db.collection("searchHistory").where("uid","==",uid).orderBy("timestamp","desc").limit(limit||8).get();return snap.docs.map(d=>Object.assign({id:d.id},d.data()));}
  catch{return[];}
}
async function getFrequentSearches(uid){
  try{
    var yr=new Date();yr.setFullYear(yr.getFullYear()-1);
    var snap=await db.collection("searchHistory").where("uid","==",uid).where("timestamp",">=",yr).get();
    var freq={};
    snap.docs.forEach(d=>{var x=d.data();if(x.customerId){freq[x.customerId]=freq[x.customerId]||{count:0,query:x.query};freq[x.customerId].count++;}});
    return Object.entries(freq).sort((a,b)=>b[1].count-a[1].count).slice(0,5).map(e=>Object.assign({customerId:e[0]},e[1]));
  }catch{return[];}
}

// ── STATS ──
async function getStats(){
  var ds=new Date().toISOString().slice(0,10);
  var[dSnap,cSnap]=await Promise.all([db.collection("deliveries").where("date","==",ds).get(),db.collection("customers").where("active","==",true).get()]);
  var dels=dSnap.docs.map(d=>d.data());
  return{todayServed:dels.length,totalPending:Math.max(0,cSnap.size-dels.length),totalMilk:dels.reduce((s,d)=>s+(d.deliveredQty||0),0),extraMilk:dels.reduce((s,d)=>s+(d.extraQty||0),0),totalCustomers:cSnap.size};
}

// ── CACHE ──
var CACHE={
  set(k,v){try{localStorage.setItem("am_"+k,JSON.stringify({v,t:Date.now()}));}catch{}},
  get(k,ttl){ttl=ttl||300000;try{var d=JSON.parse(localStorage.getItem("am_"+k));if(d&&Date.now()-d.t<ttl)return d.v;}catch{}return null;},
  del(k){try{localStorage.removeItem("am_"+k);}catch{}}
};

// ── QR HELPERS ──
function renderQR(data,el,size){
  size=size||200;el.innerHTML="";
  if(window.QRCode)new QRCode(el,{text:data,width:size,height:size,correctLevel:QRCode.CorrectLevel.H});
}
function downloadQR(data,filename){
  var div=document.createElement("div");div.style.cssText="position:fixed;left:-9999px;top:-9999px";document.body.appendChild(div);
  renderQR(data,div,400);
  setTimeout(()=>{var c=div.querySelector("canvas");if(c){var a=document.createElement("a");a.href=c.toDataURL("image/png");a.download=(filename||"qr")+".png";a.click();}document.body.removeChild(div);},600);
}
