import {expect} from '@playwright/test';

// Inspect the actual Razor/dynamic controls, not an isolated duplicate of their CSS.
export async function assertLeaveControls(root, {fields = true} = {}) {
  const result = await root.evaluate(container => {
    const probe = document.createElement('span');
    document.body.append(probe);
    const token = name => {
      probe.style.backgroundColor = 'var(--cw-' + name + ')';
      return getComputedStyle(probe).backgroundColor;
    };
    const palette = Object.fromEntries(['raised', 'text', 'muted', 'active', 'active-text', 'danger-bg', 'danger', 'hover'].map(name => [name, token(name)]));
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const fields = [...container.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea')]
      .filter(visible).map(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        return {name: node.name || node.getAttribute('aria-label'), shared: node.classList.contains('cw-form-control'),
          label: !!(node.labels?.length || node.getAttribute('aria-label')), height: box.height, radius: style.borderRadius,
          background: style.backgroundColor, color: style.color, opacity: style.opacity, disabled: node.matches(':disabled'),
          parentWidth: node.parentElement.getBoundingClientRect().width, width: box.width};
      });
    const buttons = [...container.querySelectorAll('button:not(.cw-entity-trigger)')].filter(node => visible(node) && !node.closest('.cw-entity-picker')).map(node => {
      const style = getComputedStyle(node), disabled = node.matches(':disabled'), variant = node.dataset.variant;
      const hover = node.matches(':hover');
      return {name: node.textContent.trim() || node.getAttribute('aria-label'), shared: node.classList.contains('cw-button'),
        height: node.getBoundingClientRect().height, compact: node.dataset.size === 'compact',
        background: style.backgroundColor, color: style.color,
        expectedBackground: disabled ? palette.raised : variant === 'primary' ? palette.active : variant === 'danger' ? palette['danger-bg'] : variant === 'quiet' ? (hover ? palette.hover : 'rgba(0, 0, 0, 0)') : palette.raised,
        expectedColor: disabled ? palette.muted : variant === 'primary' ? palette['active-text'] : variant === 'danger' ? palette.danger : palette.text};
    });
    probe.remove();
    return {fields, buttons, palette};
  });
  if (fields) expect(result.fields.length).toBeGreaterThan(0);
  else expect(result.buttons.length).toBeGreaterThan(0);
  for (const field of result.fields) {
    expect(field.shared, field.name).toBe(true);
    expect(field.label, field.name).toBe(true);
    expect(field.radius, field.name).toBe('8px');
    expect(field.height, field.name).toBeGreaterThanOrEqual(44);
    expect(field.width, field.name).toBeLessThanOrEqual(field.parentWidth + 1);
    expect(field.background, field.name).toBe(result.palette.raised);
    expect(field.color, field.name).toBe(result.palette.text);
    expect(field.opacity, field.name).toBe(field.disabled ? '0.7' : '1');
  }
  for (const button of result.buttons) {
    expect(button.shared, button.name).toBe(true);
    expect(button.height, button.name).toBeGreaterThanOrEqual(button.compact ? 32 : 44);
    expect(button.background, button.name).toBe(button.expectedBackground);
    expect(button.color, button.name).toBe(button.expectedColor);
  }
}
