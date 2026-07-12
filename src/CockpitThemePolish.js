import './styles/cockpit-polish.css';

const ROOT_CLASS = 'cockpit-polished';
let observer = null;
let liveHandler = null;

function root() { return typeof document === 'undefined' ? null : document.documentElement; }
function addClass(name) { root()?.classList.add(name); }

export function applyPanelStyles() {
  addClass('cockpit-panels');
  const markPanels = scope => {
    if (scope?.matches?.('.card, .act-card')) scope.classList.add('cockpit-panel');
    scope?.querySelectorAll?.('.card, .act-card').forEach(panel => panel.classList.add('cockpit-panel'));
  };
  markPanels(document);
  observer ||= new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => node.nodeType === 1 && markPanels(node))));
  observer.observe(document.body, { childList: true, subtree: true });
}

export function applyGlowSystem() { addClass('cockpit-glows'); }
export function applyTypographyHierarchy() { addClass('cockpit-type'); }
export function applyAnimationSmoothing() { addClass('cockpit-motion'); }
export function applySpacingSystem() { addClass('cockpit-spacing'); }

export function applyIconConsistency() {
  addClass('cockpit-icons');
  const normalize = scope => scope?.querySelectorAll?.('.scb-arr, .tp-arrow').forEach(button => {
    const label = button.getAttribute('aria-label') || '';
    if (label.startsWith('Increase')) button.textContent = '▲';
    if (label.startsWith('Decrease')) button.textContent = '▼';
  });
  normalize(document);
}

export function applyLiveModeVisuals() {
  addClass('cockpit-live-visuals');
  liveHandler ||= event => root()?.classList.toggle('cockpit-market-live', Boolean(event.detail?.active));
  window.addEventListener('nq:market-open-mode', liveHandler);
}

export function applyGlobalStyles() {
  const documentRoot = root();
  if (!documentRoot) return () => {};
  documentRoot.classList.add(ROOT_CLASS);
  applyPanelStyles();
  applyGlowSystem();
  applyTypographyHierarchy();
  applyAnimationSmoothing();
  applySpacingSystem();
  applyIconConsistency();
  applyLiveModeVisuals();

  return () => {
    observer?.disconnect(); observer = null;
    if (liveHandler) window.removeEventListener('nq:market-open-mode', liveHandler);
    liveHandler = null;
    documentRoot.classList.remove(ROOT_CLASS, 'cockpit-panels', 'cockpit-glows', 'cockpit-type', 'cockpit-motion', 'cockpit-spacing', 'cockpit-icons', 'cockpit-live-visuals', 'cockpit-market-live');
  };
}

export default applyGlobalStyles;
