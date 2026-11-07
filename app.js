'use strict';
const $ = id => document.getElementById(id);
const examples = {
  api: [{user: {id: 42, name: 'Ada', plan: 'free'}, quota: 100, beta: true, tags: ['api', 'tools']}, {user: {id: '42', name: 'Ada', plan: 'pro'}, quota: 1000, region: 'eu-west', tags: ['api', 'tools']}],
  order: [{name: 'Ada', settings: {theme: 'dark', alerts: true}}, {settings: {alerts: true, theme: 'dark'}, name: 'Ada'}],
  types: [{enabled: true, retries: 3, note: null, users: []}, {enabled: 'true', retries: '3', note: '', users: {}}]
};
let current = null;
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function invalidate() {
  current = null;
  $('export').disabled = true;
  $('filter').disabled = true;
  $('filter').value = '';
  $('filter-count').textContent = '';
  $('changes').replaceChildren(element('p', 'empty', 'Inputs changed. Compare again to see the current differences.'));
  $('stats').replaceChildren();
  $('error').hidden = true;
  $('result-title').textContent = 'Ready when you are.';
}
function showError(message) { $('error').textContent = message; $('error').hidden = false; }
function render() {
  if (!current) return;
  const {changes} = current;
  const search = $('filter').value.toLowerCase();
  const visible = changes.filter(c => (c.path || '(root)').toLowerCase().includes(search));
  $('changes').replaceChildren();
  $('filter-count').textContent = `${visible.length} of ${changes.length}`;
  if (!visible.length) $('changes').append(element('p', 'empty', changes.length ? 'No paths match your filter.' : 'All clear. No differences in this mode. ✦'));
  const fragment = document.createDocumentFragment();
  // A bounded first page keeps a large but valid input from creating an enormous DOM.
  for (const c of visible.slice(0, 300)) {
    const card = element('article', `change ${c.kind}`);
    const heading = element('div', 'change-head');
    heading.append(element('span', 'badge', c.kind === 'type' ? 'TYPE CHANGE' : c.kind.toUpperCase()), element('code', 'path', c.path || '(root)'));
    const values = element('div', 'values');
    for (const side of ['before', 'after']) {
      const box = element('div', 'value');
      const exists = Object.hasOwn(c, side);
      box.append(element('div', 'value-label', `${side.toUpperCase()} · ${exists ? DiffLens.type(c[side]) : 'absent'}`));
      const serialized = exists ? JSON.stringify(c[side], null, 2) : '—';
      box.append(element('pre', '', serialized.length > 8000 ? `${serialized.slice(0, 8000)}\n… preview truncated; full value in Markdown export` : serialized));
      values.append(box);
    }
    card.append(heading, values);
    fragment.append(card);
  }
  $('changes').append(fragment);
  if (visible.length > 300) $('changes').append(element('p', 'empty', `Showing the first 300 of ${visible.length} matching changes. Filter paths to narrow the view. Markdown includes all ${changes.length}.`));
}
function compare() {
  invalidate();
  try {
    const before = DiffLens.parse($('before').value, 'Before');
    const after = DiffLens.parse($('after').value, 'After');
    const structureOnly = $('structure').checked;
    current = {changes: DiffLens.diff(before, after, structureOnly), structureOnly};
    const {changes} = current;
    $('result-title').textContent = changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}, in focus.` : 'Same same. No surprises.';
    for (const [kind, label] of [['added', 'Added'], ['removed', 'Removed'], ['changed', 'Values changed'], ['type', 'Types changed']]) {
      const stat = element('div', `stat ${kind}`);
      stat.append(element('strong', '', String(changes.filter(c => c.kind === kind).length)), element('span', '', label));
      $('stats').append(stat);
    }
    $('export').disabled = false;
    $('filter').disabled = false;
    render();
  } catch (error) { showError(error.message); }
}
function loadExample(name) {
  [$('before').value, $('after').value] = examples[name].map(value => JSON.stringify(value, null, 2));
  $('structure').checked = false;
  compare();
}
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => loadExample(button.dataset.example)));
for (const id of ['before', 'after']) {
  $(id).addEventListener('input', invalidate);
  $(`${id}-file`).addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    invalidate();
    try {
      if (file.size > DiffLens.MAX_BYTES) throw new Error(`${id === 'before' ? 'Before' : 'After'}: file exceeds the 1 MiB limit.`);
      $(id).value = await file.text();
    } catch (error) { showError(error.message); }
    event.target.value = '';
  });
}
$('structure').addEventListener('change', compare);
$('compare').addEventListener('click', compare);
$('filter').addEventListener('input', render);
$('swap').addEventListener('click', () => { [$('before').value, $('after').value] = [$('after').value, $('before').value]; compare(); });
$('clear').addEventListener('click', () => { $('before').value = ''; $('after').value = ''; invalidate(); $('before').focus(); });
$('export').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([DiffLens.markdown(current.changes, current.structureOnly)], {type: 'text/markdown;charset=utf-8'}));
  const anchor = element('a', '');
  anchor.href = url; anchor.download = 'json-diff-report.md'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
loadExample('api');
