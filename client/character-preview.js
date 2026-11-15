import { Renderer } from './renderer.js';
import { drivers } from '../gameplay/engine.js';
import { characterAbilities } from '../gameplay/special-abilities.js';

export class CharacterPreview {
  clock = 0; last = null; nextFrame = 0; driver = null; color = null; dirty = true; inView = false; renderer = null; presentation = null;
  constructor(panel) {
    this.element = document.createElement('figure'); this.element.className = 'character-preview';
    this.canvas = document.createElement('canvas'); this.canvas.id = 'character-preview'; this.canvas.setAttribute('role', 'img');
    const caption = document.createElement('figcaption'); this.label = document.createElement('span');
    this.button = document.createElement('button'); this.button.type = 'button';
    this.paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.button.onclick = () => { this.paused = !this.paused; this.dirty = true; this.updateButton(); }; this.updateButton();
    caption.append(this.label, this.button); this.element.append(this.canvas, caption); panel.querySelector('.driver-info').after(this.element);
    this.ability = document.createElement('div'); this.ability.className = 'preview-ability'; this.abilityTitle = document.createElement('strong'); this.abilityText = document.createElement('p'); this.abilityControl = document.createElement('span'); this.abilityTiming = document.createElement('small'); this.ability.append(this.abilityTitle, this.abilityText, this.abilityControl, this.abilityTiming); this.element.append(this.ability);
    this.abilityDialog = document.createElement('dialog');
    this.abilityDialog.className = 'ability-dialog';
    this.abilityDialog.setAttribute('aria-labelledby', 'ability-dialog-title');

    for (const event of ['keydown', 'keyup']) {
      this.abilityDialog.addEventListener(event, event => {
        event.stopPropagation();
      });
    }

    document.body.append(this.abilityDialog);
    this.observer = new IntersectionObserver(entries => { this.inView = entries[0].isIntersecting; this.last = null; this.dirty = true; }); this.observer.observe(this.element);
    this.abilityObserver = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width === this.abilityWidth) return;
      this.abilityWidth = width;
      if (width > 0) this.updateAbilitySummaries();
    });
    this.abilityObserver.observe(this.ability);
  }
  updateButton() { this.button.textContent = this.paused ? '▶ PLAY' : 'Ⅱ PAUSE'; this.button.setAttribute('aria-label', this.paused ? 'Play character preview animation' : 'Pause character preview animation'); }
  updateAbilitySummaries() {
    if (!this.ability.clientWidth) return;
    for (const summary of this.ability.querySelectorAll('.ability-summary-row')) {
      const text = summary.querySelector('p');
      const readMore = summary.querySelector('button');
      // Measure at the full available width before reserving room for the link.
      summary.classList.remove('truncated');
      readMore.classList.add('hidden');
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
      const truncated = text.scrollHeight > lineHeight * 2 + 1;
      summary.classList.toggle('truncated', truncated);
      readMore.classList.toggle('hidden', !truncated);
    }
  }
  showAbility(detail, anchor) {
    const bounds = anchor.getBoundingClientRect();
    const title = document.createElement('h2');
    title.id = 'ability-dialog-title';
    title.textContent = detail.title;

    const description = document.createElement('p');
    description.textContent = detail.description;

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.autofocus = true;
    close.onclick = () => this.abilityDialog.close();

    this.abilityDialog.replaceChildren(title, description, close);
    this.abilityDialog.showModal();

    const dialog = this.abilityDialog;
    const maxLeft = Math.max(12, innerWidth - dialog.offsetWidth - 12);
    const maxTop = Math.max(12, innerHeight - dialog.offsetHeight - 12);
    dialog.style.left = `${Math.max(12, Math.min(bounds.left, maxLeft))}px`;
    dialog.style.top = `${Math.max(12, Math.min(bounds.top, maxTop))}px`;
  }
  frame(now, driver, color, phase, abilitiesEnabled = true) {
    if (this.abilityDriver !== driver || this.abilityEnabled !== abilitiesEnabled) {
      this.abilityDriver = driver; this.abilityEnabled = abilitiesEnabled; const details = characterAbilities(driver);
      if (!details.length) details.push({ title: 'NO SPECIAL ABILITY', description: 'This racer uses the standard arena weapons and power-ups.', control: '', timing: '', requiresAbilities: false });
      this.ability.replaceChildren(...details.map((detail, index) => {
        const section = document.createElement('section'); section.className = 'preview-ability-entry';
        const title = index === 0 ? this.abilityTitle : document.createElement('strong'), text = index === 0 ? this.abilityText : document.createElement('p'), control = index === 0 ? this.abilityControl : document.createElement('span'), timing = index === 0 ? this.abilityTiming : document.createElement('small');
        const disabled = !abilitiesEnabled && detail.requiresAbilities !== false;
        title.textContent = detail.title; text.textContent = detail.description; control.textContent = disabled ? 'DISABLED BY ROOM HOST' : detail.control; timing.textContent = detail.timing ? `Arena ability · ${detail.timing}` : ''; section.classList.toggle('disabled', disabled);
        if (detail.title === 'NO SPECIAL ABILITY') {
          section.append(title, text, control, timing);
        } else {
          const summary = document.createElement('div');
          summary.className = 'ability-summary-row';

          const readMore = document.createElement('button');
          readMore.type = 'button';
          readMore.className = 'ability-read-more';
          readMore.textContent = 'Read more';
          readMore.setAttribute('aria-haspopup', 'dialog');
          readMore.setAttribute(
            'aria-label',
            `Read more about ${detail.title}`
          );
          readMore.onclick = () => this.showAbility(detail, summary);

          summary.append(text, readMore);
          section.append(title, summary, control, timing);
        }

        return section;
      }));
      this.updateAbilitySummaries();
    }
    const available = ['ready', 'finished'].includes(phase); this.element.classList.toggle('hidden', !available);
    if (!available || !this.inView || document.hidden) { this.last = null; return; }
    if (this.driver !== driver || this.color !== color) { this.driver = driver; this.color = color; this.clock = 0; this.dirty = true; this.canvas.setAttribute('aria-label', `Animated 3D preview of ${drivers[driver].name}`); }
    const dt = this.last === null ? 0 : Math.min(.1, (now - this.last) / 1000); this.last = now;
    if (!this.paused) this.clock += dt;
    if (!this.dirty && (this.paused || now < this.nextFrame)) return;
    this.nextFrame = now + 1000 / 30; this.dirty = false;
    if (!this.renderer) { this.renderer = new Renderer(this.canvas); this.renderer.setQuality('balanced'); }
    this.presentation = this.renderer.drawPreview(driver, color, this.clock); if (this.label.textContent !== this.presentation.label) this.label.textContent = this.presentation.label;
  }
}
