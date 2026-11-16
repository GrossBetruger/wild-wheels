import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderAbilityReport} from '../../scripts/scenarios/ability-report.mjs';

test('ability dashboard keeps both opponent fields and their measured uncertainty', () => {
  const markdown = `# Ability importance
Each racer played paired matches.
## Ranking
| Racer | Ability | Net, plain | Kills, plain | Deaths, plain | Won, plain | Net, mixed | Kills, mixed | Deaths, mixed | Won, mixed |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Racer A | Healing | +2.00 ± 0.50 | +0.00 | -2.00 | +5 pts | -1.00 ± 0.25 | -1.00 | +0.00 | -2 pts |
| Racer A | Both together: Healing + Fire | +5.00 ± 0.75 | +3.00 | -2.00 | +10 pts | +3.00 ± 0.60 | +2.00 | -1.00 | +8 pts |

## plain field: racers with no abilities
### Racer A, plain field
| Abilities on | Kills | Deaths | Net | Won |
|---|---:|---:|---:|---:|
| none | 3.00 | 4.00 | -1.00 | 10% |
`;
  const html = renderAbilityReport(markdown, {matches: 40, minutes: 4});
  assert.ok(html.includes('Raw ability power'));
  assert.ok(html.includes('Against the competition'));
  assert.ok(html.includes('Healing: +2.00 ± 0.50 net contribution'));
  assert.ok(html.includes('Healing: -1.00 ± 0.25 net contribution'));
  assert.ok(html.includes('Both together: Healing + Fire: +5.00 ± 0.75 net contribution'));
  assert.ok(html.includes('Both together: Healing + Fire: +3.00 ± 0.60 net contribution'));
  assert.ok(html.includes('Both together compares the complete ability set with no abilities.'));
  assert.ok(html.includes('<td>+3.00</td><td>-2.00</td><td>+10 pts</td>'));
  assert.ok(html.includes('<td>none</td><td>3.00</td><td>4.00</td><td>-1.00</td><td>10%</td>'));
});

test('single-field reports safely display racer and ability names as text', () => {
  const markdown = `# Ability importance
## Ranking
| Racer | Ability | Net, mixed | Kills, mixed | Deaths, mixed | Won, mixed |
|---|---|---:|---:|---:|---:|
| <img src=x onerror=alert(1)> | Power & "speed" | +0.00 ± 0.00 | +0.00 | +0.00 | +0 pts |
`;
  const html = renderAbilityReport(markdown, {matches: 2, minutes: 1});
  assert.ok(html.includes('Against the competition'));
  assert.ok(!html.includes('Raw ability power'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('Power &amp; &quot;speed&quot;'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('NaN'));
});
