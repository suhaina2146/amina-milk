// ============================================================
// AMINA MILK – firebase.js  v2.0
// ============================================================
var FIREBASE_CONFIG={apiKey:"AIzaSyCjHkVkZb2RUjPG-dFi_Q1hYVDhY8OtKw8",authDomain:"educational-notification.firebaseapp.com",projectId:"educational-notification",storageBucket:"educational-notification.firebasestorage.app",messagingSenderId:"811687039959",appId:"1:811687039959:web:5227b6a5f234bf632c7192"};
var AM_TOKEN="AMINA_MILK_SECURE_v1_2025",AM_PREFIX="AMINAMILK://";
var auth,db,storage;
(function(){if(!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);auth=firebase.auth();db=firebase.firestore();storage=firebase.storage();db.enablePersistence({synchronizeTabs:true}).catch(()=>{});})();

// ── BOOTSTRAP ──
async function bootstrapSystem(uid,role){
  try{
    var uRef=db.collection("users").doc(uid);
    if(!(await uRef.get()).exists)await uRef.set({email:auth.currentUser?.email||"",role,createdAt:firebase.firestore.FieldValue.serverTimestamp(),active:true},{merge:true});
    var sRef=db.collection("settings").doc("global");
    if(!(await sRef.get()).exists)await sRef.set({bizName:"Amina Milk",bizPhone:"",bizAddress:"",defaultQty:1,deliveryStart:"06:00",deliveryEnd:"10:00",currency:"₹",createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    CACHE.set("settings",(await sRef.get()).data()||{});
  }catch(e){console.warn("Bootstrap:",e.message);}
}

// ── AUTH ──
function signIn(e,p){return auth.signInWithEmailAndPassword(e,p);}
function signOut(){return auth.signOut();}
async function getUserRole(uid){try{var s=await db.collection("users").doc(uid).get();return s.exists?(s.data().role||null):null;}catch{return null;}}

// ── CUSTOMERS ──
function genCustId(){return"AM"+Date.now().toString(36).toUpperCase().slice(-5)+Math.floor(100+Math.random()*900);}
function genQR(cid){return AM_PREFIX+btoa(unescape(encodeURIComponent(JSON.stringify({t:AM_TOKEN,id:cid,ts:Date.now()}))));}
function validateQR(raw){
  try{if(!raw||!raw.startsWith(AM_PREFIX))return null;var p=JSON.parse(decodeURIComponent(escape(atob(raw.replace(AM_PREFIX,"")))));return p.t===AM_TOKEN?p.id:null;}catch{return null;}
}
async function addCustomer(data,uid){
  var cid=genCustId(),qrData=genQR(cid);
  var doc=Object.assign({},data,{customerId:cid,qrData,createdBy:uid,createdAt:firebase.firestore.FieldValue.serverTimestamp(),active:true});
  await db.collection("customers").doc(cid).set(doc);
  db.collection("meta").doc("stats").update({totalCustomers:firebase.firestore.FieldValue.increment(1)}).catch(()=>{});
  CACHE.del("customers");return{cid,qrData,doc};
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
  d.timestamp=firebase.firestore.FieldValue.serverTimestamp();d.date=ds;d.time=new Date().toLocaleTimeString("en-IN");
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
  try{if(!_secApp)_secApp=firebase.initializeApp(FIREBASE_CONFIG,"secondary");}
  catch(e){_secApp=firebase.app("secondary");}
  var secAuth=_secApp.auth();
  var cred=await secAuth.createUserWithEmailAndPassword(email,password);
  var uid=cred.user.uid;await secAuth.signOut();
  await db.collection("users").doc(uid).set({name,email,phone:phone||"",role:"staff",createdAt:firebase.firestore.FieldValue.serverTimestamp(),active:true});
  return uid;
}
async function getStaff(){var snap=await db.collection("users").where("role","==","staff").where("active","==",true).get();return snap.docs.map(d=>Object.assign({id:d.id},d.data()));}
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
  try{var snap=await db.collection("searchHistory").where("uid","==",uid).orderBy("timestamp","desc").limit(limit||8).get();return snap.docs.map(d=>Object.assign({id:d.id},d.data()));}catch{return[];}
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

// ── ID CARD GENERATOR (Landscape, downloadable PNG) ──
function generateIDCard(cust,callback){
  // cust: {name, customerId, mobile, address, qrData}
  var W=900,H=380;
  var canvas=document.createElement("canvas");
  canvas.width=W;canvas.height=H;
  var ctx=canvas.getContext("2d");

  // Background gradient
  var grd=ctx.createLinearGradient(0,0,W,H);
  grd.addColorStop(0,"#0f1a2e");grd.addColorStop(1,"#1c2b42");
  ctx.fillStyle=grd;ctx.fillRect(0,0,W,H);

  // Gold accent bar left
  ctx.fillStyle="#f59e0b";ctx.fillRect(0,0,8,H);

  // Gold accent line top
  var lg=ctx.createLinearGradient(0,0,W,0);
  lg.addColorStop(0,"#f59e0b");lg.addColorStop(1,"transparent");
  ctx.fillStyle=lg;ctx.fillRect(8,0,W-8,3);

  // Logo/Brand area
  ctx.fillStyle="#f59e0b";
  ctx.font="bold 28px Arial";ctx.fillText("🥛",30,55);
  ctx.font="bold 32px Arial";ctx.fillText("AMINA MILK",68,58);

  ctx.fillStyle="rgba(255,255,255,0.15)";
  ctx.font="13px Arial";ctx.fillText("CUSTOMER ID CARD",68,80);

  // Divider
  ctx.strokeStyle="rgba(245,158,11,0.3)";ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(30,95);ctx.lineTo(560,95);ctx.stroke();

  // Customer Name
  ctx.fillStyle="#f1f5f9";ctx.font="bold 38px Arial";
  ctx.fillText(cust.name||"",30,145);

  // Fields
  var fields=[
    ["📱 Mobile",cust.mobile||"—"],
    ["📍 Address",cust.address||"—"],
    ["🆔 Customer ID",cust.customerId||""],
    ["🥛 Default Qty",(cust.defaultQty||1)+"L per day"]
  ];
  ctx.font="15px Arial";
  fields.forEach((f,i)=>{
    var y=185+i*46;
    ctx.fillStyle="#94a3b8";ctx.fillText(f[0],30,y);
    ctx.fillStyle="#f1f5f9";ctx.font="bold 18px Arial";
    ctx.fillText(f[1].length>38?f[1].slice(0,36)+"…":f[1],30,y+20);
    ctx.font="15px Arial";
  });

  // Bottom badge
  ctx.fillStyle="rgba(245,158,11,0.12)";
  roundRect(ctx,30,H-50,260,34,8);ctx.fill();
  ctx.fillStyle="#f59e0b";ctx.font="bold 13px Arial";
  ctx.fillText("✓ Valid AMINA MILK Customer Card",44,H-28);

  // QR section (right side)
  ctx.fillStyle="rgba(255,255,255,0.05)";
  roundRect(ctx,W-290,20,260,H-40,16);ctx.fill();
  ctx.strokeStyle="rgba(245,158,11,0.2)";ctx.lineWidth=1;
  roundRect(ctx,W-290,20,260,H-40,16);ctx.stroke();

  ctx.fillStyle="rgba(255,255,255,0.7)";ctx.font="bold 13px Arial";ctx.textAlign="center";
  ctx.fillText("SCAN TO DELIVER",W-160,50);

  // Render QR onto a temp div, then draw canvas
  var qDiv=document.createElement("div");qDiv.style.cssText="position:fixed;left:-9999px;top:-9999px";
  document.body.appendChild(qDiv);
  if(window.QRCode){
    new QRCode(qDiv,{text:cust.qrData,width:200,height:200,correctLevel:QRCode.CorrectLevel.H});
    setTimeout(()=>{
      var qCanvas=qDiv.querySelector("canvas");
      if(qCanvas){
        // White background for QR
        ctx.fillStyle="#ffffff";
        roundRect(ctx,W-270,60,220,220,10);ctx.fill();
        ctx.drawImage(qCanvas,W-265,65,210,210);
      }
      ctx.fillStyle="#94a3b8";ctx.font="13px Arial";ctx.textAlign="center";
      ctx.fillText(cust.customerId,W-160,300);
      ctx.fillStyle="rgba(245,158,11,0.6)";ctx.font="11px Arial";
      ctx.fillText("AMINA MILK QR • DO NOT SHARE",W-160,320);

      // Watermark pattern
      ctx.textAlign="left";
      document.body.removeChild(qDiv);
      if(callback)callback(canvas);
    },600);
  }else{
    document.body.removeChild(qDiv);
    if(callback)callback(canvas);
  }
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}

function downloadIDCard(cust){
  generateIDCard(cust,function(canvas){
    var a=document.createElement("a");
    a.href=canvas.toDataURL("image/png");
    a.download=(cust.customerId||"customer")+"_ID_Card.png";
    a.click();
  });
}

function downloadQR(data,filename){
  var div=document.createElement("div");div.style.cssText="position:fixed;left:-9999px;top:-9999px";document.body.appendChild(div);
  renderQR(data,div,400);
  setTimeout(()=>{var c=div.querySelector("canvas");if(c){var a=document.createElement("a");a.href=c.toDataURL("image/png");a.download=(filename||"qr")+".png";a.click();}document.body.removeChild(div);},600);
}
