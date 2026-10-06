/** Minimal DOM for executing the real bootstrap and classic scripts, not a UI reimplementation. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontend/routes.json'), 'utf8'));

async function createFrontendRuntime(base, initialPath = '/login', initialStorage = [], viewport = {}) {
  const nodes = new Map(), events = new Map(), documentEvents = new Map(), storage = new Map(), intervals = new Map(), timeouts = new Map(), errors = [], requests = [];
  for (const [key, value] of initialStorage) storage.set(key, value);
  let ready, context, timerId = 0;
  const read = source => fs.readFileSync(path.join(root, 'frontend', source.replace(/^\//,'')), 'utf8');
  function node() {
    const listeners = new Map(), attributes = new Map(), classes = new Set();
    return {listeners,attributes,classes,value:'',innerHTML:'',style:{},dataset:{},children:[],files:[],disabled:false,
      get textContent(){return this._textContent??'';},set textContent(value){this._textContent=value;this.children=[];},
      classList:{add:(...values)=>values.forEach(v=>classes.add(v)),remove:(...values)=>values.forEach(v=>classes.delete(v)),contains:v=>classes.has(v),toggle(v,force){const enabled=force===undefined?!classes.has(v):force;enabled?classes.add(v):classes.delete(v);return enabled;}},
      addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);},
      removeEventListener(type,handler){listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==handler));},
      setAttribute(key,value){attributes.set(key,value);if(key==='class'){classes.clear();value.split(/\s+/).forEach(v=>classes.add(v));}},getAttribute:key=>attributes.get(key)||'',
      removeAttribute(key){attributes.delete(key);if(key==='src')delete this.src;},
      appendChild(child){child.parentNode=this;this.children.push(child);return child;},
      querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);},
      querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
      reset(){},focus(){document.activeElement=this;},remove(){},
      contains(target){return target===this||this.children.some(child=>child.contains(target));},
      closest(selector){return this.matches(selector)?this:this.parentNode?.closest(selector)||null;},
      matches(selector){
        if(selector.startsWith('.'))return classes.has(selector.slice(1))||(this.className||'').split(/\s+/).includes(selector.slice(1));
        const attribute=selector.match(/^\[([\w-]+)(?:="([^"]+)")?\]$/);
        return !!attribute&&attributes.has(attribute[1])&&(attribute[2]===undefined||attributes.get(attribute[1])===attribute[2]);
      },
      getBoundingClientRect(){return this.id==='users-action-menu'
        ? {top:0,left:0,right:220,bottom:this.children.length*40+12,width:220,height:this.children.length*40+12}
        : {top:100,left:1100,right:1136,bottom:136,width:36,height:36};},
      click(){},
      async dispatch(type,event={}){for(const handler of listeners.get(type)||[])await handler({preventDefault(){},stopPropagation(){},...event});}};
  }
  function parse(source) {
    for(const match of source.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
      const item=node(); item.id=match[1];
      for(const attr of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) {
        item.setAttribute(attr[1],attr[2]);
        if(attr[1]==='class')attr[2].split(/\s+/).forEach(v=>item.classes.add(v));
        if(attr[1]==='value')item.value=attr[2];
      }
      nodes.set(item.id,item);
    }
  }
  const shell=read('index.html');parse(shell);
  const slots=[...shell.matchAll(/<template data-fragment="([^"]+)"><\/template>/g)].map(match=>({dataset:{fragment:match[1]},replaceWith(fragment){parse(fragment.source);}}));
  const meta=node();meta.setAttribute('content','/api/v1');
  const document={body:node(),documentElement:node(),getElementById:id=>nodes.get(id)||null,
    querySelector:selector=>selector==='meta[name="ats-api-base"]'?meta:null,
    querySelectorAll:selector=>selector==='template[data-fragment]'?slots:selector==='.app-sidebar .nav-link'?[...nodes.values()].filter(item=>item.classes.has('nav-link')):selector==='.modal-overlay'?[...nodes.values()].filter(item=>item.classes.has('modal-overlay')):[],
    addEventListener(type,handler){if(type==='DOMContentLoaded')ready=handler;else{if(!documentEvents.has(type))documentEvents.set(type,[]);documentEvents.get(type).push(handler);}},
    removeEventListener(type,handler){documentEvents.set(type,(documentEvents.get(type)||[]).filter(item=>item!==handler));},
    async dispatch(type,event={}){for(const handler of documentEvents.get(type)||[])await handler({preventDefault(){},...event});},
    createElement(tag){const item=node();if(tag==='template'){item.content={};Object.defineProperty(item,'innerHTML',{set(source){item.content.source=source;}});}return item;}};
  document.body.appendChild=function(item){this.children.push(item);if(item.src){try{vm.runInContext(read(item.src),context,{filename:item.src});item.onload();}catch(error){errors.push(error);throw error;}}return item;};
  const location={protocol:'http:',hostname:'127.0.0.1',port:new URL(base).port,origin:base,pathname:initialPath,search:''};
  const historyEntries=[initialPath];let historyIndex=0;
  function setLocation(target){const url=new URL(target,base);location.pathname=url.pathname;location.search=url.search;}
  const history={pushState(_,__,url){historyEntries.splice(++historyIndex);historyEntries[historyIndex]=url;setLocation(url);},replaceState(_,__,url){historyEntries[historyIndex]=url;setLocation(url);}};
  const fakeStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key),clear:()=>storage.clear()};
  const window={location,history,innerWidth:viewport.width??1280,innerHeight:viewport.height??800,scrollTo(){},
    addEventListener(type,handler){if(!events.has(type))events.set(type,[]);events.get(type).push(handler);},
    removeEventListener(type,handler){events.set(type,(events.get(type)||[]).filter(item=>item!==handler));},confirm:()=>true};
  async function dispatchWindow(type,event={}){for(const handler of events.get(type)||[])await handler(event);}
  const pending=new Set();
  async function transport(url,options){
    const target=new URL(url,base);assertLocal(target);
    requests.push({path:target.pathname,search:target.search,method:options?.method||'GET'});
    if(/\/auth\/(forgot-password|verify-otp|resend-otp|reset-password)/.test(target.pathname))throw new Error('Email/reset calls forbidden in routing smoke');
    const task=fetch(target,options);pending.add(task);try{return await task;}finally{pending.delete(task);}
  }
  function assertLocal(url){if(url.origin!==base)throw new Error('Non-isolated request rejected: '+url.origin);}
  context=vm.createContext({window,document,sessionStorage:fakeStorage,localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    fetch:transport,URL,URLSearchParams,Blob,FormData,Intl,console:{log(){},warn(){},error(...args){errors.push(args.map(String).join(' '));}},
    setInterval(fn){intervals.set(++timerId,fn);return timerId;},clearInterval:id=>intervals.delete(id),
    setTimeout(fn){timeouts.set(++timerId,fn);return timerId;},clearTimeout:id=>timeouts.delete(id),
    navigator:{clipboard:{writeText:async()=>{}}},confirm:()=>true,prompt:()=>''});
  for(const source of ['/js/api.js','/js/router.js','/js/app.js'])vm.runInContext(read(source),context,{filename:source});
  await ready();
  async function settle(){for(let i=0;i<30;i++){await new Promise(resolve=>setImmediate(resolve));if(pending.size)await Promise.allSettled([...pending]);}}
  await settle();
  return {context,window,document,nodes,storage,errors,requests,intervals,timeouts,documentEvents,events,settle,dispatchWindow,
    async back(){if(historyIndex){setLocation(historyEntries[--historyIndex]);await dispatchWindow('popstate');await settle();}},
    async forward(){if(historyIndex+1<historyEntries.length){setLocation(historyEntries[++historyIndex]);await dispatchWindow('popstate');await settle();}}};
}
module.exports={createFrontendRuntime};
