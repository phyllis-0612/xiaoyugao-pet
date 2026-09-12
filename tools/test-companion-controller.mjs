import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code = await readFile(new URL('../companion.js',import.meta.url),'utf8');
const {Companion,SCENES,sceneLines,currentCard,migrateCompanionSettings}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let now=0, next=0;
const timers=new Map();
const setTimeout=(fn,delay=0)=>{timers.set(++next,{fn,at:now+delay});return next;};
const clearTimeout=id=>timers.delete(id);
const advance=ms=>{const end=now+ms;while(true){const pending=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pending)break;const [id,t]=pending;timers.delete(id);now=t.at;t.fn();}now=end;};
const classes=new Set();
const classList={add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,value)=>value?classes.add(x):classes.delete(x)};
const root={classList,style:{setProperty(){}},dataset:{},setAttribute(){},getBoundingClientRect:()=>({left:170,top:550,width:202,height:202})};
const bubble={classList:{...classList},dataset:{},style:{setProperty(k,v){this[k]=v;}},offsetWidth:260,offsetHeight:100,textContent:''};
const renderer={state:'idle',setForm(){},setState(s){this.state=s;},currentForm:()=> 'sitting',stop(){},start(){},setReducedMotion(){},pulse(){}};
const ctx={extensionSettings:{},characters:[{avatar:'a.png',name:'甲'}],characterId:0,chatId:'a',chat:[{mes:'old'}],saveSettingsDebounced(){}};
const handlers={};ctx.event_types=Object.fromEntries(['MESSAGE_SENT','GENERATION_STARTED','MESSAGE_RECEIVED','GENERATION_ENDED','GENERATION_STOPPED','IMPERSONATE_READY','STREAM_TOKEN_RECEIVED','CHAT_CHANGED'].map(x=>[x,x]));ctx.eventSource={on:(k,f)=>handlers[k]=f};
const settings={enabled:true,showBubble:true,autoSwim:false,customBubbles:{report:'现在{时间}，今天{今日卡数}卡{今日层数}层。<b>陪着呢</b>'}};
const cat=new Companion(settings,()=>ctx,()=>{});
const world={Companion,SCENES,sceneLines,currentCard,migrateCompanionSettings,console,performance:{now:()=>now},Date:class extends Date{static now(){return now;}},window:{setTimeout,clearTimeout,requestAnimationFrame:()=>0,cancelAnimationFrame(){},matchMedia:()=>({matches:false}),getComputedStyle:()=>({getPropertyValue:()=> '0'}),innerWidth:390,innerHeight:844},document:{readyState:'loading',documentElement:{clientWidth:390,clientHeight:844},getElementById:()=>null,addEventListener(){},removeEventListener(){}},SillyTavern:{getContext:()=>ctx},PET_STATES:Object.fromEntries(['idle','listening','thinking','happy','confused','petting','nuzzling','sleeping','wave'].map(x=>[x.toUpperCase(),x])),WAVE_DURATION_MS:1800,NUZZLE_DURATION_MS:3600,getSwimStrideLength:()=>48};
const sandbox=vm.createContext(world);
let source=await readFile(new URL('../index.js',import.meta.url),'utf8');
source=source.replace(/^import .*;$/gm,'').replaceAll('import.meta.url',JSON.stringify('http://localhost/scripts/extensions/third-party/xiaoyugaopet/index.js')).replaceAll('export function','function');
source+='\nthis.testApi={setup(s,c,r,u,co){settings=s;context=c;renderer=r;ui=u;companion=co;},bindSillyTavernEvents,showCompanionReport,returnToAmbient,showBubble,hideBubble,handlePointerUp,scheduleLongPress,drag,positionBubble,petXiaoyugao,getSettings,bindSettingsControls,bubbleViewportBox,chooseSwimTarget};';
vm.runInContext(source,sandbox);
const api=sandbox.testApi;api.setup(settings,ctx,renderer,{root,bubble},cat);api.bindSillyTavernEvents();
handlers.GENERATION_STARTED('normal');ctx.chat.push({mes:'reply',send_date:'one'});handlers.MESSAGE_RECEIVED(1);handlers.GENERATION_ENDED();
assert.equal(cat.values().今日层数,1,'real controller wires counting');
const swimPath=api.chooseSwimTarget(1);
assert.equal(swimPath.direction,-1,'swim turns away from a blocked edge');
assert.ok(swimPath.targetLeft>=10 && swimPath.targetLeft<=178,'swim target stays inside viewport bounds');
api.showCompanionReport();assert.ok(bubble.textContent.includes('1卡1层'));
advance(3000);assert.ok(classes.has('is-visible'),'ambient return preserves report');
api.showBubble('回信来啦！');assert.ok(bubble.textContent.includes('1卡1层'),'ambient bubbles do not overwrite explicit report');
// Begin and release the actual long-press controller with fake timers.
api.drag.active=true;api.drag.moved=false;api.drag.pointerId=7;api.scheduleLongPress();advance(600);
assert.equal(api.drag.longPress,true);
api.handlePointerUp({pointerId:7,clientX:250,clientY:650,stopImmediatePropagation(){},preventDefault(){}});
assert.equal(api.drag.active,false);assert.ok(classes.has('is-visible'),'release preserves report');
advance(4999);assert.ok(classes.has('is-visible'),'report remains visible before five seconds');
advance(1);assert.ok(!classes.has('is-visible'),'report expires at exactly five seconds, even for long copy');
settings.enabled=false;handlers.GENERATION_STARTED('normal');ctx.chat.push({mes:'disabled reply',send_date:'two'});handlers.MESSAGE_RECEIVED(2);handlers.GENERATION_ENDED();assert.equal(cat.values().今日层数,1,'disabled counter');
settings.enabled=true;handlers.GENERATION_STARTED('regenerate');ctx.chat.push({mes:'regenerated',send_date:'three'});handlers.MESSAGE_RECEIVED(3,'regenerate');handlers.GENERATION_ENDED();assert.equal(cat.values().今日层数,1,'regeneration excluded through controller');
api.positionBubble();const left=170+parseFloat(bubble.style.left),top=550+parseFloat(bubble.style.top);assert.ok(left>=8 && left+260<=382 && top>=8 && top+100<=836,'positioning fits 390px viewport');
console.log('PASS: controller event wiring, safe swim target, long-press/release, report lifetime, ambient protection, disabled and regeneration filtering, mobile position math.');

