/** Load actual modular frontend files for the existing UI assertions. No copied implementation. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontend/routes.json'), 'utf8'));
const read = file => fs.readFileSync(path.join(root, 'frontend', file.replace(/^\//, '')), 'utf8');

function html() {
  return read('index.html').replace(/<template data-fragment="([^"]+)"><\/template>/g, (_, fragment) => read(fragment));
}
function source() {
  // Preserve the existing synchronous VM harness and its instrumentation hook.
  // Production loads these same files once, after their fragments have mounted.
  // Older synchronous VM fixtures omit this standard DOM method. Supply it in
  // the fixture loader, preserving their assertions and production scripts.
  const domMethods = `const fixtureGetElement = document.getElementById.bind(document);
document.getElementById = id => {
  const element = fixtureGetElement(id);
  if (element && !element.removeAttribute) element.removeAttribute = name => element.setAttribute(name, '');
  if (element && !element.contains) element.contains = target => target === element || element.children.some(child => child === target || child.contains?.(target));
  return element;
};\n`;
  return "document.addEventListener('DOMContentLoaded', () => {\n" + domMethods + manifest.scripts.map(read).join('\n') + '\n  loadPublicCareerPage();\n});\n';
}
module.exports = { html, source };
