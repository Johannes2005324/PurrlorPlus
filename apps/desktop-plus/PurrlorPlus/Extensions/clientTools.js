// Bundled, trusted tools. The journal contains only observations made while enabled.
const journalKey = () => 'purrlorplus:journal:v1:' + currentScope;
function readJournal() {
  const raw = localStorage.getItem(journalKey());
  if (!raw) return { version: 1, messages: [], permissions: [] };
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.messages) || !Array.isArray(value.permissions)) throw Error('Das lokale Protokoll ist beschädigt. Es wurde nicht überschrieben.');
  if (value.messages.some(item => !item || typeof item.eventId !== 'string' || typeof item.text !== 'string' || typeof item.firstSeenAt !== 'string' || (item.variants !== undefined && !Array.isArray(item.variants))) || value.permissions.some(item => !item || typeof item.roomId !== 'string')) throw Error('Ungültige Protokolleinträge. Vorhandene Daten wurden nicht überschrieben.');
  return { version: 1, messages: value.messages.slice(-500), permissions: value.permissions.slice(-10) };
}
function writeJournal(journal) { localStorage.setItem(journalKey(), JSON.stringify(journal)); }
function downloadJson(name, value) {
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)], {type:'application/json'}));
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
function heading(text) { const h = document.createElement('h3'); h.textContent = text; return h; }
function paragraph(text) { const p = document.createElement('p'); p.textContent = text; return p; }
function clientSection(id, title) {
  let section = shadow.querySelector('#'+id);
  if (!section) { section = document.createElement('section'); section.id = id; section.append(heading(title)); panel.append(section); }
  panel.hidden = false; return section;
}
register({ id: 'commands', name: 'Befehlsübersicht', rights: 'Bekannte Purrlor-Befehle anzeigen und kopieren; keine Ausführung', start(api) {
  const commands = [
    ['/me <Aktion>', 'Aktionsnachricht senden.'], ['/shrug [Text]', 'Text mit Schulterzucken senden.'],
    ['/nick <Name>', 'Eigenen Anzeigenamen überall ändern.'], ['/topic <Text>', 'Kanalthema ändern; entsprechende Berechtigung erforderlich.'],
    ['/invite <@Benutzer:Server>', 'Benutzer einladen; entsprechende Berechtigung erforderlich.'],
    ['/kick <@Benutzer:Server> [Grund]', 'Benutzer entfernen; entsprechende Berechtigung erforderlich.'],
    ['/ban <@Benutzer:Server> [Grund]', 'Benutzer sperren; entsprechende Berechtigung erforderlich.'],
    ['/unban <@Benutzer:Server>', 'Sperre aufheben; entsprechende Berechtigung erforderlich.'],
    ['/leave', 'Aktuellen Kanal verlassen.'], ['//Text', 'Eine Nachricht mit einem wörtlichen Schrägstrich beginnen.'],
    ['!bug <Projekt> <Beschreibung>', 'Fehlerbericht an den Betreiber senden, falls dessen Bereitstellung dies unterstützt.'],
  ];
  const open = button('Befehle anzeigen', () => {
    const section = clientSection('command-catalog','Vorhandene Befehle'); if (section.querySelector('input')) return;
    section.append(paragraph('Aus dem untersuchten Purrlor-Quellstand. Diese Übersicht macht auch wenig sichtbare Befehle auffindbar; sie schaltet keine gesperrten Befehle frei. Neuere Serverfassungen können abweichen.'));
    const filter = document.createElement('input'); filter.type='search'; filter.setAttribute('aria-label','Befehl suchen');
    const list = document.createElement('div');
    const renderCommands = () => {
      list.replaceChildren();
      for (const [command, description] of commands) if ((command+' '+description).toLocaleLowerCase('de-DE').includes(filter.value.toLocaleLowerCase('de-DE'))) {
        const item = document.createElement('div'); item.append(paragraph(command+' — '+description), button('Kopieren: '+command, async () => {
          await navigator.clipboard.writeText(command); report('Befehl kopiert. Platzhalter vor dem Senden ersetzen.');
        })); list.append(item);
      }
    };
    filter.oninput=renderCommands; section.append(filter,list); renderCommands();
  });
  shadow.querySelector('#tools').append(open); api.cleanup(() => { open.remove(); shadow.querySelector('#command-catalog')?.remove(); });
} });
register({ id: 'message-log', name: 'Lokales Nachrichtenprotokoll', rights: 'Angezeigte Nachrichtentexte und beobachtete Fassungen auf diesem Rechner speichern', start(api) {
  readJournal(); // Refuse to silently overwrite an invalid journal.
  let failed = false, selectedSection, filter, output, active=true;
  const pendingAuthors=new Set(), authorRequests=new Set(), recoveryQueue=new Map();
  const recover=entry=>{
    if(!entry?.roomId || entry.senderId || pendingAuthors.has(entry.eventId))return;
    if(authorRequests.size>=4){recoveryQueue.set(entry.eventId,entry);return;}
    pendingAuthors.add(entry.eventId);const expected=currentScope,controller=new AbortController();authorRequests.add(controller);const timer=setTimeout(()=>controller.abort(),12000);
    recoverLoggedSender(entry,controller.signal).then(identity=>{
      if(!identity || !active || scope()!==expected)return;
      const journal=readJournal(), record=journal.messages.find(record=>record.eventId===entry.eventId);if(!record)return;
      record.senderId=identity.senderId;if(identity.senderLabel)record.senderLabel=identity.senderLabel;writeJournal(journal);renderLog();renderDeletedMessages(journal);
    }).catch(()=>undefined).finally(()=>{clearTimeout(timer);authorRequests.delete(controller);if(active && recoveryQueue.size){const next=recoveryQueue.values().next().value;recoveryQueue.delete(next.eventId);recover(next);}});
  };
  api.cleanup(()=>{active=false;for(const controller of authorRequests)controller.abort();authorRequests.clear();recoveryQueue.clear();});
  const renderLog = () => {
    if (!output) return;
    const journal = readJournal(), needle = filter.value.toLocaleLowerCase('de-DE');
    output.replaceChildren();
    for (const entry of [...journal.messages].reverse()) {
      if (!JSON.stringify(entry).toLocaleLowerCase('de-DE').includes(needle)) continue;
      const item = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = `${entry.firstSeenAt} · ${entry.senderLabel || 'Anzeigename nicht verfügbar'} · ${String(entry.text).slice(0,100)}`;
      const detail = document.createElement('pre'); detail.style.whiteSpace='pre-wrap'; detail.textContent=JSON.stringify(entry,null,2);
      item.append(summary,detail); output.append(item);
    }
  };
  const open = button('Nachrichtenprotokoll öffnen', () => {
    selectedSection=clientSection('message-journal','Lokales Nachrichtenprotokoll');
    if (selectedSection.querySelector('input')) return renderLog();
    selectedSection.append(paragraph('Bis zu 500 Textnachrichten und je drei frühere angezeigte Fassungen. Aufzeichnung nur bei eingeschalteter Erweiterung. Bestätigte Matrix-Löschereignisse zeigen gespeicherten Text rot im zugeordneten Chat. Verschwinden aus der Ansicht allein ist kein Löschbeleg. Aufzeichnungen bleiben nach Abschalten erhalten.'));
    filter=document.createElement('input'); filter.type='search';filter.setAttribute('aria-label','Protokoll durchsuchen');filter.oninput=renderLog;
    output=document.createElement('div'); output.id='journal-entries';
    selectedSection.append(filter, button('Fehlende Absender ergänzen',()=>{for(const entry of readJournal().messages.filter(entry=>entry.deletedAt && !entry.senderId).slice(-20)){pendingAuthors.delete(entry.eventId);recover(entry);}report('Zugängliche Absenderdaten werden ergänzt.');}), button('Protokoll ausgeben', () => downloadJson('PurrlorPlus-Protokoll.json',{scope:currentScope,...readJournal()})), button('Protokoll löschen', () => {
      if (!confirm('Alle aufgezeichneten Nachrichten und Berechtigungsstände dieses Kontos löschen?')) return;
      localStorage.removeItem(journalKey()); failed=false; renderLog(); report('Lokales Protokoll gelöscht. Neu eintreffende oder veränderte Nachrichten werden weiter erfasst.');
    }), output); renderLog();
  });
  shadow.querySelector('#tools').append(open);
  const observed = new Map();
  const receive=(roomId,event)=>{
    if(scope()!==currentScope || failed)return;
    try {
      const journal=readJournal(), target=event.type==='m.room.redaction'?(event.redacts || event.content?.redacts):event.unsigned?.redacted_because?event.event_id:null;
      let changed=false;
      for(const entry of journal.messages){
        const sender=messageAuthors.get(entry.eventId);
        if(!entry.senderId && sender){entry.senderId=sender;changed=true;}
        const label=memberNames.get((entry.roomId || roomId)+'|'+(entry.senderId || sender));
        if(!entry.senderLabel && label){entry.senderLabel=label;changed=true;}
      }
      if(target){const old=journal.messages.find(entry=>entry.eventId===target);if(old){old.deletedAt=new Date().toISOString();old.roomId=roomId;changed=true;recover(old);}}
      else if(event.type==='m.room.message' && ['m.text','m.notice','m.emote'].includes(event.content?.msgtype) && typeof event.content.body==='string'){
        const text=event.content.body.replace(/\|\|[\s\S]*?\|\|/g,'').slice(0,4000), replacement=event.content['m.relates_to'];
        const id=replacement?.rel_type==='m.replace'?replacement.event_id:event.event_id;
        const old=journal.messages.find(entry=>entry.eventId===id), now=new Date().toISOString();
        if(text && !replacement){if(!old){journal.messages.push({eventId:id,roomId,senderId:event.sender,sentAt:Number.isFinite(event.origin_server_ts)?new Date(event.origin_server_ts).toISOString():null,firstSeenAt:now,lastSeenAt:now,text,variants:[]});changed=true;}else if(!old.roomId){old.roomId=roomId;changed=true;}}
      }
      if(changed){journal.messages=journal.messages.slice(-500);writeJournal(journal);renderLog();renderDeletedMessages(journal);}
    }catch {failed=true;errors.set('message-log','Aufzeichnung angehalten: Protokoll oder Speicher prüfen.');render();}
  };
  matrixObservers.add(receive);api.cleanup(()=>matrixObservers.delete(receive));
  api.cleanup(()=>document.querySelectorAll('[data-purrlorplus-deleted-id]').forEach(node=>node.remove()));
  watchMessages(api, () => {
    if (failed) return;
    const journal = readJournal(); let changed = false;
    const rows=messageRows().filter(row=>row.getAttribute('data-nu-event-id')?.startsWith('$')), ids=new Set(rows.map(row=>row.getAttribute('data-nu-event-id')));
    for (const id of observed.keys()) if (!ids.has(id)) observed.delete(id);
    for (const [index,row] of rows.entries()) {
      const id=row.getAttribute('data-nu-event-id'), text=messageText(row).slice(0,4000);
      const identity=messageIdentity(row,messageRooms.get(id) || currentTimelineRoom(row.closest('[data-nu-role="timeline"]')));
      const fingerprint=text+'|'+identity.senderId+'|'+identity.senderLabel;
      if (!id || !id.startsWith('$') || !text || observed.get(id)===fingerprint) continue;
      observed.set(id,fingerprint);
      const old=journal.messages.find(entry=>entry.eventId===id), now=new Date().toISOString();
      const roomId=messageRooms.get(id) || currentTimelineRoom(row.closest('[data-nu-role="timeline"]'));
      const position={previousId:rows[index-1]?.getAttribute('data-nu-event-id') || null,nextId:rows[index+1]?.getAttribute('data-nu-event-id') || null};
      if(old?.deletedAt)continue;
      if(old){for(const [field,value] of Object.entries({roomId:roomId || old.roomId,...position,senderId:identity.senderId || old.senderId || null,senderLabel:identity.senderLabel || old.senderLabel || null})){if(old[field]!==value){old[field]=value;changed=true;}}}
      if (!old) journal.messages.push({eventId:id,roomId,...position,...identity,firstSeenAt:now,lastSeenAt:now,text,sentAt:row.querySelector('time[datetime]')?.getAttribute('datetime') || null,roleLabel:row.querySelector('[data-nu-role="role-badge"]')?.textContent.trim().slice(0,50) || null,variants:[]});
      else if (old.text!==text) { old.variants=[...(old.variants || []),{observedAt:old.lastSeenAt,text:old.text}].slice(-3);old.text=text;old.lastSeenAt=now;old.editIndicator=!!row.querySelector('[data-nu-role="timeline-edited-tag"]'); }
      else continue;
      changed=true;
    }
    if (!changed) {renderDeletedMessages(journal);return;}
    journal.messages=journal.messages.slice(-500);
    try { writeJournal(journal); renderLog();renderDeletedMessages(journal); } catch { failed=true; errors.set('message-log','Aufzeichnung angehalten: Speicher voll oder Protokoll nicht lesbar. Vorhandene Daten sichern.');render(); }
  });
  api.cleanup(() => { open.remove(); selectedSection?.remove();observed.clear(); });
} });
function numberLevel(value, fallback) { return typeof value==='number' && Number.isFinite(value) ? value : fallback; }
function permissionModel(state) {
  if (!Array.isArray(state)) throw Error('Ungültiger Raumzustand.');
  const event = type => state.find(item=>item?.type===type && item.state_key==='')?.content || {};
  const levels=event('m.room.power_levels');
  const eventLevels=levels.events || {};
  const stateDefault=numberLevel(levels.state_default,50), userDefault=numberLevel(levels.users_default,0);
  const capabilities = [
    ['Nachrichten senden',numberLevel(eventLevels['m.room.message'],numberLevel(levels.events_default,0))],
    ['Thema ändern',numberLevel(eventLevels['m.room.topic'],stateDefault)],
    ['Nachrichten anheften',numberLevel(eventLevels['m.room.pinned_events'],stateDefault)],
    ['Fremde Nachrichten löschen',numberLevel(levels.redact,50)],
    ['Einladen',numberLevel(levels.invite,0)],['Entfernen',numberLevel(levels.kick,50)],['Sperren',numberLevel(levels.ban,50)],
  ];
  const roles=[{name:'Administrator',level:100},{name:'Moderator',level:50},{name:'Mitglied',level:0}];
  const taken=new Set([0,50,100]);
  for (const role of (Array.isArray(event('xyz.nekous.roles').roles) ? event('xyz.nekous.roles').roles : []).slice(0,20)) {
    if (typeof role?.name==='string' && Number.isInteger(role.level) && role.level>0 && role.level<100 && !taken.has(role.level)) { roles.push({name:role.name.slice(0,32),level:role.level});taken.add(role.level); }
  }
  roles.sort((a,b)=>b.level-a.level);
  const roleForLevel = level => roles.find(role=>level>=role.level)?.name || 'Unterhalb Mitglied';
  const people=state.filter(item=>item?.type==='m.room.member' && item.content?.membership==='join').map(item=>{
    const id=item.state_key, own=Object.prototype.hasOwnProperty.call(levels.users || {},id);
    const level=numberLevel(own ? levels.users[id] : undefined,userDefault);
    return {userId:id,name:String(item.content.displayname || id).slice(0,100),level,role:roleForLevel(level)};
  });
  return {capabilities,roles,people,userDefault};
}
register({ id: 'permissions', name: 'Personen- und Rollenberechtigungen', rights: 'Zugänglichen Matrix-Raumzustand lesen; ausgewählte Berechtigungsstände lokal speichern', start(api) {
  let section, rooms, roomInput, output, snapshot, serial=0;const controllers=new Set();let active=true;
  async function get(path) {
    const expected=currentScope, token=stored('nekous_access_token'), base=stored('nekous_hs_base_url');
    if (!token || !base) throw Error('Keine angemeldete Matrix-Sitzung verfügbar.');
    const origin=new URL(base); if (origin.username || origin.password || (origin.protocol!=='https:' && !(origin.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))) throw Error('Unsichere Matrix-Adresse.');
    const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(base.replace(/\/$/,'')+'/_matrix/client/v3/'+path,{headers:{Authorization:'Bearer '+token},signal:controller.signal,redirect:'error',credentials:'omit'});
      if (scope()!==expected || !active) throw Error('Konto oder Erweiterung wurde gewechselt.');
      if (!response.ok) throw Error(`Matrix-Anfrage abgelehnt (${response.status}).`);
      const value=await response.json();if (scope()!==expected || !active) throw Error('Konto oder Erweiterung wurde gewechselt.');return value;
    } finally {clearTimeout(timeout);controllers.delete(controller);}
  }
  const open=button('Berechtigungen ansehen',()=>{
    section=clientSection('permissions-inspector','Personen- und Rollenberechtigungen'); if (section.querySelector('input')) return;
    section.append(paragraph('Aktueller Zustand eines für dich zugänglichen Raums. Namen von Space-Rollen fehlen, falls sie nicht im gewählten Raum gespeichert sind. Die Schwellen sind keine vollständige Serverentscheidung: Entfernen und Sperren benötigen zusätzlich eine höhere Stufe als das Ziel.'));
    roomInput=document.createElement('input');roomInput.placeholder='!Raumkennung:Server';roomInput.setAttribute('aria-label','Matrix-Raumkennung');
    rooms=document.createElement('select');rooms.setAttribute('aria-label','Beigetretenen Raum auswählen');rooms.append(new Option('Raum auswählen',''));rooms.onchange=()=>{roomInput.value=rooms.value;};
    output=document.createElement('div');output.id='permissions-output';
    section.append(roomInput,rooms,button('Beigetretene Räume laden',async()=>{
      const request=++serial, expected=currentScope;
      const found=await get('joined_rooms');if(request!==serial)return;
      rooms.replaceChildren(new Option('Raum auswählen',''));
      const ids=(Array.isArray(found.joined_rooms)?found.joined_rooms:[]).filter(id=>typeof id==='string').slice(0,1000);
      const options=new Map();for(const id of ids){const option=new Option('Name wird geladen … · '+id,id);options.set(id,option);rooms.append(option);}
      let cursor=0;
      await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
        while(cursor<ids.length && request===serial && active && scope()===expected){const id=ids[cursor++];let name='';
          try { const content=await get('rooms/'+encodeURIComponent(id)+'/state/m.room.name/');if(typeof content.name==='string')name=content.name; }catch{}
          if(!name && active && scope()===expected)try { const alias=await get('rooms/'+encodeURIComponent(id)+'/state/m.room.canonical_alias/');if(typeof alias.alias==='string')name=alias.alias;}catch{}
          if(!name){const row=[...document.querySelectorAll('[data-nu-drag-channel]')].find(row=>row.getAttribute('data-nu-drag-channel')===id);name=row?.querySelector('.nu-channel-list__item-name')?.textContent.trim() || '';}
          if(request!==serial || !active || scope()!==expected)return;
          options.get(id).text=(name?name.slice(0,150):'Unbenannter Raum')+' · '+id;
        }
      }));
      if(request===serial && active && scope()===expected){const selected=rooms.value;const ordered=[...options.values()].sort((a,b)=>a.text.localeCompare(b.text,'de'));rooms.replaceChildren(new Option('Raum auswählen',''),...ordered);rooms.value=selected;report('Raumnamen geladen; Kennungen bleiben zur Unterscheidung sichtbar.');}
    }),button('Raumzustand lesen',async()=>{
      const id=roomInput.value.trim();if(!id.startsWith('!') || id.length>500)throw Error('Vollständige Matrix-Raumkennung eingeben.');
      const request=++serial, expected=currentScope;snapshot=undefined;output.replaceChildren(paragraph('Wird geladen …'));
      const state=await get('rooms/'+encodeURIComponent(id)+'/state');if(request!==serial)return;
      let roleState = state, roleSource=id;
      if (!state.some(event=>event.type==='xyz.nekous.roles')) {
        const parent=state.find(event=>event.type==='m.space.parent' && typeof event.state_key==='string' && event.state_key.startsWith('!'));
        if(parent)try {
          const parentState=await get('rooms/'+encodeURIComponent(parent.state_key)+'/state');
          if(request!==serial)return;
          const roleEvent=Array.isArray(parentState)?parentState.find(event=>event.type==='xyz.nekous.roles' && event.state_key===''):undefined;
          if(roleEvent){roleState=[...state,roleEvent];roleSource=parent.state_key;}
        } catch { /* A parent may be inaccessible; channel levels remain authoritative. */ }
      }
      if (request!==serial || !active || scope()!==expected) return;
      const model=permissionModel(roleState);snapshot={roomId:id,roleSource,recordedAt:new Date().toISOString(),...model};output.replaceChildren();
      const showTable=(title,rows)=>{const table=document.createElement('table');table.style.width='100%';table.append(document.createElement('caption'));table.firstChild.textContent=title;for(const values of rows){const row=document.createElement('tr');for(const value of values){const cell=document.createElement('td');cell.textContent=String(value);cell.style.padding='5px';row.append(cell);}table.append(row);}output.append(table);};
      showTable('Aktion · erforderliche Stufe',model.capabilities);
      showTable('Rollen im Raum · Stufe',model.roles.map(role=>[role.name,role.level]));
      const filter=document.createElement('input');filter.type='search';filter.setAttribute('aria-label','Person suchen');const people=document.createElement('div');
      const renderPeople=()=>{people.replaceChildren();for(const person of model.people.filter(person=>(person.userId+' '+person.name).toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())).slice(0,200)){people.append(paragraph(`${person.name} · ${person.userId} · ${person.role} (${person.level}) · ${model.capabilities.filter(([,threshold])=>person.level>=threshold).map(([name])=>name).join(', ')}`));}};
      filter.oninput=renderPeople;output.append(paragraph(`${model.people.length} beigetretene Personen; höchstens 200 Treffer gleichzeitig.`),filter,people);renderPeople();
    }),button('Berechtigungsstand speichern',()=>{if(!snapshot)throw Error('Zuerst Raumzustand lesen.');const journal=readJournal();journal.permissions=[...journal.permissions,snapshot].slice(-10);writeJournal(journal);report('Berechtigungsstand lokal gespeichert; im Protokollexport enthalten.');}),button('Berechtigungsstand ausgeben',()=>{if(!snapshot)throw Error('Zuerst Raumzustand lesen.');downloadJson('PurrlorPlus-Berechtigungen.json',snapshot);}),output);
  });
  shadow.querySelector('#tools').append(open);api.cleanup(()=>{active=false;serial++;for(const controller of controllers)controller.abort();controllers.clear();open.remove();section?.remove();snapshot=undefined;});
} });