advance(10000);api.hideBubble();settings.companionMode='quiet';
api.showBubble('回信来啦！');assert.ok(!classes.has('is-visible'),'quiet suppresses automatic bubbles');
handlers.GENERATION_STARTED('normal');ctx.chat.push({mes:'quiet mode reply',send_date:'four'});handlers.MESSAGE_RECEIVED(4);handlers.GENERATION_ENDED();assert.equal(cat.values().今日层数,2,'quiet mode retains daily counting');
api.petXiaoyugao();assert.ok(classes.has('is-visible'),'quiet still answers manual petting');
advance(5000);api.showCompanionReport();assert.ok(classes.has('is-visible'),'quiet still reports');advance(5000);
settings.companionMode='daily';advance(10000);
api.showBubble('first automatic',1500);assert.equal(bubble.textContent,'first automatic');
advance(5000);api.showBubble('too soon',1500);assert.ok(!classes.has('is-visible'),'automatic bubbles throttled');
advance(5000);api.showBubble('next automatic',0);assert.equal(bubble.textContent,'next automatic');
advance(5000);assert.ok(!classes.has('is-visible'),'waiting bubble has finite lifetime');
ctx.extensionSettings.xiaoyugao_pet={scale:40};assert.equal(api.getSettings().scale,40,'saved 40 percent survives reload');
ctx.extensionSettings.xiaoyugao_pet.scale=20;assert.equal(api.getSettings().scale,40,'minimum is 40 percent');
console.log('PASS: quiet/manual interaction, ten-second ambient interval, finite wait bubble and 40-percent settings.');
// Exercise editor bindings: the selected scope must be the actual write target.
const elements={};
for(const id of ['xiaoyugao-bubble-scene','xiaoyugao-bubble-lines','xiaoyugao-bubble-scope','xiaoyugao-bubble-scope-label','xiaoyugao-bubble-reset','xiaoyugao-bubble-preview','xiaoyugao-report','xiaoyugao-companion-mode']) {
 elements[id]={value:'',textContent:'',options:[],handlers:{},addEventListener(k,f){this.handlers[k]=f;},removeEventListener(){},append(option){this.options.push(option);}};
}
elements['xiaoyugao-bubble-scene'].value='chat';
elements['xiaoyugao-bubble-scope'].value='general';elements['xiaoyugao-bubble-scope'].options=[{},{}];
world.document.getElementById=id=>elements[id]??null;
world.document.createElement=()=>({});world.document.querySelectorAll=()=>[];
settings.customBubbles.chat='通用';settings.cardBubbles={};settings.companionMode='daily';
api.bindSettingsControls();
const scope=elements['xiaoyugao-bubble-scope'],editor=elements['xiaoyugao-bubble-lines'];
assert.equal(editor.value,'通用');
scope.value='card';scope.handlers.change();assert.equal(editor.value,'');
editor.value='甲的台词';editor.handlers.input();assert.equal(settings.cardBubbles['card:a.png'].chat,'甲的台词');
ctx.characters.push({name:'乙',avatar:'b.png'});ctx.characterId=1;ctx.chatId='b';ctx.chat=[];
handlers.CHAT_CHANGED();assert.equal(editor.value,'','switching card refreshes editor rather than leaking previous copy');
editor.value='乙的台词';editor.handlers.input();
assert.equal(settings.cardBubbles['card:a.png'].chat,'甲的台词');assert.equal(settings.cardBubbles['card:b.png'].chat,'乙的台词');
elements['xiaoyugao-bubble-reset'].handlers.click();assert.equal(editor.value,'');assert.equal(cat.say('chat'),'通用');
ctx.groupId='group';handlers.CHAT_CHANGED();assert.equal(scope.value,'general');assert.equal(scope.options[1].disabled,true);
console.log('PASS: settings editor writes correct card, follows chat changes, resets to general inheritance and disables card scope for groups.');

