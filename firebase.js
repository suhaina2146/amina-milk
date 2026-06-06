// ============================================================
// AMINA MILK – firebase.js  v3.1 (GREEN THEME + FIXED ID CARD)
// ============================================================
var FIREBASE_CONFIG={apiKey:"AIzaSyCjHkVkZb2RUjPG-dFi_Q1hYVDhY8OtKw8",authDomain:"educational-notification.firebaseapp.com",projectId:"educational-notification",storageBucket:"educational-notification.firebasestorage.app",messagingSenderId:"811687039959",appId:"1:811687039959:web:5227b6a5f234bf632c7192"};
var AM_TOKEN="AMINA_MILK_SECURE_v1_2025",AM_PREFIX="AMINAMILK://";
var auth,db,storage;
(function(){
  if(!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);
  auth=firebase.auth();db=firebase.firestore();storage=firebase.storage();
  db.enablePersistence({synchronizeTabs:true}).catch(function(e){console.warn("Persistence:",e.code);});
})();

// ── BOOTSTRAP ──
async function bootstrapSystem(uid,role){
  try{
    var uRef=db.collection("users").doc(uid);
    var uSnap=await uRef.get();
    if(!uSnap.exists){
      await uRef.set({email:auth.currentUser?.email||"",role,createdAt:firebase.firestore.FieldValue.serverTimestamp(),active:true},{merge:true});
    }
    var sRef=db.collection("settings").doc("global");
    var sSnap=await sRef.get();
    if(!sSnap.exists){
      await sRef.set({bizName:"Amina Milk",bizPhone:"",bizAddress:"",defaultQty:1,deliveryStart:"06:00",deliveryEnd:"10:00",currency:"₹",pricePerLitre:0,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    }
    var mRef=db.collection("meta").doc("stats");
    var mSnap=await mRef.get();
    if(!mSnap.exists){
      await mRef.set({totalCustomers:0,totalDeliveries:0,totalMilkLitres:0,lastUpdated:firebase.firestore.FieldValue.serverTimestamp()});
    }
    var settData=(await sRef.get()).data()||{};
    CACHE.set("settings",settData);
  }catch(e){console.warn("Bootstrap:",e.message);}
}

// ── AUTH ──
function signIn(e,p){return auth.signInWithEmailAndPassword(e,p);}
function signOut(){return auth.signOut();}
async function getUserRole(uid){
  try{
    var s=await db.collection("users").doc(uid).get();
    return s.exists?(s.data().role||null):null;
  }catch{return null;}
}

// ── CUSTOMERS ──
function genCustId(){return"AM"+Date.now().toString(36).toUpperCase().slice(-5)+Math.floor(100+Math.random()*900);}
function genQR(cid){
  return AM_PREFIX+btoa(unescape(encodeURIComponent(JSON.stringify({t:AM_TOKEN,id:cid,ts:Date.now()}))));
}
function validateQR(raw){
  try{
    if(!raw||!raw.startsWith(AM_PREFIX))return null;
    var p=JSON.parse(decodeURIComponent(escape(atob(raw.replace(AM_PREFIX,"")))));
    return p.t===AM_TOKEN?p.id:null;
  }catch{return null;}
}

async function addCustomer(data,uid){
  var cid=genCustId(),qrData=genQR(cid);
  var doc=Object.assign({},data,{
    customerId:cid,qrData,createdBy:uid,
    createdAt:firebase.firestore.FieldValue.serverTimestamp(),
    active:true
  });
  await db.collection("customers").doc(cid).set(doc);
  db.collection("meta").doc("stats").update({totalCustomers:firebase.firestore.FieldValue.increment(1)}).catch(()=>{});
  CACHE.del("customers");
  return{cid,qrData,doc};
}

async function getCustomers(){
  try{
    var snap=await db.collection("customers").where("active","==",true).orderBy("createdAt","desc").get();
    var list=snap.docs.map(function(d){return Object.assign({id:d.id},d.data());});
    CACHE.set("customers",list);
    return list;
  }catch(e){
    var snap2=await db.collection("customers").where("active","==",true).get();
    var list2=snap2.docs.map(function(d){return Object.assign({id:d.id},d.data());});
    CACHE.set("customers",list2);
    return list2;
  }
}

async function getCustomerById(cid){
  try{
    var d=await db.collection("customers").doc(cid).get();
    if(d.exists)return Object.assign({id:d.id},d.data());
  }catch(e){}
  try{
    var q=await db.collection("customers").where("customerId","==",cid).where("active","==",true).limit(1).get();
    if(!q.empty)return Object.assign({id:q.docs[0].id},q.docs[0].data());
  }catch(e){}
  try{
    var qm=await db.collection("customers").where("mobile","==",cid).where("active","==",true).limit(1).get();
    if(!qm.empty)return Object.assign({id:qm.docs[0].id},qm.docs[0].data());
  }catch(e){}
  return null;
}

async function updateCustomer(cid,data){
  CACHE.del("customers");
  return db.collection("customers").doc(cid).update(data);
}

async function deleteCustomer(cid){
  CACHE.del("customers");
  return db.collection("customers").doc(cid).update({active:false});
}

async function searchCustomers(q){
  q=(q||"").trim().toLowerCase();
  var base=CACHE.get("customers",600000)||(await getCustomers());
  return base.filter(function(c){
    return(c.name||"").toLowerCase().includes(q)||(c.mobile||"").includes(q)||
      (c.customerId||"").toLowerCase().includes(q)||(c.address||"").toLowerCase().includes(q);
  });
}

// ── DELIVERIES ──
async function submitDelivery(d){
  var ds=d.date||new Date().toISOString().slice(0,10);
  d.timestamp=firebase.firestore.FieldValue.serverTimestamp();
  d.date=ds;
  d.time=new Date().toLocaleTimeString("en-IN");
  if(!d.shift)d.shift="morning";
  var ref=await db.collection("deliveries").add(d);
  db.collection("meta").doc("stats").update({
    totalDeliveries:firebase.firestore.FieldValue.increment(1),
    totalMilkLitres:firebase.firestore.FieldValue.increment(d.deliveredQty||0),
    lastUpdated:firebase.firestore.FieldValue.serverTimestamp()
  }).catch(()=>{});
  return ref.id;
}

async function updateDelivery(id,data){
  return db.collection("deliveries").doc(id).update(data);
}

async function getTodayDeliveryForCustomerShift(cid,shift){
  var today=new Date().toISOString().slice(0,10);
  try{
    var snap=await db.collection("deliveries")
      .where("customerId","==",cid)
      .where("date","==",today)
      .where("shift","==",shift)
      .get();
    if(snap.empty)return null;
    return Object.assign({id:snap.docs[0].id},snap.docs[0].data());
  }catch(e){
    var snap2=await db.collection("deliveries")
      .where("customerId","==",cid)
      .where("date","==",today)
      .get();
    if(snap2.empty)return null;
    var found=snap2.docs.find(function(d){return d.data().shift===shift;});
    return found?Object.assign({id:found.id},found.data()):null;
  }
}

async function getTodayDeliveries(shift){
  var today=new Date().toISOString().slice(0,10);
  try{
    var q=db.collection("deliveries").where("date","==",today);
    if(shift)q=q.where("shift","==",shift);
    var snap=await q.get();
    return snap.docs.map(function(d){return Object.assign({id:d.id},d.data());});
  }catch(e){
    var snap2=await db.collection("deliveries").where("date","==",today).get();
    var list=snap2.docs.map(function(d){return Object.assign({id:d.id},d.data());});
    if(shift)list=list.filter(function(d){return d.shift===shift;});
    return list;
  }
}

async function getDeliveries(f){
  f=f||{};
  var q=db.collection("deliveries");
  var snap;
  try{
    if(f.customerId)q=q.where("customerId","==",f.customerId);
    if(f.staffId)q=q.where("staffId","==",f.staffId);
    if(f.shift)q=q.where("shift","==",f.shift);
    if(f.dateFrom)q=q.where("date",">=",f.dateFrom);
    if(f.dateTo)q=q.where("date","<=",f.dateTo);
    snap=await q.get();
  }catch(e){
    var q2=db.collection("deliveries");
    if(f.customerId)q2=q2.where("customerId","==",f.customerId);
    else if(f.staffId)q2=q2.where("staffId","==",f.staffId);
    snap=await q2.get();
  }
  var list=snap.docs.map(function(d){return Object.assign({id:d.id},d.data());});
  if(f.dateFrom)list=list.filter(function(d){return(d.date||"")>=f.dateFrom;});
  if(f.dateTo)list=list.filter(function(d){return(d.date||"")<=f.dateTo;});
  if(f.staffId&&f.customerId)list=list.filter(function(d){return d.staffId===f.staffId;});
  if(f.shift)list=list.filter(function(d){return d.shift===f.shift;});
  list.sort(function(a,b){
    var dd=b.date.localeCompare(a.date);
    if(dd!==0)return dd;
    return(b.time||"").localeCompare(a.time||"");
  });
  return list;
}

// ── STAFF ──
var _secApp=null;
async function createStaffUser(email,password,name,phone){
  try{if(!_secApp)_secApp=firebase.initializeApp(FIREBASE_CONFIG,"secondary");}
  catch(e){_secApp=firebase.app("secondary");}
  var secAuth=_secApp.auth();
  var cred=await secAuth.createUserWithEmailAndPassword(email,password);
  var uid=cred.user.uid;
  await secAuth.signOut();
  await db.collection("users").doc(uid).set({
    name,email,phone:phone||"",role:"staff",
    createdAt:firebase.firestore.FieldValue.serverTimestamp(),active:true
  });
  return uid;
}

async function getStaff(){
  var snap=await db.collection("users").where("role","==","staff").where("active","==",true).get();
  return snap.docs.map(function(d){return Object.assign({id:d.id},d.data());});
}

async function deactivateStaff(uid){
  return db.collection("users").doc(uid).update({active:false});
}

// ── SETTINGS ──
async function getSettings(){
  var c=CACHE.get("settings",3600000);
  if(c&&Object.keys(c).length>0)return c;
  try{
    var snap=await db.collection("settings").doc("global").get();
    var data=snap.exists?snap.data():{};
    CACHE.set("settings",data);
    return data;
  }catch(e){
    return CACHE.get("settings",999999*999)||{};
  }
}

async function saveSettings(data){
  await db.collection("settings").doc("global").set(data,{merge:true});
  var current=CACHE.get("settings",999999)||{};
  CACHE.set("settings",Object.assign(current,data));
}

// ── SEARCH HISTORY ──
function saveSearchHistory(uid,query,customerId){
  return db.collection("searchHistory").add({
    uid,query,customerId,
    timestamp:firebase.firestore.FieldValue.serverTimestamp()
  });
}

async function getRecentSearches(uid,limit){
  try{
    var snap=await db.collection("searchHistory")
      .where("uid","==",uid)
      .orderBy("timestamp","desc")
      .limit(limit||8)
      .get();
    return snap.docs.map(function(d){return Object.assign({id:d.id},d.data());});
  }catch{return[];}
}

// ── STATS ──
async function getStats(){
  var ds=new Date().toISOString().slice(0,10);
  try{
    var[dSnap,cSnap]=await Promise.all([
      db.collection("deliveries").where("date","==",ds).get(),
      db.collection("customers").where("active","==",true).get()
    ]);
    var dels=dSnap.docs.map(function(d){return d.data();});
    var uniqueCusts=new Set(dels.map(function(d){return d.customerId;}));
    return{
      todayServed:uniqueCusts.size,
      todayDeliveries:dels.length,
      totalPending:Math.max(0,cSnap.size-uniqueCusts.size),
      totalMilk:dels.reduce(function(s,d){return s+(d.deliveredQty||0);},0),
      extraMilk:dels.reduce(function(s,d){return s+(d.extraQty||0);},0),
      totalCustomers:cSnap.size,
      morningCount:dels.filter(function(d){return d.shift==="morning";}).length,
      eveningCount:dels.filter(function(d){return d.shift==="evening";}).length
    };
  }catch(e){
    console.error("getStats:",e);
    return{todayServed:0,todayDeliveries:0,totalPending:0,totalMilk:0,extraMilk:0,totalCustomers:0,morningCount:0,eveningCount:0};
  }
}

// ── CACHE ──
var CACHE={
  set:function(k,v){try{localStorage.setItem("am_"+k,JSON.stringify({v,t:Date.now()}));}catch(e){}},
  get:function(k,ttl){
    ttl=ttl||300000;
    try{
      var raw=localStorage.getItem("am_"+k);
      if(!raw)return null;
      var d=JSON.parse(raw);
      if(d&&Date.now()-d.t<ttl)return d.v;
    }catch(e){}
    return null;
  },
  del:function(k){try{localStorage.removeItem("am_"+k);}catch(e){}}
};

// ── QR HELPERS ──
function renderQR(data,el,size){
  size=size||200;
  el.innerHTML="";
  if(window.QRCode){
    new QRCode(el,{text:data,width:size,height:size,correctLevel:QRCode.CorrectLevel.H});
  }
}

// ── HELPER: rounded rectangle path ──
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

// ── ID CARD GENERATOR — GREEN THEME, FIXED ALIGNMENT ──
function generateIDCard(cust,callback){
  var W=900,H=400;
  var canvas=document.createElement("canvas");
  canvas.width=W;canvas.height=H;
  var ctx=canvas.getContext("2d");

  // Background — deep green
  var bgGrd=ctx.createLinearGradient(0,0,W,H);
  bgGrd.addColorStop(0,"#0a2e18");
  bgGrd.addColorStop(0.45,"#14532d");
  bgGrd.addColorStop(1,"#166534");
  ctx.fillStyle=bgGrd;
  ctx.fillRect(0,0,W,H);

  // Decorative circles
  ctx.save();ctx.globalAlpha=0.07;ctx.fillStyle="#fff";
  ctx.beginPath();ctx.arc(W+60,-60,220,0,Math.PI*2);ctx.fill();
  ctx.restore();
  ctx.save();ctx.globalAlpha=0.05;ctx.fillStyle="#fff";
  ctx.beginPath();ctx.arc(-60,H+60,200,0,Math.PI*2);ctx.fill();
  ctx.restore();

  // Left accent bar
  ctx.fillStyle="#22c55e";
  ctx.fillRect(0,0,6,H);

  // Top accent line
  var topLine=ctx.createLinearGradient(0,0,W,0);
  topLine.addColorStop(0,"#22c55e");
  topLine.addColorStop(1,"transparent");
  ctx.fillStyle=topLine;
  ctx.fillRect(6,0,W-6,3);

  // === LEFT COLUMN (x=30 to x=610) ===
  ctx.textAlign="left";

  // Brand label
  ctx.fillStyle="#4ade80";
  ctx.font="bold 12px Arial";
  ctx.fillText("AMINA MILK",30,34);

  ctx.fillStyle="rgba(255,255,255,0.4)";
  ctx.font="10px Arial";
  ctx.fillText("CUSTOMER ID CARD",30,50);

  // Divider
  ctx.strokeStyle="rgba(74,222,128,0.22)";
  ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(30,60);ctx.lineTo(600,60);ctx.stroke();

  // Customer name
  ctx.fillStyle="#f0fdf4";
  ctx.font="bold 32px Arial";
  var displayName=(cust.name||"").slice(0,22);
  ctx.fillText(displayName,30,102);

  // Customer ID chip
  var cidText=cust.customerId||"";
  ctx.font="bold 12px Arial";
  var cidMeasure=ctx.measureText(cidText).width;
  var chipW=cidMeasure+24;
  ctx.fillStyle="rgba(74,222,128,0.15)";
  roundRect(ctx,30,112,chipW,24,5);
  ctx.fill();
  ctx.strokeStyle="rgba(74,222,128,0.35)";
  ctx.lineWidth=1;
  roundRect(ctx,30,112,chipW,24,5);
  ctx.stroke();
  ctx.fillStyle="#4ade80";
  ctx.font="bold 12px Arial";
  ctx.fillText(cidText,42,129);

  // Meta info rows
  var metaItems=[
    {icon:"📱",label:"MOBILE",value:cust.mobile||"—"},
    {icon:"📍",label:"ADDRESS",value:(cust.address||"—").slice(0,38)},
    {icon:"🥛",label:"MILK TYPE",value:cust.milkType||"—"},
    {icon:"📦",label:"DAILY QTY",value:(parseFloat(cust.defaultQty)||1)+"L / day"}
  ];

  var my=158;
  metaItems.forEach(function(item){
    // Label line
    ctx.fillStyle="rgba(255,255,255,0.42)";
    ctx.font="10px Arial";
    ctx.fillText(item.icon+"  "+item.label,30,my);
    // Value line
    ctx.fillStyle="#e2f5e8";
    ctx.font="bold 14px Arial";
    ctx.fillText(item.value,30,my+17);
    my+=44;
  });

  // Valid card badge
  ctx.fillStyle="rgba(74,222,128,0.10)";
  roundRect(ctx,30,H-44,268,28,7);
  ctx.fill();
  ctx.strokeStyle="rgba(74,222,128,0.22)";
  ctx.lineWidth=1;
  roundRect(ctx,30,H-44,268,28,7);
  ctx.stroke();
  ctx.fillStyle="#4ade80";
  ctx.font="bold 11px Arial";
  ctx.fillText("✓  Valid AMINA MILK Customer Card",44,H-25);

  // === RIGHT COLUMN — QR panel (x=630, w=240) ===
  var pX=640,pY=20,pW=232,pH=H-40;
  ctx.fillStyle="rgba(255,255,255,0.055)";
  roundRect(ctx,pX,pY,pW,pH,14);
  ctx.fill();
  ctx.strokeStyle="rgba(74,222,128,0.15)";
  ctx.lineWidth=1;
  roundRect(ctx,pX,pY,pW,pH,14);
  ctx.stroke();

  ctx.fillStyle="rgba(255,255,255,0.60)";
  ctx.font="bold 11px Arial";
  ctx.textAlign="center";
  ctx.fillText("SCAN TO DELIVER",pX+pW/2,pY+24);

  // QR generation
  var qDiv=document.createElement("div");
  qDiv.style.cssText="position:fixed;left:-9999px;top:-9999px";
  document.body.appendChild(qDiv);

  if(window.QRCode&&cust.qrData){
    new QRCode(qDiv,{text:cust.qrData,width:180,height:180,correctLevel:QRCode.CorrectLevel.H});
    setTimeout(function(){
      var qCanvas=qDiv.querySelector("canvas");
      var qrSize=182;
      var qrX=pX+(pW-qrSize)/2;
      var qrY=pY+36;

      // White backing for QR
      ctx.fillStyle="#ffffff";
      roundRect(ctx,qrX-5,qrY-5,qrSize+10,qrSize+10,10);
      ctx.fill();

      if(qCanvas){
        ctx.drawImage(qCanvas,qrX,qrY,qrSize,qrSize);
      }

      // Customer ID below QR
      ctx.fillStyle="rgba(255,255,255,0.50)";
      ctx.font="11px Arial";
      ctx.textAlign="center";
      ctx.fillText(cust.customerId||"",pX+pW/2,qrY+qrSize+18);

      // ACTIVE chip
      var chipW2=74,chipH2=20;
      var chipX2=pX+(pW-chipW2)/2;
      var chipY2=qrY+qrSize+26;
      ctx.fillStyle="rgba(74,222,128,0.15)";
      roundRect(ctx,chipX2,chipY2,chipW2,chipH2,10);
      ctx.fill();
      ctx.strokeStyle="rgba(74,222,128,0.38)";
      ctx.lineWidth=1;
      roundRect(ctx,chipX2,chipY2,chipW2,chipH2,10);
      ctx.stroke();
      ctx.fillStyle="#4ade80";
      ctx.font="bold 10px Arial";
      ctx.textAlign="center";
      ctx.fillText("● ACTIVE",pX+pW/2,chipY2+14);

      ctx.textAlign="left";
      document.body.removeChild(qDiv);
      if(callback)callback(canvas);
    },600);
  }else{
    document.body.removeChild(qDiv);
    ctx.textAlign="left";
    if(callback)callback(canvas);
  }
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
  var div=document.createElement("div");div.style.cssText="position:fixed;left:-9999px;top:-9999px";
  document.body.appendChild(div);
  renderQR(data,div,400);
  setTimeout(function(){
    var c=div.querySelector("canvas");
    if(c){var a=document.createElement("a");a.href=c.toDataURL("image/png");a.download=(filename||"qr")+".png";a.click();}
    document.body.removeChild(div);
  },600);
}
