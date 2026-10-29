'use strict';
const root = document.getElementById('deals');
const summary = document.getElementById('summary');
let deals = [], selected = 'all';
function label(tag, cls, value) { const node = document.createElement(tag); node.className = cls; node.textContent = value; return node; }
function show() {
  root.replaceChildren();
  const shown = deals.filter(deal => selected === 'all' || deal.category === selected);
  summary.textContent = shown.length + ' saved deals';
  if (!shown.length) {
    root.append(label('p','empty', deals.length ? 'No deals in this category.' : 'No saved deals yet. Your hourly ChatGPT shopping alerts remain active. The automatic website feed is not connected yet.'));
    return;
  }
  for (const deal of shown) {
    const card = label('article','deal','');
    card.append(label('div','thumb fallback','🏷️'));
    const detail = label('div','details','');
    detail.append(label('p','name',deal.name), label('p','desc',deal.description || 'Rating not verified'));
    const prices = label('div','price','');
    prices.append(label('strong','',deal.price));
    if (deal.typicalPrice) prices.append(label('span','old',deal.typicalPrice));
    if (deal.discount) prices.append(label('span','badge',deal.discount));
    detail.append(prices);
    if (deal.conditions) detail.append(label('p','fine',deal.conditions));
    if (deal.url) {
      const anchor = label('a','','View deal');
      anchor.href = deal.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      detail.append(anchor);
    }
    card.append(detail); root.append(card);
  }
}
async function load() {
  try {
    const response = await fetch('/api/personal/deals', {cache:'no-store'});
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    deals = Array.isArray(data.deals) ? data.deals : [];
    show();
  } catch { summary.textContent = 'Feed unavailable'; root.replaceChildren(label('p','empty','Could not load your saved deals.')); }
}
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  selected = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active',b === button));
  show();
}));
document.getElementById('refresh').addEventListener('click',load);
load();
