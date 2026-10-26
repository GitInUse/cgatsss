'use strict';
(()=>{
 const $=id=>document.getElementById(id),video=$('camera-preview');
 let stream=null,photoURL=null,canvas=null,generation=0,mode='idle',waitTimer=null,resolveWait=null;
 const status=message=>{$('camera-status').textContent=message;};
 function stopTracks(value){for(const track of value?.getTracks()||[]){track.onended=null;track.stop();}}
 function stopStream(){stopTracks(stream);stream=null;video.pause();video.srcObject=null;}
 function clearPhoto(){if(photoURL)URL.revokeObjectURL(photoURL);photoURL=null;$('photo-preview').removeAttribute('src');$('download-photo').removeAttribute('href');$('download-photo').removeAttribute('download');if(canvas){canvas.width=0;canvas.height=0;canvas=null;}}
 function cancelWait(){clearTimeout(waitTimer);waitTimer=null;if(resolveWait){resolveWait(false);resolveWait=null;}}
 function show(next){
  mode=next;const camera=['requesting','preview','countdown','processing'].includes(mode),photo=['review','approved'].includes(mode);
  $('start-panel').hidden=mode!=='idle';$('camera-panel').hidden=!camera;video.hidden=!camera||!stream;$('photo-preview').hidden=!photo;$('camera-placeholder').hidden=camera||photo;
  $('review-panel').hidden=mode!=='review';$('approved-panel').hidden=mode!=='approved';$('photo-controls').hidden=!photo;$('capture-countdown').hidden=mode!=='countdown';
  $('take-photo').disabled=mode!=='preview'||video.readyState<2||!video.videoWidth||!video.videoHeight;
  $('camera-device').disabled=mode!=='preview';$('countdown-seconds').disabled=mode!=='preview';
 }
 function reset(message='Camera off. Ready for the next guest.'){
  ++generation;cancelWait();stopStream();clearPhoto();$('capture-countdown').textContent='';$('camera-device').replaceChildren();$('device-label').hidden=true;show('idle');status(message);
 }
 function cameraError(error){
  if(['NotAllowedError','SecurityError'].includes(error?.name))return 'Camera permission was not granted. Allow the camera in your browser settings, then try again.';
  if(['NotFoundError','OverconstrainedError'].includes(error?.name))return 'No usable camera was found. Connect your webcam, then try again.';
  if(['NotReadableError','AbortError'].includes(error?.name))return 'The camera could not start. Close other apps using it, then try again.';
  return 'The camera could not complete that action. Please try again.';
 }
 async function start(deviceId){
  reset('Requesting camera permission…');const current=generation;
  if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){status('Camera access needs HTTPS and a supported browser. Open this page in Chrome, Edge, Firefox or Safari.');return;}
  show('requesting');
  try{
   const granted=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:1280},height:{ideal:720},...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:'user'})}});
   if(current!==generation){stopTracks(granted);return;}
   stream=granted;for(const track of stream.getVideoTracks())track.onended=()=>{if(current===generation)reset('Camera disconnected. Reconnect it and choose Start camera.');};
   video.srcObject=stream;await video.play();if(current!==generation)return;show('preview');status('Camera ready. Choose a countdown, then take your photo.');
   try{
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');if(current!==generation)return;
    const selected=stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    $('camera-device').replaceChildren();for(const [i,device]of devices.entries()){const option=document.createElement('option');option.value=device.deviceId;option.textContent=device.label||'Camera '+(i+1);$('camera-device').append(option);}
    if(selected)$('camera-device').value=selected;$('device-label').hidden=devices.length<2;
   }catch{/* Camera selection is optional; capturing still works. */}
  }catch(error){if(current===generation)reset(cameraError(error));}
 }
 const wait=()=>new Promise(resolve=>{resolveWait=resolve;waitTimer=setTimeout(()=>{resolveWait=null;waitTimer=null;resolve(true);},1000);});
 async function capture(){
  if(mode!=='preview'||!stream||video.readyState<2||!video.videoWidth||!video.videoHeight)return;
  const current=generation,seconds=Number($('countdown-seconds').value);if(![0,3,5].includes(seconds))return;
  try{
   for(let remaining=seconds;remaining>0;remaining--){show('countdown');$('capture-countdown').textContent=String(remaining);status('Get ready…');if(!await wait()||current!==generation)return;}
   if(current!==generation)return;show('processing');status('Preparing your photo…');
   if(!video.videoWidth||!video.videoHeight)throw Error('No camera frame');
   canvas=document.createElement('canvas');const scale=Math.min(1,1920/video.videoWidth,1920/video.videoHeight);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
   const context=canvas.getContext('2d');if(!context)throw Error('Canvas unavailable');context.drawImage(video,0,0,canvas.width,canvas.height);
   // Release the webcam as soon as the frame is captured. No microphone is opened.
   stopStream();const capturedCanvas=canvas;const blob=await new Promise(resolve=>capturedCanvas.toBlob(resolve,'image/jpeg',0.88));
   if(current!==generation)return;if(!blob)throw Error('Could not encode photo');photoURL=URL.createObjectURL(blob);$('photo-preview').src=photoURL;canvas.width=0;canvas.height=0;canvas=null;show('review');status('Review your photo. The camera is now off.');
  }catch(error){if(current===generation)reset(cameraError(error));}
 }
 video.addEventListener('loadeddata',()=>{if(mode==='preview')show('preview');});video.addEventListener('canplay',()=>{if(mode==='preview')show('preview');});
 $('start-camera').addEventListener('click',()=>start());$('stop-camera').addEventListener('click',()=>reset('Camera stopped.'));
 $('camera-device').addEventListener('change',()=>{const id=$('camera-device').value;if(id)return start(id);});$('take-photo').addEventListener('click',capture);
 $('retake-photo').addEventListener('click',()=>start());$('finish-photo').addEventListener('click',()=>reset());
 $('approve-photo').addEventListener('click',()=>{if(mode!=='review'||!photoURL)return;$('download-photo').href=photoURL;$('download-photo').download='party-photo-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jpg';show('approved');status('Save a copy if you want, or finish to clear it.');});
 addEventListener('pagehide',()=>reset());addEventListener('pageshow',()=>reset('Ready. Start the camera when you want to take a photo.'));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)reset('Camera stopped and photo cleared while you were away.');});
 show('idle');
})();
