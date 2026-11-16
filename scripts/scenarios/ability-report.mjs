const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const cells = line => line.split('|').slice(1, -1).map(cell => cell.trim());

function table(lines) {
  const [headers, , ...rows] = lines.map(cells);
  return `<div class="table-scroll"><table><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function renderAbilityReport(markdown, {matches, minutes}) {
  const lines = markdown.split('\n');
  const rankingStart = lines.findIndex(line => line.startsWith('| Racer | Ability |'));
  if (rankingStart < 0) throw new Error('The simulation report has no ability ranking.');
  const rankingLines = [];
  for (const line of lines.slice(rankingStart)) {
    if (!line.startsWith('|')) break;
    rankingLines.push(line);
  }
  const headers = cells(rankingLines[0]);
  const rows = rankingLines.slice(2).map(cells);
  const fields = headers.flatMap((header, index) => header.startsWith('Net, ') ? [{name: header.slice(5), index}] : []);
  const charts = fields.map(({name, index}) => {
    const ranked = rows.map(row => {
      const [net, error] = row[index].split('±').map(Number);
      if (!Number.isFinite(net) || !Number.isFinite(error)) throw new Error('Invalid contribution in simulation report.');
      return {row, net, error};
    }).sort((a, b) => b.net - a.net);
    const max = Math.max(1, ...ranked.map(({net, error}) => Math.abs(net) + error));
    return `<section class="panel"><div class="section-title"><div><span class="eyebrow">${escape(name)} field</span><h2>${name === 'plain' ? 'Raw ability power' : 'Against the competition'}</h2></div><span class="unit">Δ kills − deaths / match</span></div><p>${name === 'plain' ? 'Opponents have no special abilities.' : 'Opponents have all their special abilities enabled.'} Both together compares the complete ability set with no abilities. Individual rows show Shapley contributions. Whiskers show the 95% confidence interval.</p><div class="axis"><span>Hurts performance</span><span>Helps performance</span></div>${ranked.map(({row, net, error}, i) => `<div class="rank-row"><div class="rank">${String(i + 1).padStart(2, '0')}</div><div class="ability"><strong>${escape(row[1])}</strong><small>${escape(row[0])}</small></div><div class="track" role="img" aria-label="${escape(`${row[1]}: ${row[index]} net contribution`)}"><i class="bar ${net < 0 ? 'negative' : ''}" style="left:${50 + Math.min(0, net) / max * 50}%;width:${Math.abs(net) / max * 50}%"></i><i class="whisker" style="left:${50 + (net - error) / max * 50}%;width:${2 * error / max * 50}%"></i><i class="dot" style="left:${50 + net / max * 50}%"></i></div><div class="value ${net < 0 ? 'loss' : 'gain'}">${net > 0 ? '+' : ''}${net.toFixed(2)}<small>± ${error.toFixed(2)}</small></div></div>`).join('')}</section>`;
  }).join('');
  const details = [];
  for (let i = rankingStart + rankingLines.length; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) details.push(`<h3>${escape(line.slice(3))}</h3>`);
    if (line.startsWith('### ')) details.push(`<h4>${escape(line.slice(4))}</h4>`);
    if (!line.startsWith('|')) continue;
    const block = [];
    while (i < lines.length && lines[i].startsWith('|')) block.push(lines[i++]);
    i--;
    details.push(table(block));
  }
  const methodology = lines.slice(0, rankingStart).filter(line => line && !line.startsWith('#')).join(' ').replace(/\*\*/g, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ability Lab · Wild Wheels</title><style>
  :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#090e19;color:#e7ecf6}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 85% 0,#162b45,transparent 48%)}main{max-width:1240px;margin:auto;padding:56px 28px}header{margin-bottom:36px}.eyebrow{font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:#5ce4c0}h1{font-size:clamp(42px,7vw,78px);letter-spacing:-4px;margin:12px 0}h1 span{color:#5ce4c0}p{color:#9aaac1;line-height:1.7;max-width:850px}header p{font-size:18px}.stats{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0}.stat{flex:1;min-width:140px;background:#111c2c;border:1px solid #25334a;border-radius:16px;padding:20px}.stat strong{display:block;font-size:29px}.stat span,small{color:#94a6bf;font-size:12px}.panel{background:#101a2bcc;border:1px solid #26344c;border-radius:22px;padding:28px;margin:24px 0}.section-title{display:flex;align-items:center;justify-content:space-between;gap:15px}h2{margin:9px 0;font-size:25px;letter-spacing:-.7px}.unit{font-size:12px;color:#9aaac1}.axis{display:flex;justify-content:space-between;margin:24px 85px 12px 310px;font-size:10px;color:#7187a5}.rank-row{display:grid;grid-template-columns:32px 250px minmax(100px,1fr) 80px;gap:14px;align-items:center;padding:13px 0;border-top:1px solid #213049}.rank{font-size:12px;color:#657c9c;font-variant-numeric:tabular-nums}.ability strong{font-size:13px}.ability small,.value small{display:block;margin-top:4px}.track{position:relative;height:32px;background:linear-gradient(90deg,transparent 49.8%,#52617c 50%,transparent 50.2%)}.bar{position:absolute;top:9px;height:14px;border-radius:4px;background:linear-gradient(90deg,#178780,#5ce4c0)}.bar.negative{background:linear-gradient(90deg,#f27993,#a73e69)}.whisker{position:absolute;top:15px;height:2px;background:#dce8f9;border-left:2px solid white;border-right:2px solid white}.dot{position:absolute;top:12px;width:8px;height:8px;border-radius:50%;background:#f2f6ff;transform:translateX(-50%)}.value{text-align:right;font-size:16px;font-weight:750;font-variant-numeric:tabular-nums}.gain{color:#5ce4c0}.loss{color:#f68ba6}.value small{font-weight:400;color:#94a6bf}details summary{cursor:pointer;font-weight:700;padding:6px 0}.table-scroll{overflow:auto;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}th,td{text-align:right;padding:12px;border-bottom:1px solid #28364b}th{color:#8ea7c8}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}tbody tr:hover{background:#1a2940}h3{color:#5ce4c0;margin-top:32px}h4{margin-bottom:8px}footer{color:#7187a5;font-size:12px;margin-top:28px}@media(max-width:700px){main{padding:28px 14px}.panel{padding:18px 14px}.rank-row{grid-template-columns:23px minmax(95px,1fr) minmax(80px,1fr) 58px;gap:8px}.ability strong{font-size:11px}.value{font-size:13px}.axis{margin-left:40%;margin-right:65px}.section-title{display:block}.rank-row small{font-size:10px}h1{letter-spacing:-2px}}@media print{body{background:#090e19}.panel{break-inside:avoid}details{display:block}}
  </style></head><body><main><header><span class="eyebrow">Wild Wheels / simulation intelligence</span><h1>Every ability.<br><span>Measured.</span></h1><p>The Ability Lab isolates what each power adds to a racer's performance, using the real game rules and bot AI.</p><div class="stats"><div class="stat"><strong>${rows.length}</strong><span>abilities &amp; combinations</span></div><div class="stat"><strong>${escape(matches)}</strong><span>matched seeds per subset</span></div><div class="stat"><strong>${escape(minutes)} min</strong><span>per simulated match</span></div><div class="stat"><strong>${fields.length}</strong><span>opponent fields</span></div></div></header>${charts}<details class="panel"><summary>How to read these results</summary><p>${escape(methodology)}</p><p>Positive net contribution improves kills minus deaths. A confidence interval crossing zero leaves the direction uncertain. Identical outcomes do not prove an ability never activated. These results measure bot performance, not human skill.</p></details><details class="panel"><summary>Full rankings &amp; match breakdowns</summary>${table(rankingLines)}${details.join('')}</details><footer>Generated ${escape(new Date().toISOString())} · Deterministic paired seeds · Shapley attribution · Wild Wheels Ability Lab</footer></main></body></html>`;
}
