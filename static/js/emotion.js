import Human from "../vendor/human/human.esm.js";
import {CameraSession, cameraError, populateCameraSelect} from "./camera.js";

const video=document.getElementById("emotion-video"),canvas=document.getElementById("emotion-canvas"),context=canvas.getContext("2d");
const setup=document.getElementById("emotion-setup"),setupCamera=document.getElementById("emotion-setup-camera"),activeCamera=document.getElementById("emotion-camera"),controls=document.getElementById("emotion-controls");
const startButton=document.getElementById("emotion-start"),errorBox=document.getElementById("emotion-error"),progress=document.getElementById("emotion-model-progress"),loadStatus=document.getElementById("emotion-load-status"),status=document.getElementById("emotion-status");
const primary=document.getElementById("emotion-primary"),confidenceBar=document.getElementById("emotion-confidence"),confidenceLabel=document.getElementById("emotion-confidence-label"),ageRange=document.getElementById("age-range"),emotionList=document.getElementById("emotion-list"),tip=document.getElementById("emotion-tip");
const camera=new CameraSession(video);
const human=new Human({
  backend:"webgl",debug:false,async:true,warmup:"none",modelBasePath:"/static/vendor/human/models/",cacheModels:true,
  filter:{enabled:true,autoBrightness:true,equalization:false},
  face:{enabled:true,detector:{enabled:true,modelPath:"blazeface.json",maxDetected:1,minConfidence:.55},mesh:{enabled:true,modelPath:"facemesh.json"},iris:{enabled:false},emotion:{enabled:true,modelPath:"emotion.json",minConfidence:.08},description:{enabled:true,modelPath:"faceres.json",minConfidence:.15},antispoof:{enabled:false},liveness:{enabled:false}},
  body:{enabled:false},hand:{enabled:false},object:{enabled:false},gesture:{enabled:false},segmentation:{enabled:false},
});
let permissionGranted=false,running=false,busy=false,animationFrame=0,lastInference=0,emotionHistory=[],ageHistory=[],modelPromise=null;

function withTimeout(promise,milliseconds,message){let timeoutId;const timeout=new Promise((_,reject)=>{timeoutId=setTimeout(()=>reject(new Error(message)),milliseconds);});return Promise.race([promise,timeout]).finally(()=>clearTimeout(timeoutId));}
function updateModelProgress(width,text){if(progress)progress.style.width=width;if(loadStatus)loadStatus.textContent=text;}
function loadModels(){
  if(modelPromise)return modelPromise;
  const started=performance.now();
  updateModelProgress("8%","Reading local model files...");
  const poll=setInterval(()=>{try{const stats=human.models.stats();const percent=Math.max(8,Math.min(94,Math.round((stats.percentageLoaded||0)*86+8)));updateModelProgress(`${percent}%`,stats.numLoadedModels>0?`Loaded ${stats.numLoadedModels} of 4 face models...`:"Reading local model files...");}catch(error){/* Stats appear after the first manifest opens. */}},120);
  modelPromise=withTimeout(human.load(),30000,"Model initialization exceeded 30 seconds.").then(()=>{
    updateModelProgress("100%",`4 local models ready in ${((performance.now()-started)/1000).toFixed(1)}s`);return true;
  }).catch(error=>{modelPromise=null;updateModelProgress("0%","Model loading stopped. Retry is available.");throw error;}).finally(()=>clearInterval(poll));
  return modelPromise;
}
async function firstStep(){errorBox.textContent="";startButton.disabled=true;try{const devices=await camera.request();permissionGranted=true;populateCameraSelect(setupCamera,devices,camera.activeDeviceId());setupCamera.classList.add("visible");startButton.textContent="Start face analysis";}catch(error){errorBox.textContent=cameraError(error);}finally{startButton.disabled=false;}}
async function startAnalysis(){errorBox.textContent="";startButton.disabled=true;startButton.textContent="Finishing model setup...";try{if(setupCamera.value&&setupCamera.value!==camera.activeDeviceId())await camera.request(setupCamera.value);await loadModels();populateCameraSelect(activeCamera,await camera.devices(),camera.activeDeviceId());setup.classList.add("hidden");controls.hidden=false;status.classList.add("live");status.querySelector("span").textContent="Compiling first real frame...";running=true;loop();}catch(error){errorBox.textContent=`${error.message} Reload the page or retry; camera video was not uploaded.`;startButton.disabled=false;startButton.textContent="Retry model setup";}}

