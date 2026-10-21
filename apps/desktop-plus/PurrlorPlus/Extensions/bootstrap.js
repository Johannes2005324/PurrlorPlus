'use strict';
// Trusted bundled modules only. This is not a security sandbox for third-party scripts.
if (window.top !== window || location.origin !== config.origin || window.__purrlorPlus) return;
const VERSION = 1;
const modules = new Map();
const running = new Map();
const errors = new Map();
let host, shadow, panel, currentScope, data;
let disposed = false;
let storageBlocked = false;
const APP_VERSION = "0.7.0";
let safeMode = config.safeMode;
function stored(name) { try { return localStorage.getItem(name) || ''; } catch { return ''; } }
const user = () => stored('nekous_user_id');
const scope = () => JSON.stringify([location.origin, stored('nekous_hs_base_url'), user()]);
const key = () => 'purrlorplus:v1:' + currentScope;
const defaults = () => ({ version: VERSION, enabled: {}, appearance: { accent: '#8b9dff', size: 14, compact: false }, notes: {}, keywords: [], speech: { join: "{name} ist dem Sprachkanal {channel} beigetreten.", leave: "{name} hat den Sprachkanal {channel} verlassen.", voice: "", rate: 1, volume: 1 }, links: { view: true, paste: true, rules: [{ from: "x.com", to: "fixupx.com" }, { from: "www.x.com", to: "fixupx.com" }] } });
function validate(raw) {
  if (!raw || raw.version !== VERSION || typeof raw !== 'object') throw Error('Unbekanntes Datenformat.');
  const result = defaults();
  for (const id of modules.keys()) if (typeof raw.enabled?.[id] === 'boolean') result.enabled[id] = raw.enabled[id];
  if (/^#[0-9a-f]{6}$/i.test(raw.appearance?.accent)) result.appearance.accent = raw.appearance.accent;
  if (Number.isFinite(raw.appearance?.size)) result.appearance.size = Math.max(10, Math.min(24, raw.appearance.size));
  result.appearance.compact = raw.appearance?.compact === true;
  if (raw.notes && typeof raw.notes === 'object' && !Array.isArray(raw.notes)) {
    for (const [id, note] of Object.entries(raw.notes)) {
      if (/^@[^\s:]+:[^\s]+$/.test(id) && typeof note === 'string' && note.length <= 10000)
        Object.defineProperty(result.notes, id, { value: note, enumerable: true, writable: true, configurable: true });
    }
  }
  if (Array.isArray(raw.keywords)) result.keywords = [...new Set(raw.keywords.filter(word => typeof word === 'string').map(word => word.trim()).filter(word => word.length > 0 && word.length <= 80))].slice(0, 50);
  if (raw.speech && typeof raw.speech === 'object') {
    for (const key of ['join','leave','voice']) if(typeof raw.speech[key] === 'string') result.speech[key]=raw.speech[key].slice(0,300);
    for (const key of ['rate','volume']) if(Number.isFinite(raw.speech[key])) result.speech[key]=Math.max(key==='rate'?0.5:0,Math.min(key==='rate'?2:1,raw.speech[key]));
  }
  if(raw.links && typeof raw.links==='object'){
    result.links.view=raw.links.view!==false;result.links.paste=raw.links.paste!==false;
    if(Array.isArray(raw.links.rules))result.links.rules=raw.links.rules.filter(rule=>typeof rule?.from==='string' && typeof rule?.to==='string' && validLinkDomain(rule.from) && validLinkDomain(rule.to)).slice(0,20).map(rule=>({from:rule.from.toLowerCase(),to:rule.to.toLowerCase()}));
  }
  return result;
}
function save(candidate = data) {
  if (storageBlocked) throw Error('Gespeicherte Daten sind beschädigt oder gesperrt. Bitte zuerst die Rohdaten sichern und die Speicherung zurücksetzen.');
  localStorage.setItem(key(), JSON.stringify(candidate));
}
function load() {
  currentScope = scope(); storageBlocked = false; errors.clear();
  try { const raw = localStorage.getItem(key()); data = raw ? validate(JSON.parse(raw)) : defaults(); }
  catch { storageBlocked = true; data = defaults(); errors.set('Speicherung', 'Gespeicherte Daten sind nicht lesbar. Rohdaten sichern, dann Speicherung zurücksetzen. Die beschädigte Fassung bleibt erhalten.'); }
}
function stop(id) { const cleanup = running.get(id); running.delete(id); try { cleanup?.(); } catch (e) { errors.set(id, String(e)); } }
function reconcile(ids = modules.keys()) {
  for (const id of ids) {
    const module = modules.get(id);
    stop(id);
    if (!safeMode && user() && module.apiVersion === VERSION && data.enabled[id] === true) {
      const disposers = [];
      const api = {
        cleanup: fn => disposers.push(fn),
        listen(target, name, fn, options) {
          const guarded = event => { try { fn(event); } catch (e) { errors.set(id, String(e)); stop(id); render(); } };
          target.addEventListener(name, guarded, options);
          disposers.push(() => target.removeEventListener(name, guarded, options));
        },
      };
      running.set(id, () => { for (const dispose of disposers.reverse()) dispose(); });
      try { module.start(api); } catch (e) { errors.set(id, String(e)); stop(id); }
    }
  }
}
const register = module => modules.set(module.id, { version: APP_VERSION, apiVersion: VERSION, ...module });
register({ id: 'appearance', name: 'Gestaltung', rights: 'Darstellung ändern', start(api) {
  const style = document.createElement('style');
  style.textContent = `:root { --nu-color-accent:${data.appearance.accent}; } [data-nu-role="timeline"] { --nu-font-size-message:${data.appearance.size}px !important; }` +
    (data.appearance.compact ? '[data-nu-role="timeline-message"] { padding-block:2px!important; margin-block:0!important; }' : '');
  document.head.append(style); api.cleanup(() => style.remove());
} });
register({ id: 'copy-id', name: 'Nachrichtenkennung kopieren', rights: 'Angeklickte Kennung lesen; Zwischenablage nach Auswahl', start(api) {
  api.listen(document, 'contextmenu', e => {
    if (scope() !== currentScope) { syncAccount(); return; }
    const row = e.target.closest?.('[data-nu-event-id]'); if (!row) return;
    e.preventDefault(); e.stopImmediatePropagation();
    showAction(e.clientX, e.clientY, 'Nachrichtenkennung kopieren', async () => {
      try { await navigator.clipboard.writeText(row.getAttribute('data-nu-event-id')); report('Kennung kopiert.'); }
      catch { report('Zwischenablage nicht verfügbar.'); }
    });
  }, true);
  api.cleanup(closeAction);
} });
register({ id: 'notes', name: 'Private Benutzernotizen', rights: 'Lokale Notizen des angemeldeten Kontos', start(api) {
  const button = document.createElement('button'); button.textContent = 'Benutzernotizen';
  button.onclick = () => openNotes(); shadow.querySelector('#tools').append(button);
  api.cleanup(() => { button.remove(); shadow.querySelector('#notes')?.remove(); });
} });
register({ id: 'images', name: 'Bilder vergrößern', rights: 'Angeklicktes Nachrichtenbild anzeigen', start(api) {
  const view = e => {
    if (scope() !== currentScope) { syncAccount(); return; }
    const image = e.target.closest?.('[data-nu-role="timeline-image"] img'); if (!image) return;
    e.preventDefault(); e.stopImmediatePropagation();
    shadow.querySelector('#viewer')?.remove();
    const box = document.createElement('div'); box.id = 'viewer'; box.className = 'viewer';
    const close = button('Schließen', () => box.remove()); const img = document.createElement('img');
    const url = new URL(image.currentSrc || image.src, location.href);
    if (!['https:', 'blob:', 'data:'].includes(url.protocol)) return;
    img.src = url.href; img.alt = image.alt || 'Nachrichtenbild';
    const zoom = document.createElement('input'); zoom.type = 'range'; zoom.min = '50'; zoom.max = '300'; zoom.value = '100'; zoom.setAttribute('aria-label', 'Bildvergrößerung');
    zoom.oninput = () => { img.style.transform = `scale(${Number(zoom.value)/100})`; };
    const lens=document.createElement('div');lens.id='image-lens';lens.hidden=true;lens.style.cssText='position:fixed;width:180px;height:180px;border:3px solid white;border-radius:50%;pointer-events:none;z-index:2147483647;background-repeat:no-repeat;box-shadow:0 3px 14px #000';
    let magnify=false;
    const toggle=button('Lupe einschalten',()=>{magnify=!magnify;toggle.textContent=magnify?'Lupe ausschalten':'Lupe einschalten';lens.hidden=true;});
    img.addEventListener('pointermove',event=>{
      if(!magnify)return;
      const rect=img.getBoundingClientRect();if(!rect.width || !rect.height)return;
      const x=Math.max(0,Math.min(rect.width,event.clientX-rect.left)), y=Math.max(0,Math.min(rect.height,event.clientY-rect.top)), factor=3;
      lens.hidden=false;lens.style.left=Math.min(innerWidth-186,Math.max(0,event.clientX+18))+'px';lens.style.top=Math.min(innerHeight-186,Math.max(0,event.clientY+18))+'px';
      lens.style.backgroundImage='url('+JSON.stringify(img.src)+')';lens.style.backgroundSize=(rect.width*factor)+'px '+(rect.height*factor)+'px';lens.style.backgroundPosition=(90-x*factor)+'px '+(90-y*factor)+'px';
    });img.addEventListener('pointerleave',()=>{lens.hidden=true;});
    box.append(close, zoom, toggle, img, lens); shadow.append(box);
  };
  api.listen(document, 'dblclick', view, true);
  api.listen(document, 'click', e => { if (e.shiftKey) view(e); }, true);
  api.listen(document, 'keydown', e => { if (e.key === 'Escape') shadow.querySelector('#viewer')?.remove(); });
  api.cleanup(() => shadow.querySelector('#viewer')?.remove());
} });
register({ id: 'reading', name: 'Ruhiger Lesemodus', rights: 'Schreibanzeige und Nachrichtenanimationen ausblenden', start(api) {
  const style = document.createElement('style');
  style.textContent = '[data-nu-role="typing-indicator"]{display:none!important}[data-nu-role="timeline"] *,[data-nu-role="timeline"] *::before,[data-nu-role="timeline"] *::after{animation:none!important;transition:none!important}';
  document.head.append(style); api.cleanup(() => style.remove());
} });
register({ id: 'voice-diagnostics', name: 'Sprachdiagnose', rights: 'WebRTC-Zustände lokal erfassen; keine Inhalte oder Adressen', start(api) {
  const Native = window.RTCPeerConnection;
  if (!Native) throw Error('WebRTC wird von dieser Laufzeit nicht angeboten.');
  const records = [], peers = new Set(); let counter = 0;
  const add = (connection, event, value) => {
    records.push({ time: new Date().toISOString(), connection, event, value });
    if (records.length > 120) records.shift();
    const output = shadow.querySelector('#diagnostics');
    if (output) output.textContent = JSON.stringify({ version: APP_VERSION, records }, null, 2);
  };
  const observe = pc => {
    const id = ++counter;
    if (id > 32) { if (id === 33) add(0, 'limit', 'Diagnose aus- und einschalten, um weitere Verbindungen zu erfassen.'); return pc; }
    peers.add(pc); add(id, 'created', true);
    for (const name of ['connectionstatechange', 'iceconnectionstatechange', 'icegatheringstatechange']) {
      api.listen(pc, name, () => add(id, name, {
        connection: pc.connectionState, ice: pc.iceConnectionState, gathering: pc.iceGatheringState,
      }));
    }
    api.listen(pc, 'icecandidateerror', event => add(id, 'icecandidateerror', { code: Number(event.errorCode) || 0 }));
    api.listen(pc, 'connectionstatechange', () => { if (pc.connectionState === 'closed') peers.delete(pc); });
    return pc;
  };
  const Wrapped = new Proxy(Native, { construct(target, args, newTarget) { return observe(Reflect.construct(target, args, newTarget)); } });
  window.RTCPeerConnection = Wrapped;
  const show = button('Sprachdiagnose öffnen', () => {
    panel.hidden = false;
    let output = shadow.querySelector('#diagnostics');
    if (!output) { output = document.createElement('pre'); output.id = 'diagnostics'; output.style.whiteSpace = 'pre-wrap'; panel.append(output); }
    output.textContent = JSON.stringify({ version: APP_VERSION, records }, null, 2);
    report('Jetzt Sprachkanal verlassen und erneut beitreten. Ein ICE-Einzelfehler allein beweist keinen Verbindungsabbruch.');
  });
  const copy = button('Diagnosebericht kopieren', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ version: APP_VERSION, records }, null, 2)); report('Diagnosebericht kopiert.'); }
    catch { report('Zwischenablage nicht verfügbar. Sprachdiagnose öffnen und Text auswählen.'); }
  });
  shadow.querySelector('#tools').append(show, copy);
  api.cleanup(() => {
    if (window.RTCPeerConnection === Wrapped) window.RTCPeerConnection = Native;
    show.remove(); copy.remove(); shadow.querySelector('#diagnostics')?.remove(); peers.clear();
  });
} });
function button(label, action) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
  b.onclick = event => { if (scope() !== currentScope) { syncAccount(); return; } try { Promise.resolve(action(event)).catch(e => report(String(e.message || e))); } catch (e) { report(String(e.message || e)); } };
  return b;
}
function report(message) { if (shadow) { shadow.querySelector('#status').textContent = message; shadow.querySelector('#toast').textContent = message; } }
function closeAction() { shadow?.querySelector('#action')?.remove(); }
function showAction(x, y, label, action) {
  closeAction(); const b = button(label, () => { closeAction(); void action(); }); b.id = 'action';
  b.style.cssText = `position:fixed;left:${Math.max(0,Math.min(x,innerWidth-280))}px;top:${Math.max(0,Math.min(y,innerHeight-60))}px`;
  shadow.append(b);
}
function openNotes() {
  const existing = shadow.querySelector('#notes');
  if (existing) { panel.hidden = false; existing.scrollIntoView?.({ block: 'nearest' }); return; }
  const box = document.createElement('section'); box.id = 'notes';
  const id = document.createElement('input'); id.placeholder = '@benutzer:server'; id.setAttribute('aria-label', 'Matrix-Benutzerkennung');
  const text = document.createElement('textarea'); text.maxLength = 10000; text.setAttribute('aria-label', 'Private Notiz');
  const saved = document.createElement('div'); saved.id = 'saved-notes';
  let loaded = '';
  const choose = value => {
    if (text.value !== loaded && !confirm('Ungespeicherte Notiz verwerfen?')) return false;
    id.value = value; text.value = Object.hasOwn(data.notes, value) ? data.notes[value] : ''; loaded = text.value; return true;
  };
  const refresh = () => {
    saved.replaceChildren();
    for (const name of Object.keys(data.notes).sort()) saved.append(button(name, () => choose(name)));
    if (!saved.childNodes.length) saved.textContent = 'Noch keine gespeicherten Notizen.';
  };
  box.append('Private Notizen – nur auf diesem Rechner und für dieses Konto', saved, id, text,
    button('Notiz laden', () => choose(id.value.trim())),
    button('Notiz speichern', () => {
      const name = id.value.trim();
      if (!/^@[^\s:]+:[^\s]+$/.test(name)) return report('Bitte eine vollständige Matrix-Kennung eingeben.');
      const next = validate(data); next.notes[name] = text.value;
      if (commit(next)) { id.value = name; loaded = text.value; refresh(); }
    }), button('Notiz löschen', () => {
      const name = id.value.trim(); if (!Object.hasOwn(data.notes, name)) return;
      if (!confirm('Diese private Notiz löschen?')) return;
      const next = validate(data); delete next.notes[name];
      if (commit(next)) { text.value = ''; loaded = ''; refresh(); }
    }));
  refresh(); panel.append(box); panel.hidden = false;
}
function commit(next) {
  try { save(next); data = next; report('Lokal gespeichert.'); return true; }
  catch (e) { report(`Speichern fehlgeschlagen: ${e.message}`); return false; }
}
function persist() { return commit(data); }
function importSettings(text, expectedScope = currentScope) {
  if (scope() !== expectedScope || currentScope !== expectedScope) throw Error('Konto während des Einlesens gewechselt.');
  if (text.length > 1000000) throw Error('Datei ist größer als 1 MB.');
  const incoming = JSON.parse(text);
  if (incoming.scope !== currentScope) throw Error('Die Daten gehören zu einem anderen Konto oder Server.');
  const candidate = validate(incoming.data);
  if (!commit(candidate)) return;
  reconcile(); fill(); render(); report('Eingelesen.');
}
function render() {
  if (!shadow) return;
  const list = shadow.querySelector('#list'); list.replaceChildren();
  for (const [id, module] of modules) {
    const row = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox';
    check.checked = data.enabled[id] === true; check.disabled = safeMode || !user() || storageBlocked; check.dataset.module = id;
    check.onchange = () => { if (scope() !== currentScope) { syncAccount(); return; } const next = validate(data); next.enabled[id] = check.checked; if (!commit(next)) return render(); errors.delete(id); reconcile([id]); render(); };
    row.append(check, `${module.name} (${module.version}) — ${module.rights}`);
    if (errors.has(id)) row.append(' — FEHLER');
    else if (running.has(id)) row.append(' — aktiv');
    else row.append(' — aus');
    const needle = shadow.querySelector('#search')?.value.trim().toLocaleLowerCase() || '';
    if (!needle || `${module.name} ${module.rights}`.toLocaleLowerCase().includes(needle)) list.append(row);
  }
  shadow.querySelector('#errors').textContent = [...errors].map(([id,e]) => `${id}: ${e}`).join('\n');
  shadow.querySelector('#mode').textContent = safeMode ? 'Sicherer Start: alle Erweiterungen aus.' : user() ? `Konto: ${user()}` : 'Bitte zuerst bei Purrlor anmelden.';
}
function mount() {
  if (disposed || host) return;
  host = document.createElement('div'); host.id = 'purrlorplus-root'; document.documentElement.append(host); shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
:host{all:initial;font:14px system-ui;color:#eee}button,input,textarea{font:inherit}button{cursor:pointer;background:#344675;color:white;border:1px solid #8b9dff;border-radius:6px;padding:8px;margin:4px}#launcher{position:fixed;right:16px;bottom:40px}#launcher,#panel,#action,.viewer{z-index:2147483647}#panel{position:fixed;right:16px;top:60px;width:min(520px,85vw);max-height:75vh;overflow:auto;background:#171c29;border:1px solid #8290b4;border-radius:12px;padding:18px;box-shadow:0 8px 40px #0008}label{display:block;margin:10px 0}textarea,input:not([type=checkbox]){box-sizing:border-box;width:100%;background:#0d1320;color:#fff;border:1px solid #8290b4;padding:7px;margin:5px 0}textarea{min-height:80px}#errors{white-space:pre-wrap;color:#ffb0a7}.viewer{position:fixed;inset:0;background:#000e;display:flex;align-items:center;justify-content:center;flex-direction:column}.viewer img{max-width:95vw;max-height:85vh;object-fit:contain}#toast{position:fixed;bottom:0;right:12px;background:#171c29;color:#fff;padding:8px;max-width:min(500px,80vw);z-index:2147483647}#toast:empty{display:none}[hidden]{display:none!important}
</style><button id="launcher">PurrlorPlus</button><section id="panel" hidden role="dialog" aria-label="PurrlorPlus Erweiterungen"><h2>PurrlorPlus 0.7.0</h2><label>Erweiterung suchen <input id="search" type="search"></label><p id="mode"></p><div id="list"></div><div id="tools"></div><h3>Gestaltung</h3><label>Akzentfarbe <input id="accent" type="color"></label><label>Nachrichtenschriftgröße (10–24 px) <input id="size" type="number" min="10" max="24"></label><label><input id="compact" type="checkbox">Kompakte Nachrichten</label><div id="settings-actions"></div><h3>Einstellungen übertragen</h3><p>Enthält Einstellungen und private Notizen dieses Kontos. Nachrichtenprotokolle und Berechtigungsstände haben einen eigenen Export.</p><textarea id="transfer" aria-label="Einstellungen als JSON" maxlength="1000000"></textarea><label>Einstellungsdatei einlesen <input id="import-file" type="file" accept=".json,application/json"></label><div id="transfer-actions"></div><p id="status" role="status"></p><pre id="errors"></pre></section><p id="toast" role="status"></p>`;
  shadow.querySelector('#search').oninput = render;
  panel = shadow.querySelector('#panel'); shadow.querySelector('#launcher').onclick = () => { panel.hidden = !panel.hidden; };
  shadow.querySelector('#settings-actions').append(button('Gestaltung speichern', () => {
    const candidate = validate({ ...data, appearance: { accent: shadow.querySelector('#accent').value, size: Number(shadow.querySelector('#size').value), compact: shadow.querySelector('#compact').checked } });
    if (commit(candidate)) { reconcile(['appearance']); fill(); render(); }
  }), button('Gestaltung zurücksetzen', () => { const next = validate(data); next.appearance = defaults().appearance; if (commit(next)) { reconcile(['appearance']); fill(); render(); } }), button('Alle Erweiterungen für diesen Start ausschalten', () => { safeMode = true; reconcile(); render(); }), button('Schließen', () => { panel.hidden = true; }));
  shadow.querySelector('#transfer-actions').append(button('Als Datei speichern', () => {
    const blob = new Blob([JSON.stringify({ scope: currentScope, data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'PurrlorPlus-Einstellungen.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }), button('Ausgeben', () => { shadow.querySelector('#transfer').value = JSON.stringify({ scope: currentScope, data }, null, 2); }), button('Einlesen', () => {
    try { importSettings(shadow.querySelector('#transfer').value); } catch (e) { report(`Einlesen fehlgeschlagen: ${e.message}`); }
  }));
  shadow.querySelector('#transfer-actions').append(button('Rohdaten sichern', () => {
    shadow.querySelector('#transfer').value = localStorage.getItem(key()) || '';
    report('Rohdaten im Textfeld: vor dem Zurücksetzen kopieren und sichern.');
  }), button('Speicherung zurücksetzen', () => {
    if (!confirm('Nur Erweiterungseinstellungen und private Notizen dieses Kontos löschen? Purrlor-Anmeldung und Schlüssel bleiben erhalten.')) return;
    localStorage.removeItem(key()); load(); reconcile(); fill(); render(); report('Erweiterungsspeicherung zurückgesetzt.');
  }));
  shadow.querySelector('#import-file').onchange = async event => {
    const field = event.target, file = field.files?.[0], expectedScope = currentScope; field.value = '';
    if (!file) return;
    try { if (file.size > 1000000) throw Error('Datei ist größer als 1 MB.'); importSettings(await file.text(), expectedScope); }
    catch (e) { report(`Einlesen fehlgeschlagen: ${e.message}`); }
  };
  fill(); reconcile(); render();
}
function fill() { for (const name of ['accent','size','compact']) { const el = shadow.querySelector('#'+name); if(name === 'compact') el.checked=data.appearance[name]; else el.value=data.appearance[name]; } }
/* PURRLORPLUS_MESSAGE_TOOLS */
/* PURRLORPLUS_CLIENT_TOOLS */
/* PURRLORPLUS_RICH_TOOLS */
load();
function syncAccount() {
  if (scope() === currentScope) return;
  for (const id of modules.keys()) stop(id);
  closeAction(); shadow?.querySelector('#notes')?.remove(); load();
  if (shadow) { shadow.querySelector('#transfer').value = ''; fill(); reconcile(); render(); }
}
const accountGuard = event => { if (scope() !== currentScope) { syncAccount(); event.preventDefault(); event.stopImmediatePropagation(); } };
document.addEventListener('click', accountGuard, true);
const dismissAction = event => { if (!event.composedPath().includes(host)) closeAction(); };
const escape = event => {
  if (event.key !== 'Escape') return;
  if (shadow?.querySelector('#viewer')) shadow.querySelector('#viewer').remove();
  else if (shadow?.querySelector('#action')) closeAction();
  else if (panel) panel.hidden = true;
};
document.addEventListener('pointerdown', dismissAction, true);
document.addEventListener('keydown', escape);
// Installed before the remote app's keyboard handlers. Stop shortcut propagation without
// cancelling native typing, selection, clipboard shortcuts, or IME composition.
const keyboardGuard = event => {
  if (!host || disposed || document.activeElement !== host) return;
  if (event.key === 'Escape') escape(event);
  event.stopImmediatePropagation();
};
window.addEventListener('keydown', keyboardGuard, true);
window.addEventListener('keypress', keyboardGuard, true);
let reportedEditing = false;
function reportEditing(value) {
  if(reportedEditing===value)return;reportedEditing=value;
  try { window.chrome?.webview?.postMessage({purrlor:1,id:-7001,method:'setExtensionEditing',params:{editing:value}}); }catch{}
}
const focusEditing = () => reportEditing(document.activeElement===host);
window.addEventListener('focusin',focusEditing,true);
window.addEventListener('focusout',focusEditing,true);
const blurEditing=()=>reportEditing(false);window.addEventListener('blur',blurEditing);window.addEventListener('focus',focusEditing);


window.addEventListener('blur', closeAction);
const accountTimer = setInterval(syncAccount, 250);
window.__purrlorPlus = Object.freeze({ open() { if(panel) panel.hidden = false; }, dispose() { window.removeEventListener('blur',blurEditing);window.removeEventListener('focus',focusEditing);reportEditing(false); window.removeEventListener('focusin',focusEditing,true); window.removeEventListener('focusout',focusEditing,true); window.removeEventListener('keydown', keyboardGuard, true); window.removeEventListener('keypress', keyboardGuard, true); disposeMatrixTap(); disposed = true; document.removeEventListener('DOMContentLoaded', mount); clearInterval(accountTimer); document.removeEventListener("click", accountGuard, true); document.removeEventListener("pointerdown", dismissAction, true); document.removeEventListener("keydown", escape); window.removeEventListener("blur", closeAction); for(const id of modules.keys()) stop(id); host?.remove(); } });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once:true }); else mount();
