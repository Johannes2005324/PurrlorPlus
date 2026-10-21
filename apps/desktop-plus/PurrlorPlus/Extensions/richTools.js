// A passive, scoped response tap. Requests and responses are passed through unchanged.
const matrixObservers = new Set(), messageRooms = new Map(), messageAuthors = new Map(), memberNames = new Map();
let feedScope = scope();
function feedEvents(payload, path) {
  const publish = (roomId, events) => {
    if (!Array.isArray(events)) return;
    for (const event of events) {
      if (!event) continue;
      if(event.type==='m.room.member' && typeof event.state_key==='string' && typeof event.content?.displayname==='string') {
        memberNames.set(roomId+'|'+event.state_key,event.content.displayname.slice(0,100));
        if(memberNames.size>4000)memberNames.delete(memberNames.keys().next().value);
      }
      if(typeof event.event_id !== 'string'){for(const listener of matrixObservers)listener(roomId,event);continue;}
      if(typeof event.sender==='string')messageAuthors.set(event.event_id,event.sender);
      if(messageAuthors.size>3000)messageAuthors.delete(messageAuthors.keys().next().value);
      messageRooms.set(event.event_id, roomId);
      if (messageRooms.size > 3000) messageRooms.delete(messageRooms.keys().next().value);
      for (const listener of matrixObservers) listener(roomId,event);
    }
  };
  for (const [id, room] of Object.entries(payload?.rooms?.join || {})) {publish(id,room.state?.events);publish(id,room.timeline?.events);}
  const room=path.match(/\/rooms\/([^/]+)\/(?:messages|context|event|state|members|send|redact)/);
  if(room) {
    const id=decodeURIComponent(room[1]);
    if(Array.isArray(payload))publish(id,payload);
    if(/\/send\/m.room.message\//.test(path) && typeof payload.event_id==='string')messageAuthors.set(payload.event_id,user());
    const redaction=path.match(/\/redact\/([^/]+)\//);
    if(redaction && typeof payload.event_id==='string')publish(id,[{event_id:payload.event_id,type:'m.room.redaction',redacts:decodeURIComponent(redaction[1])}]);
    publish(id,payload.chunk);
    publish(id,payload.events_before);publish(id,payload.events_after);
    if(payload.event)publish(id,[payload.event]);else if(payload.event_id)publish(id,[payload]);
  }
}
const originalFetch = window.fetch;
const tappedFetch = typeof originalFetch==='function' ? function(...args) {
  const expected=scope();
  return originalFetch.apply(this,args).then(response=>{
    if(matrixObservers.size && response.ok)try {
      const requestUrl = typeof args[0]==='string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
      const url=new URL(requestUrl,location.href), base=new URL(stored('nekous_hs_base_url'));
      if(url.origin===base.origin && /\/_matrix\/client\/(?:v3|r0|unstable)\/(?:sync(?:$|\/)|rooms\/)/.test(url.pathname)) {
        response.clone().json().then(payload=>{
          if(scope()!==expected || !matrixObservers.size)return;
          if(feedScope!==expected){messageRooms.clear();messageAuthors.clear();memberNames.clear();feedScope=expected;}
          feedEvents(payload,url.pathname);
        }).catch(()=>undefined);
      }
    }catch { /* Parsing diagnostics cannot affect the application's own response. */ }
    return response;
  });
} : undefined;
if(tappedFetch)window.fetch=tappedFetch;
function disposeMatrixTap(){if(window.fetch===tappedFetch)window.fetch=originalFetch;matrixObservers.clear();messageRooms.clear();messageAuthors.clear();memberNames.clear();}
function currentTimelineRoom(timeline) {
  const explicit=timeline.getAttribute('data-nu-room-id');if(explicit)return explicit;
  const selected=document.querySelector('[data-nu-role="channel-list-item"][aria-current="page"]')?.closest('[data-nu-drag-channel]')?.getAttribute('data-nu-drag-channel');
  const known=new Set([...timeline.querySelectorAll('[data-nu-event-id]')].map(row=>messageRooms.get(row.getAttribute('data-nu-event-id'))).filter(Boolean));
  if(known.size===1)return [...known][0];
  return selected || null;
}
function messageIdentity(row,roomId) {
  const id=row.getAttribute('data-nu-event-id'), senderId=messageAuthors.get(id);
  let senderLabel=row.querySelector('[data-nu-role="timeline-message-sender"]')?.textContent.trim();
  if(!senderLabel && row.classList.contains('nu-timeline__message--grouped')) {
    let previous=row.previousElementSibling;
    for(let n=0;previous && n<50;n++,previous=previous.previousElementSibling){
      if(!previous.matches('[data-nu-role="timeline-message"]'))break;
      senderLabel=previous.querySelector('[data-nu-role="timeline-message-sender"]')?.textContent.trim();
      if(senderLabel || !previous.classList.contains('nu-timeline__message--grouped'))break;
    }
  }
  return {senderId:senderId || null,senderLabel:(senderLabel || memberNames.get(roomId+'|'+senderId) || (senderId===user()?'Du':''))?.slice(0,100) || null};
}
function renderDeletedMessages(journal) {
  for(const timeline of document.querySelectorAll('[data-nu-role="timeline"]')) {
    const room=currentTimelineRoom(timeline), container=timeline.querySelector('.nu-timeline__content') || timeline;
    const eligible=room ? journal.messages.filter(entry=>entry.deletedAt && entry.roomId===room) : [];
    const ids=new Set(eligible.map(entry=>entry.eventId));
    for(const node of timeline.querySelectorAll('[data-purrlorplus-deleted-id]'))if(!ids.has(node.getAttribute('data-purrlorplus-deleted-id')))node.remove();
    for(const entry of eligible) {
      const existing=[...timeline.querySelectorAll('[data-purrlorplus-deleted-id]')].find(node=>node.getAttribute('data-purrlorplus-deleted-id')===entry.eventId);
      const row=existing || document.createElement('div');row.setAttribute('data-purrlorplus-deleted-id',entry.eventId);
      row.style.cssText='color:#ff7777;background:#9f242418;border-left:3px solid #e25050;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere';
      const senderId=entry.senderId || messageAuthors.get(entry.eventId);
      const label=entry.senderLabel || memberNames.get(entry.roomId+'|'+senderId) || (senderId===user()?'Du':senderId) || 'Absender nicht mehr ermittelbar';
      const text=`Gelöscht · ${label}\n${entry.text}`;if(row.textContent!==text)row.textContent=text;
      if(existing)continue;
      const next=[...container.querySelectorAll('[data-nu-event-id]')].find(node=>node.getAttribute('data-nu-event-id')===entry.nextId);
      const previous=[...container.querySelectorAll('[data-nu-event-id]')].find(node=>node.getAttribute('data-nu-event-id')===entry.previousId);
      if(next)next.before(row);else if(previous)previous.after(row);else container.append(row);
    }
  }
}
register({id:'speech',name:'Sprachausgabe und Sprachkanalansagen',rights:'Lokale Sprachausgabe mit vorhandenen Stimmen; sichtbare Teilnehmeränderungen ansagen',start(api){
  const synth=window.speechSynthesis;if(!synth || !window.SpeechSynthesisUtterance)throw Error('Keine Sprachausgabe verfügbar.');
  let previous, channelKey, settingsBox, pending=0;
  const say=text=>{
    if(!text || pending>=5 || scope()!==currentScope)return;
    const utterance=new SpeechSynthesisUtterance(text.slice(0,500));utterance.lang='de-DE';utterance.rate=data.speech.rate;utterance.volume=data.speech.volume;
    const voice=synth.getVoices().find(voice=>voice.voiceURI===data.speech.voice);if(voice)utterance.voice=voice;
    pending++;let finished=false;const done=()=>{if(!finished){finished=true;pending=Math.max(0,pending-1);}};utterance.onend=done;utterance.onerror=done;
    synth.speak(utterance);
  };
  const open=button('Sprachausgabe einstellen',()=>{
    settingsBox=clientSection('speech-settings','Sprachausgabe');if(settingsBox.querySelector('textarea'))return;
    settingsBox.append(paragraph('Vorlagen: {name} = Anzeigename, {channel} = Sprachkanal. Leere Vorlage schaltet diese Ansage aus. Nur Änderungen in einer eindeutig erkennbaren sichtbaren Teilnehmerliste werden angesagt; der Anfangsbestand bleibt still.'));
    const fields={};
    for(const [key,label] of [['join','Beitritt'],['leave','Verlassen']]){const heading=document.createElement('label');heading.textContent=label;const input=document.createElement('textarea');input.id='speech-'+key;input.maxLength=300;input.value=data.speech[key];heading.append(input);settingsBox.append(heading);fields[key]=input;}
    const voices=document.createElement('select');voices.id='speech-voice';voices.setAttribute('aria-label','Stimme');
    const fillVoices=()=>{voices.replaceChildren(new Option('Systemstimme',''));for(const voice of synth.getVoices())voices.append(new Option(`${voice.name} (${voice.lang})${voice.localService?' – lokal':''}`,voice.voiceURI));voices.value=data.speech.voice;};fillVoices();api.listen(synth,'voiceschanged',fillVoices);
    const rate=document.createElement('input');rate.id='speech-rate';rate.type='number';rate.min='.5';rate.max='2';rate.step='.1';rate.value=data.speech.rate;rate.setAttribute('aria-label','Sprechtempo');
    const volume=document.createElement('input');volume.id='speech-volume';volume.type='number';volume.min='0';volume.max='1';volume.step='.1';volume.value=data.speech.volume;volume.setAttribute('aria-label','Lautstärke');
    const free=document.createElement('textarea');free.id='speech-text';free.maxLength=500;free.setAttribute('aria-label','Text vorlesen');
    settingsBox.append(voices,paragraph('Sprechtempo (0,5–2) und Lautstärke (0–1)'),rate,volume,button('Sprachausgabe speichern',()=>{const candidate=validate({...data,speech:{join:fields.join.value,leave:fields.leave.value,voice:voices.value,rate:Number(rate.value),volume:Number(volume.value)}});commit(candidate);}),paragraph('Eigenen Text vorlesen'),free,button('Text vorlesen',()=>say(free.value)),button('Ansage testen',()=>say(data.speech.join.replaceAll('{name}','Beispielbenutzer').replaceAll('{channel}','Beispielkanal'))),button('Sprechen stoppen',()=>{synth.cancel();pending=0;}));
  });shadow.querySelector('#tools').append(open);
  watchMessages(api,()=>{
    const bar=document.querySelector('[data-nu-role="active-call-bar"][data-nu-call-status="ready"]');
    if(!bar){previous=undefined;channelKey=undefined;return;}
    const channel=bar.querySelector('.nu-channel-list__active-call-name')?.textContent.trim();if(!channel)return;
    const rows=[...document.querySelectorAll('[data-nu-role="channel-list-row"]')].filter(row=>row.querySelector('.nu-channel-list__item-name')?.textContent.trim()===channel);
    if(rows.length!==1)return;
    const list=rows[0].querySelector('[data-nu-role="channel-list-occupants"]');if(!list)return;
    const key=rows[0].getAttribute('data-nu-drag-channel') || channel;
    const names=[...list.querySelectorAll('.nu-channel-list__occupant-name')].map(node=>node.textContent.trim()).filter(Boolean);
    const counts=new Map();for(const name of names)counts.set(name,(counts.get(name)||0)+1);
    if(previous && channelKey===key){for(const [name,count] of counts)for(let n=previous.get(name)||0;n<count;n++)say(data.speech.join.replaceAll('{name}',name).replaceAll('{channel}',channel));for(const [name,count]of previous)for(let n=counts.get(name)||0;n<count;n++)say(data.speech.leave.replaceAll('{name}',name).replaceAll('{channel}',channel));}
    previous=counts;channelKey=key;
  });
  api.cleanup(()=>{synth.cancel();open.remove();settingsBox?.remove();});
}});
register({id:'video-controls',name:'Erweiterte Videosteuerung',rights:'Zeitleiste und Sprungtasten; vollständige Videodatei nur nach Auswahl laden',start(api){
  const players=new Map();let active=true;const controllers=new Set();
  function add(video){
    const box=document.createElement('div');box.setAttribute('data-purrlorplus-video','');
    box.style.cssText='display:block;box-sizing:border-box;width:min(100%,520px);padding:8px;margin:6px 0;background:#171c29;color:white;border:1px solid #697da3;border-radius:6px;position:relative;pointer-events:auto;';
    for(const type of ['click','dblclick','pointerdown','mousedown','keydown'])box.addEventListener(type,event=>event.stopPropagation());
    const range=document.createElement('input');range.type='range';range.min=0;range.max=1000;range.value=0;range.setAttribute('aria-label','Videoposition');range.style.width='100%';
    const status=document.createElement('span');let loadedUrl, original=video.getAttribute('src'), restoring=false;
    const listeners=[];const listen=(target,event,fn)=>{target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));};
    const refresh=()=>{const duration=video.duration;range.disabled=!Number.isFinite(duration)||duration<=0;range.value=range.disabled?0:Math.round(video.currentTime/duration*1000);status.textContent=range.disabled?'Videolänge noch unbekannt.':`${Math.floor(video.currentTime)} / ${Math.floor(duration)} Sekunden`;};
    const seek=time=>{if(!Number.isFinite(video.duration)||video.duration<=0){status.textContent='Videodauer unbekannt. Metadaten oder vollständige Datei laden.';return;}try{video.currentTime=Math.max(0,Math.min(time,video.duration));refresh();}catch{report('Position nicht erreichbar. Bei Bedarf Video vollständig laden.');}};
    listen(range,'input',()=>seek(Number(range.value)/1000*video.duration));
    for(const event of ['loadedmetadata','durationchange','timeupdate','seeked'])listen(video,event,refresh);
    const full=button('Video vollständig laden (max. 100 MB)',async()=>{
      if(loadedUrl || restoring)return;const expected=currentScope, src=video.currentSrc || video.src;
      const url=new URL(src,location.href);if(!['https:','http:','blob:'].includes(url.protocol))throw Error('Nicht unterstützte Videoquelle.');
      const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),120000);full.disabled=true;
      try{
        const headers={}, base=stored('nekous_hs_base_url');
        if(base && url.origin===new URL(base).origin && url.pathname.includes('/_matrix/'))headers.Authorization='Bearer '+stored('nekous_access_token');
        const response=await fetch(src,{headers,signal:controller.signal,redirect:'error',credentials:'omit'});if(!response.ok)throw Error(`Video konnte nicht geladen werden (${response.status}).`);
        const max=100*1024*1024;if(Number(response.headers.get('content-length'))>max)throw Error('Video ist größer als 100 MB.');
        if(!response.body?.getReader)throw Error('Begrenztes Herunterladen wird von dieser Laufzeit nicht unterstützt.');
        const reader=response.body.getReader(), chunks=[];let bytes=0;
        while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>max){await reader.cancel();throw Error('Video ist größer als 100 MB.');}chunks.push(part.value);}
        if(!active || scope()!==expected || !video.isConnected)return;
        const position=video.currentTime;loadedUrl=URL.createObjectURL(new Blob(chunks,{type:response.headers.get('content-type') || 'video/mp4'}));video.src=loadedUrl;
        const resume=()=>{video.removeEventListener('loadedmetadata',resume);if(active && scope()===expected)seek(position);};video.addEventListener('loadedmetadata',resume);listeners.push(()=>video.removeEventListener('loadedmetadata',resume));
        report('Videodatei vollständig geladen. Jetzt kann lokal vor- und zurückgesprungen werden.');
      }catch(error){status.textContent=String(error.message || error);throw error;}finally{clearTimeout(timer);controllers.delete(controller);if(active)full.disabled=!!loadedUrl;}
    });
    const metadata=button('Videodaten neu laden',()=>{video.preload='metadata';video.load();status.textContent='Videodaten werden neu geladen …';});
    const popout=button('Eigenen Videoplayer öffnen',()=>{
      shadow.querySelector('#video-player-dialog')?.remove();
      const dialog=document.createElement('section');dialog.id='video-player-dialog';dialog.style.cssText='position:fixed;inset:7vh 7vw;overflow:auto;z-index:2147483647;background:#171c29;padding:12px;border:1px solid #8b9dff;';
      const player=document.createElement('video');player.controls=true;player.preload='metadata';player.playsInline=true;player.src=video.currentSrc || video.src;player.style.cssText='display:block;max-width:100%;max-height:60vh;';
      dialog.append(button('Videoplayer schließen',()=>{player.pause();dialog.remove();}),player);shadow.append(dialog);add(player);
    });
    box.append(metadata,popout,button('−10 Sekunden',()=>seek(video.currentTime-10)),button('+10 Sekunden',()=>seek(video.currentTime+10)),status,range,full);const parent=video.parentElement;if(parent?.classList.contains('nu-file-message__media'))parent.after(box);else video.after(box);players.set(video,{box,get source(){return original;},get loaded(){return loadedUrl;},cleanup(){restoring=true;for(const remove of listeners)remove();box.remove();if(loadedUrl){if(video.getAttribute('src')===loadedUrl){if(original===null)video.removeAttribute('src');else video.setAttribute('src',original);}URL.revokeObjectURL(loadedUrl);}}});refresh();
  }
  watchMessages(api,()=>{for(const [video,record]of players)if(!video.isConnected || (video.getAttribute('src')!==record.source && video.getAttribute('src')!==record.loaded)){record.cleanup();players.delete(video);}for(const video of document.querySelectorAll('video[data-nu-role="timeline-file"],video.nu-file-message__video,[data-nu-role="timeline"] video'))if(!players.has(video))add(video);});
  api.cleanup(()=>{active=false;shadow.querySelector('#video-player-dialog')?.remove();for(const controller of controllers)controller.abort();for(const record of players.values())record.cleanup();players.clear();});
}});
function validLinkDomain(value){return typeof value==='string' && value.length<=253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);}
function rewriteLinkUrl(value){
  try{const url=new URL(value,location.href);if(!['https:','http:'].includes(url.protocol) || url.username || url.password)return value;
    const rule=data.links.rules.find(rule=>rule.from===url.hostname.toLowerCase());if(!rule)return value;url.hostname=rule.to;return url.href;
  }catch{return value;}
}
function rewriteLinkText(text){
  return text.replace(/https?:\/\/[^\s<>"`]+|(?:[a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?::\d{1,5})?(?:[/?#][^\s<>"`]*)?/gi,(match,offset)=>{
    if(offset>0 && /[\w@.-]/.test(text[offset-1]))return match;
    const tail=match.match(/[),.;!]+$/)?.[0] || '', body=tail?match.slice(0,-tail.length):match;
    const explicit=/^https?:\/\//i.test(body), result=rewriteLinkUrl(explicit?body:'https://'+body);
    if(result===(explicit?body:'https://'+body))return match;
    let replacement=explicit?result:result.replace(/^https?:\/\//i,'');if(!explicit && !body.includes('/') && !body.includes('?') && !body.includes('#'))replacement=replacement.replace(/\/$/,'');return replacement+tail;
  });
}
register({id:'links',name:'Automatische Linkumwandlung',rights:'Linkziele lokal ersetzen und eingefügte Nachrichtentexte anpassen',start(api){
  const originals=new Map();let editing=false, settings;
  const refresh=()=>{
    if(!data.links.view)return;
    for(const [anchor,record]of originals)if(!anchor.isConnected){if(anchor.getAttribute('href')===record.changed)anchor.setAttribute('href',record.href);originals.delete(anchor);}
    for(const anchor of document.querySelectorAll('a[href]')){
      const href=anchor.getAttribute('href'), previous=originals.get(anchor);if(previous && href===previous.changed)continue;
      const rewritten=rewriteLinkUrl(href);if(rewritten===href)continue;
      const text=anchor.textContent, changedText=!anchor.childElementCount?rewriteLinkText(text):text;
      originals.set(anchor,{href,text,changed:rewritten,changedText});anchor.setAttribute('href',rewritten);if(changedText!==text)anchor.textContent=changedText;
    }
  };
  const setValue=(field,value,caret)=>{
    const proto=field.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(field,value);
    if(Number.isInteger(caret))field.setSelectionRange(caret,caret);
    field.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
  };
  const eligible=target=>target instanceof Element && (target.matches('textarea,input[type="text"],input:not([type])') || target.isContentEditable) && !target.readOnly && !target.disabled;
  api.listen(document,'paste',event=>{
    const field=event.target;if(!data.links.paste || !eligible(field) || event.clipboardData?.files?.length)return;
    const source=event.clipboardData?.getData('text/plain');if(!source)return;const transformed=rewriteLinkText(source);if(transformed===source)return;
    if(field.isContentEditable){
      const selection=window.getSelection();if(!selection?.rangeCount || !field.contains(selection.anchorNode))return;
      event.preventDefault();event.stopImmediatePropagation();const range=selection.getRangeAt(0);range.deleteContents();const node=document.createTextNode(transformed);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);field.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    }else{const start=field.selectionStart ?? field.value.length,end=field.selectionEnd ?? start;event.preventDefault();event.stopImmediatePropagation();editing=true;try{setValue(field,field.value.slice(0,start)+transformed+field.value.slice(end),start+transformed.length);}finally{editing=false;}}
  },true);
  api.listen(document,'input',event=>{
    const field=event.target;if(!data.links.paste || editing || event.isComposing || !eligible(field) || field.isContentEditable)return;
    const value=field.value, next=rewriteLinkText(value);if(next===value)return;
    const caret=field.selectionStart, adjusted=Number.isInteger(caret)?rewriteLinkText(value.slice(0,caret)).length:undefined;
    editing=true;try{setValue(field,next,adjusted);}finally{editing=false;}
  },true);
  const open=button('Linkumwandlung einstellen',()=>{
    settings=clientSection('link-settings','Automatische Linkumwandlung');if(settings.querySelector('textarea'))return;
    settings.append(paragraph('Eine Regel je Zeile: x.com = fixupx.com. Nur exakt passende Domains werden ersetzt. Änderungen beim Schreiben werden mit der Nachricht gesendet.'));
    const rules=document.createElement('textarea');rules.id='link-rules';rules.maxLength=11000;rules.value=data.links.rules.map(rule=>rule.from+' = '+rule.to).join('\n');
    const view=document.createElement('input');view.type='checkbox';view.checked=data.links.view;view.id='link-view';const viewLabel=document.createElement('label');viewLabel.append(view,'Linkziele in meiner Ansicht ändern');
    const paste=document.createElement('input');paste.type='checkbox';paste.checked=data.links.paste;paste.id='link-paste';const pasteLabel=document.createElement('label');pasteLabel.append(paste,'Links beim Einfügen und Schreiben ändern');
    settings.append(rules,viewLabel,pasteLabel,button('Linkregeln speichern',()=>{
      const parsed=rules.value.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const parts=line.split('=').map(value=>value.trim().toLowerCase());if(parts.length!==2 || !validLinkDomain(parts[0]) || !validLinkDomain(parts[1]))throw Error('Regel benötigt zwei Domainnamen, beispielsweise x.com = fixupx.com.');return {from:parts[0],to:parts[1]};});if(parsed.length>20)throw Error('Höchstens 20 Regeln verwenden.');
      const next=validate({...data,links:{rules:parsed,view:view.checked,paste:paste.checked}});if(commit(next)){reconcile(['links']);render();}
    }));
  });shadow.querySelector('#tools').append(open);watchMessages(api,refresh);
  api.cleanup(()=>{open.remove();settings?.remove();for(const [anchor,record]of originals){if(anchor.getAttribute('href')===record.changed)anchor.setAttribute('href',record.href);if(!anchor.childElementCount && anchor.textContent===record.changedText)anchor.textContent=record.text;}originals.clear();});
}});
register({id:'chat-focus',name:'Nachrichtenfeld automatisch fokussieren',rights:'Beim Chatwechsel und nach dem Senden fokussieren; Klick außerhalb löst den Fokus',start(api){
  let current, key, retained=false, waiting=false, timer;
  const field=()=>document.querySelector('[data-nu-role="composer-input"]');
  const selectionKey=()=>{const selected=document.querySelector('[data-nu-role="channel-list-item"][aria-current="page"]');return selected?.closest('[data-nu-drag-channel]')?.getAttribute('data-nu-drag-channel') || selected?.textContent.trim();};
  const focus=()=>{clearTimeout(timer);timer=setTimeout(()=>{const input=field();if(!retained || scope()!==currentScope || !input || input.readOnly || document.activeElement===host)return;if(input.disabled){waiting=true;return;}input.focus({preventScroll:true});waiting=false;},40);};
  api.listen(document,'click',event=>{
    const target=event.target;if(!(target instanceof Element))return;
    if(target.closest('[data-nu-role="channel-list-item"]')){retained=true;focus();return;}
    if(target.closest('[data-nu-role="composer-send"]')){retained=true;focus();return;}
    const input=field();if(target===input || (input?.contains(target))){retained=true;return;}
    retained=false;clearTimeout(timer);if(document.activeElement===input)input.blur();
  },true);
  api.listen(document,'keydown',event=>{if(event.target===field() && event.key==='Enter' && !event.shiftKey && !event.isComposing){retained=true;focus();}},true);
  const observer=new MutationObserver(()=>{
    const input=field(), selected=document.querySelector('[data-nu-role="channel-list-item"][aria-current="page"]');
    const nextKey=selectionKey();
    const switched=input!==current || nextKey!==key;
    if(switched){current=input;key=nextKey;if(input){retained=true;focus();}}
    else if(waiting && retained && input && !input.disabled && document.activeElement!==input && document.activeElement!==host)focus();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','readonly','aria-current']});
  current=field();key=selectionKey();if(current){retained=true;focus();}
  api.cleanup(()=>{observer.disconnect();retained=false;clearTimeout(timer);});
}});
async function recoverLoggedSender(entry,signal){
  const expected=currentScope, base=stored('nekous_hs_base_url'), token=stored('nekous_access_token');if(!base || !token || !entry.roomId)return null;
  const url=new URL(base);if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))return null;
  const get=async path=>{const response=await fetch(base.replace(/\/$/,'')+'/_matrix/client/v3/'+path,{headers:{Authorization:'Bearer '+token},redirect:'error',credentials:'omit',signal});if(!response.ok || scope()!==expected)return null;const value=await response.json();return scope()===expected?value:null;};
  const event=await get('rooms/'+encodeURIComponent(entry.roomId)+'/event/'+encodeURIComponent(entry.eventId));if(typeof event?.sender!=='string')return null;
  let name=null;try{const member=await get('rooms/'+encodeURIComponent(entry.roomId)+'/state/m.room.member/'+encodeURIComponent(event.sender));if(typeof member?.displayname==='string')name=member.displayname.slice(0,100);}catch{}
  return {senderId:event.sender,senderLabel:name || (event.sender===user()?'Du':null)};
}