async function loop(){if(!running)return;const now=performance.now();if(!busy&&video.readyState>=2&&now-lastInference>180){lastInference=now;busy=true;try{processResult(await human.detect(video));status.querySelector("span").textContent="4 local face models active";}catch(error){status.querySelector("span").textContent="Analysis recovering";}finally{busy=false;}}animationFrame=requestAnimationFrame(loop);}
function processResult(result){const face=result.face?.[0];if(!face){emotionHistory=[];ageHistory=[];primary.textContent="No face";confidenceLabel.textContent="Move into the camera view";confidenceBar.style.width="0";ageRange.textContent="--";emotionList.innerHTML="";tip.textContent="Center one face in the camera with even light from the front.";drawFace(null);return;}
  const emotions=face.emotion||[];const frame=Object.fromEntries(emotions.map(item=>[item.emotion,item.score]));emotionHistory.push(frame);if(emotionHistory.length>10)emotionHistory.shift();
  if(Number.isFinite(face.age)&&face.age>3&&face.age<100){ageHistory.push(face.age);if(ageHistory.length>24)ageHistory.shift();}
  const labels=["happy","sad","angry","surprise","fear","disgust","neutral"];
  const averaged=labels.map(label=>({label,score:emotionHistory.reduce((sum,item)=>sum+(item[label]||0),0)/emotionHistory.length})).sort((a,b)=>b.score-a.score);
  const top=averaged[0],second=averaged[1];const meshQuality=(face.mesh?.length||0)>=400;const confident=meshQuality&&face.boxScore>=.72&&top.score>=.42&&top.score-second.score>=.08;
  primary.textContent=confident?top.label:"Uncertain";confidenceBar.style.width=`${Math.round(top.score*100)}%`;confidenceLabel.textContent=confident?`${Math.round(top.score*100)}% model confidence`:`Weak or mixed cues · ${Math.round(top.score*100)}%`;
  emotionList.innerHTML=averaged.slice(0,4).map(item=>`<div class="emotion-row"><span>${item.label}</span><div><i style="width:${Math.round(item.score*100)}%"></i></div><b>${Math.round(item.score*100)}</b></div>`).join("");
  if(ageHistory.length>=5){const sorted=[...ageHistory].sort((a,b)=>a-b),age=sorted[Math.floor(sorted.length/2)],margin=Math.max(3,Math.round(age*.09));ageRange.textContent=`~ ${Math.max(4,Math.round(age-margin))}-${Math.round(age+margin)}`;}else ageRange.textContent="Analyzing...";
  tip.textContent=confident?"Stable visible-expression estimate. This describes facial cues, not inner feelings.":"Hold a natural, front-facing pose while the models gather stronger evidence.";drawFace(face,confident?top.label:"uncertain",top.score);
}
function drawFace(face,label="",score=0){const width=canvas.clientWidth,height=canvas.clientHeight,ratio=devicePixelRatio||1;canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,width,height);if(!face)return;const vr=video.videoWidth/Math.max(video.videoHeight,1),cr=width/Math.max(height,1),rw=vr>cr?width:height*vr,rh=vr>cr?width/vr:height,ox=(width-rw)/2,oy=(height-rh)/2;const [bx,by,bw,bh]=face.box;const x=ox+rw-(bx+bw)/video.videoWidth*rw,y=oy+by/video.videoHeight*rh,w=bw/video.videoWidth*rw,h=bh/video.videoHeight*rh;context.strokeStyle="#75b9ec";context.lineWidth=2;context.strokeRect(x,y,w,h);if(face.mesh?.length){context.fillStyle="rgba(117,185,236,.42)";[10,33,263,1,61,291,152].forEach(index=>{const point=face.mesh[index];if(!point)return;const px=ox+rw-point[0]/video.videoWidth*rw,py=oy+point[1]/video.videoHeight*rh;context.beginPath();context.arc(px,py,2,0,Math.PI*2);context.fill();});}context.fillStyle="rgba(3,8,6,.86)";context.fillRect(x,Math.max(0,y-28),Math.max(130,w*.62),28);context.fillStyle="#75b9ec";context.font="650 11px Manrope";context.textAlign="left";context.fillText(`${label.toUpperCase()}  ${Math.round(score*100)}%`,x+8,Math.max(18,y-9));}

startButton.addEventListener("click",()=>permissionGranted?startAnalysis():firstStep());setupCamera.addEventListener("change",async()=>{try{await camera.request(setupCamera.value);}catch(error){errorBox.textContent=cameraError(error);}});activeCamera.addEventListener("change",async()=>{running=false;cancelAnimationFrame(animationFrame);await camera.request(activeCamera.value);running=true;loop();});document.getElementById("emotion-stop").addEventListener("click",()=>{running=false;cancelAnimationFrame(animationFrame);camera.stop();setup.classList.remove("hidden");controls.hidden=true;permissionGranted=false;setupCamera.classList.remove("visible");startButton.disabled=false;startButton.textContent="Allow camera access";status.classList.remove("live");status.querySelector("span").textContent="Camera off";});window.addEventListener("beforeunload",()=>camera.stop());

loadModels().catch(()=>{});
