// Bundled inside the bootstrap closure, before settings are loaded.
const messageRows = () => [...document.querySelectorAll('[data-nu-role="timeline"] [data-nu-role="timeline-message"][data-nu-event-id]')];
function messageText(row) {
  const blocks = row.querySelectorAll('.nu-timeline__message-text');
  const parts = [];
  for (const block of blocks) {
    parts.push(' ');
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // Concealed spoilers, collapsed text, and editing controls must not leak into results.
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (['P','DIV','BR','LI','PRE'].includes(node.tagName)) parts.push(' ');
        continue;
      }
      if (node.parentElement.closest('[hidden],[aria-hidden="true"],.nu-spoiler:not(.nu-spoiler--revealed),script,style,textarea,input')) continue;
      parts.push(node.textContent);
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}
function watchMessages(api, refresh) {
  let timer, active = true;
  const run = () => {
    timer = undefined;
    if (!active || scope() !== currentScope) return;
    try { refresh(); } catch (error) { report(`Nachrichtenwerkzeuge: ${error.message}`); }
  };
  const observer = new MutationObserver(() => { if (timer === undefined) timer = setTimeout(run, 75); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'src', 'datetime', 'class', 'hidden', 'aria-hidden', 'data-nu-event-id'] });
  api.cleanup(() => { active = false; observer.disconnect(); clearTimeout(timer); });
  run();
}
function moduleStyle(api, text) {
  const style = document.createElement('style'); style.textContent = text; document.head.append(style);
  api.cleanup(() => style.remove());
}
register({ id: 'keywords', name: 'Schlüsselwortmarkierung', rights: 'Bereits geladene Nachrichtentexte lokal prüfen und markieren', start(api) {
  moduleStyle(api, '[data-purrlorplus-keyword="yes"]{box-shadow:inset 4px 0 #f5bf55;background-color:#f5bf5518!important}');
  const marked = new Set();
  const refresh = () => {
    const terms = data.keywords.map(word => word.toLocaleLowerCase('de-DE'));
    const rows = messageRows(), present = new Set(rows);
    for (const row of marked) if (!present.has(row)) { row.removeAttribute('data-purrlorplus-keyword'); marked.delete(row); }
    for (const row of rows) {
      const text = messageText(row).toLocaleLowerCase('de-DE');
      if (terms.some(term => text.includes(term))) {
        if (!marked.has(row)) row.setAttribute('data-purrlorplus-keyword', 'yes');
        marked.add(row);
      } else { row.removeAttribute('data-purrlorplus-keyword'); marked.delete(row); }
    }
  };
  const open = button('Schlüsselwörter bearbeiten', () => {
    panel.hidden = false;
    if (shadow.querySelector('#keyword-editor')) return;
    const box = document.createElement('section'); box.id = 'keyword-editor';
    const title = document.createElement('h3'); title.textContent = 'Schlüsselwörter';
    const hint = document.createElement('p'); hint.textContent = 'Ein Wort oder Ausdruck je Zeile. Höchstens 50 Einträge mit je 80 Zeichen. Groß- und Kleinschreibung werden ignoriert.';
    const input = document.createElement('textarea'); input.id = 'keywords-input'; input.maxLength = 4050; input.setAttribute('aria-label','Schlüsselwörter'); input.value = data.keywords.join('\n');
    box.append(title, hint, input, button('Schlüsselwörter speichern', () => {
      const words = input.value.split('\n').map(word => word.trim()).filter(Boolean);
      if (words.length > 50 || words.some(word => word.length > 80)) return report('Höchstens 50 Einträge mit je 80 Zeichen verwenden.');
      const next = validate(data); next.keywords = [...new Set(words)];
      if (commit(next)) { input.value = data.keywords.join('\n'); refresh(); }
    }), button('Wortliste leeren', () => {
      const next = validate(data); next.keywords = []; if (commit(next)) { input.value = ''; refresh(); }
    }));
    panel.append(box);
  });
  shadow.querySelector('#tools').append(open);
  watchMessages(api, refresh);
  api.cleanup(() => { open.remove(); shadow.querySelector('#keyword-editor')?.remove(); for (const row of marked) row.removeAttribute('data-purrlorplus-keyword'); marked.clear(); });
} });
register({ id: 'message-search', name: 'Lokale Nachrichtensuche', rights: 'Bereits geladene Nachrichtentexte durchsuchen; keine Serverabfrage', start(api) {
  moduleStyle(api, '[data-purrlorplus-search="yes"]{outline:2px solid #8b9dff;outline-offset:-2px}');
  let box, input, summary, results, selected;
  let previousQuery, previousRows = [], previousTexts = [];
  function clearSelection() { selected?.removeAttribute('data-purrlorplus-search'); selected = undefined; }
  function refresh() {
    if (!box) return;
    const query = input.value.trim().toLocaleLowerCase('de-DE'), rows = messageRows();
    const texts = rows.map(messageText);
    if (query === previousQuery && rows.length === previousRows.length && rows.every((row,i) => row === previousRows[i] && texts[i] === previousTexts[i])) return;
    previousQuery = query; previousRows = rows; previousTexts = texts;
    clearSelection(); results.replaceChildren();
    if (!query) { summary.textContent = `${rows.length} geladene Nachrichten. Suchbegriff eingeben.`; return; }
    let count = 0;
    for (const [index, row] of rows.entries()) {
      const text = texts[index];
      if (!text.toLocaleLowerCase('de-DE').includes(query)) continue;
      count++;
      if (count > 100) continue;
      const result = button(text.length > 180 ? text.slice(0,180) + '…' : text, () => {
        if (!row.isConnected) return report('Diese Nachricht ist nicht mehr geladen. Suche aktualisieren.');
        clearSelection(); selected = row; row.setAttribute('data-purrlorplus-search','yes');
        row.scrollIntoView?.({ block: 'center', behavior: 'auto' });
        report('Nachricht im Verlauf markiert.');
      });
      result.style.display = 'block'; result.style.textAlign = 'left'; results.append(result);
    }
    summary.textContent = `${count} Treffer in ${rows.length} geladenen Nachrichten.` + (count > 100 ? ' Die ersten 100 werden angezeigt.' : '');
  }
  const open = button('Nachrichten durchsuchen', () => {
    panel.hidden = false;
    if (box) { input.focus(); return; }
    box = document.createElement('section'); box.id = 'message-search';
    const title = document.createElement('h3'); title.textContent = 'Bereits geladene Nachrichten durchsuchen';
    input = document.createElement('input'); input.type = 'search'; input.id = 'message-query'; input.maxLength = 200; input.setAttribute('aria-label','Nachrichtensuchbegriff');
    summary = document.createElement('p'); summary.id = 'message-search-summary'; summary.setAttribute('role','status');
    results = document.createElement('div'); results.id = 'message-search-results';
    api.listen(input, 'input', refresh);
    box.append(title, input, button('Suche aktualisieren', refresh), summary, results); panel.append(box); refresh(); input.focus();
  });
  shadow.querySelector('#tools').append(open); watchMessages(api, refresh);
  api.cleanup(() => { clearSelection(); open.remove(); box?.remove(); box = undefined; previousRows = []; previousTexts = []; });
} });
register({ id: 'exact-time', name: 'Genaue Zeitangaben', rights: 'Vorhandene Nachrichtenzeitpunkte in Ortszeit mit Sekunden anzeigen', start(api) {
  const badges = new Map();
  moduleStyle(api, '[data-purrlorplus-time]{display:block;font-size:11px;line-height:1.6;opacity:.75;font-variant-numeric:tabular-nums}');
  const formatter = new Intl.DateTimeFormat('de-DE', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short'});
  watchMessages(api, () => {
    const rows = messageRows(), present = new Set(rows);
    for (const [row, badge] of badges) if (!present.has(row)) { badge.remove(); badges.delete(row); }
    for (const row of rows) {
      const source = row.querySelector('time[datetime]'), value = source?.getAttribute('datetime');
      const timestamp = value ? new Date(value) : undefined;
      if (!timestamp || !Number.isFinite(timestamp.getTime())) { badges.get(row)?.remove(); badges.delete(row); continue; }
      let badge = badges.get(row);
      if (!badge || !row.contains(badge)) { badge = document.createElement('span'); badge.setAttribute('data-purrlorplus-time',''); row.append(badge); badges.set(row,badge); }
      const label = formatter.format(timestamp); if (badge.textContent !== label) badge.textContent = label;
    }
  });
  api.cleanup(() => { for (const badge of badges.values()) badge.remove(); badges.clear(); });
} });
