/** Load actual modular frontend files for the existing UI assertions. No copied implementation. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontend/routes.json'), 'utf8'));
const read = file => fs.readFileSync(path.join(root, 'frontend', file.replace(/^\//, '')), 'utf8');

function domCompatibility(document) {
  const enhanced = new WeakSet(), observers = new Set();
  class MutationObserver {
    constructor(callback){this.callback=callback;this.targets=new Map();this.records=[];this.queued=false;}
    observe(target,options){if(!options.attributes||options.childList||options.characterData)throw new Error('Only attribute observation is supported by this fixture');enhance(target);this.targets.set(target,options);observers.add(this);}
    disconnect(){this.targets.clear();this.records=[];observers.delete(this);}
    takeRecords(){return this.records.splice(0);}
  }
  function changed(target,attributeName,oldValue){
    for(const observer of observers){
      const options=observer.targets.get(target);
      if(!options||options.attributeFilter&&!options.attributeFilter.includes(attributeName))continue;
      observer.records.push({type:'attributes',target,attributeName,oldValue:options.attributeOldValue?oldValue:null});
      if(!observer.queued){observer.queued=true;Promise.resolve().then(()=>{observer.queued=false;const records=observer.takeRecords();if(records.length)observer.callback(records,observer);});}
    }
  }
  function enhance(element){
    if(!element||enhanced.has(element))return element;
    enhanced.add(element);
    if(!element.firstChild)Object.defineProperty(element,'firstChild',{configurable:true,get(){return this.children[0]||null;}});
    if(!element.insertBefore)element.insertBefore=function(child,reference){if(reference!=null&&!this.children.includes(reference))throw new Error('Reference node is not a child');if(child===reference)return child;if(child.parentNode){const siblings=child.parentNode.children,index=siblings.indexOf(child);if(index>=0)siblings.splice(index,1);}child.parentNode=this;this.children.splice(reference==null?this.children.length:this.children.indexOf(reference),0,child);return child;};
    if(!element.prepend)element.prepend=function(child){this.insertBefore(child,this.firstChild);};
    const names=new Set((element.getAttribute?.('class')||element.className||'').split(/\s+/).filter(Boolean));
    for(const method of ['add','remove','toggle'])if(element.classList?.[method]){
      const original=element.classList[method].bind(element.classList);
      element.classList[method]=(...args)=>{const oldValue=names.size?[...names].join(' '):null,result=original(...args);for(const name of method==='toggle'?args.slice(0,1):args){if(element.classList.contains(name))names.add(name);else names.delete(name);}changed(element,'class',oldValue);return result;};
    }
    const set=element.setAttribute?.bind(element);
    if(set)element.setAttribute=(name,value)=>{const oldValue=element.getAttribute?.(name)||null;set(name,value);changed(element,name,oldValue);};
    return element;
  }
  const get=document.getElementById.bind(document),create=document.createElement.bind(document);
  document.getElementById=id=>enhance(get(id));
  document.createElement=(...args)=>enhance(create(...args));
  enhance(document.body);enhance(document.documentElement);
  return {MutationObserver};
}

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
  return "document.addEventListener('DOMContentLoaded', () => {\nconst {MutationObserver} = (" + domCompatibility.toString() + ")(document);\n" + domMethods + manifest.scripts.map(read).join('\n') + '\n  loadPublicCareerPage();\n});\n';
}
module.exports = { html, source, domCompatibility };