// A top-edge pet must use a side bubble, with a tail facing the pet.
root.getBoundingClientRect=()=>({left:292,top:10,width:80,height:80});
bubble.offsetWidth=220;bubble.offsetHeight=45;api.positionBubble();
assert.equal(bubble.dataset.placement,'left');
assert.ok(292+parseFloat(bubble.style.left)+220<=282,'top-right bubble clears pet body');
root.getBoundingClientRect=()=>({left:10,top:10,width:80,height:80});api.positionBubble();
assert.equal(bubble.dataset.placement,'right');assert.ok(10+parseFloat(bubble.style.left)>=100);
root.getBoundingClientRect=()=>({left:10,top:10,width:303,height:303});api.positionBubble();
assert.equal(bubble.dataset.placement,'below');assert.ok(10+parseFloat(bubble.style.top)>=323,'fallback clears whole body');
root.getBoundingClientRect=()=>({left:170,top:550,width:202,height:202});api.positionBubble();assert.equal(bubble.dataset.placement,'above');
world.window.visualViewport={offsetLeft:0,offsetTop:100,width:390,height:600};
root.getBoundingClientRect=()=>({left:292,top:110,width:80,height:80});api.positionBubble();assert.equal(bubble.dataset.placement,'left');assert.ok(110+parseFloat(bubble.style.top)>=108);
console.log('PASS: top-left/right side placement, full-body fallback, ordinary above placement and visual viewport offsets.');

// Keyboard pan: layout viewport coordinates and client coordinates may differ.
world.window.visualViewport={offsetLeft:0,offsetTop:220,width:390,height:410};
root.style.left='270px';root.style.top='400px';
root.getBoundingClientRect=()=>({left:270,top:180,width:80,height:80});
api.positionBubble();assert.equal(bubble.dataset.placement,'above','keyboard origin correction prevents a false top-edge fallback');
assert.ok(180+parseFloat(bubble.style.top)+bubble.offsetHeight<200,'typing bubble stays next to pet rather than keyboard');
assert.equal(api.bubbleViewportBox(root.getBoundingClientRect()).top,0);
// Chromium/layout-origin behavior must still retain the visual viewport offset.
root.getBoundingClientRect=()=>({left:270,top:400,width:80,height:80});
assert.equal(api.bubbleViewportBox(root.getBoundingClientRect()).top,220);
// Late keyboard geometry changes without a resize event are followed while visible.
settings.companionMode='daily';api.showBubble('typing follow',5000,true);
const oldTop=bubble.style.top;
root.getBoundingClientRect=()=>({left:270,top:180,width:80,height:80});
world.window.visualViewport.offsetTop=180;
advance(100);assert.notEqual(bubble.style.top,oldTop,'visible bubble follows late keyboard pan');
advance(5000);assert.ok(!classes.has('is-visible'));
const hiddenTop=bubble.style.top;root.getBoundingClientRect=()=>({left:270,top:50,width:80,height:80});advance(200);assert.equal(bubble.style.top,hiddenTop,'follow stops on dismissal');
console.log('PASS: keyboard client/layout origin correction, late viewport pan and follow timer cleanup.');
