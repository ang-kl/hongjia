// The menu button at the bottom left (the owner's request, 5 November 2026). The menu itself is
// nested <details>, so it opens and folds without this script; this adds: closing on Escape or a
// tap outside, the list of documents under Documents, and the sidebar switch on a document page
// (Ö on, ø off). Text is inserted with textContent only.

const menu = document.querySelector('[data-menu-details]');
const BESIDE = matchMedia('(min-aspect-ratio: 1/1) and (min-width: 720px)');
const KEY = 'hj:sidebar';

const remember = value => { try { localStorage.setItem(KEY, value); } catch { /* storage may be blocked */ } };
const recalled = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

if (menu) {
  const summary = menu.querySelector('summary');
  const close = () => {
    if (!menu.open) return;
    menu.open = false;
    summary.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.open) close(); });
  document.addEventListener('pointerdown', event => { if (menu.open && !menu.contains(event.target)) menu.open = false; });
  // One thing open at a time: opening the menu folds away 📁 contents and the 🛰️ field.
  menu.addEventListener('toggle', () => {
    if (!menu.open) return;
    for (const open of document.querySelectorAll('[data-fab-folder][aria-expanded="true"], [data-fab-satellite][aria-expanded="true"]')) open.click();
  });

  // Documents: the newest documents, loaded the first time the group opens.
  const group = menu.querySelector('[data-menu-documents]');
  const list = menu.querySelector('[data-menu-docs]');
  let loaded = false;
  group?.addEventListener('toggle', async () => {
    if (!group.open || loaded) return;
    loaded = true;
    try {
      const response = await fetch('/api/library', { credentials: 'same-origin' });
      if (!response.ok) return;
      const { documents = [] } = await response.json();
      const links = documents.slice(0, 12).map(doc => {
        const link = document.createElement('a');
        link.className = 'menu-sub menu-doc';
        link.href = `/documents/${encodeURIComponent(doc.key)}`;
        const label = document.createElement('span');
        label.className = 'menu-doc-label';
        label.textContent = doc.label;
        const title = document.createElement('span');
        title.textContent = doc.title;
        link.append(label, title);
        return link;
      });
      // Newest first, then "All documents".
      list.replaceChildren(...links, list.querySelector('a[href="/documents"]'));
    } catch { /* the list stays with "All documents" only */ }
  });
}

// The sidebar switch and the × on the panel, on a document page only.
const toggle = document.querySelector('[data-sidebar-toggle]');
const closer = document.querySelector('[data-sidebar-close]');
if (toggle) {
  const body = document.body;
  const glyph = toggle.querySelector('[data-sidebar-glyph]');
  const state = toggle.querySelector('[data-sidebar-state]');
  const shown = () => (BESIDE.matches ? body.dataset.sidebar !== 'off' : location.hash === '#panel');
  const paint = () => {
    const on = shown();
    glyph.textContent = on ? 'Ö' : 'ø';
    state.textContent = on ? 'on' : 'off';
    toggle.setAttribute('aria-pressed', String(on));
  };
  const set = on => {
    if (BESIDE.matches) {
      body.dataset.sidebar = on ? 'on' : 'off';
      remember(on ? 'on' : 'off');
    } else {
      location.hash = on ? 'panel' : 'doc';
    }
    paint();
  };
  if (recalled() === 'off') body.dataset.sidebar = 'off';
  toggle.addEventListener('click', event => {
    event.preventDefault();
    set(!shown());
    if (menu) menu.open = false;
  });
  closer?.addEventListener('click', event => {
    if (!BESIDE.matches) return; // in the sheet, the link itself closes it (#doc)
    event.preventDefault();
    set(false);
  });
  // The panel may be reopened elsewhere (Comment does), so keep the switch true.
  document.addEventListener('hj:sidebar', paint);
  addEventListener('hashchange', paint);
  BESIDE.addEventListener('change', paint);
  paint();
}
