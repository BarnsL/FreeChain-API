// FreeChain-specific host for the shared confirmation-gated control plane.
// FreeChain's specialization is ordinary OpenAI-compatible provider/key
// failover. Subscription/OAuth transports remain SubChain's responsibility.
import fs from 'node:fs';
import path from 'node:path';
import { ChainOperatorRuntime, operatorSystemPrompt } from './operator-runtime.js';
import { FAMILIES, providerDef } from './providers.js';
import { ROOT, chainStatus, saveChainConfig } from './config.js';
import { saveSlotKeys, updateChainSettings } from './admin.js';
import { analyzeSanitizedRecords } from './operator-security.js';
import { applyMinorRepair } from './operator-repair.js';

const HELP = {
  openrouter: ['api-key','OpenRouter','https://openrouter.ai/settings/keys'],
  'opencode-zen': ['api-key','OpenCode Zen','https://opencode.ai/auth'],
  longcat: ['api-key','LongCat','https://longcat.chat/'],
  groq: ['api-key','Groq','https://console.groq.com/keys'],
  cerebras: ['api-key','Cerebras','https://cloud.cerebras.ai/'],
  nvidia: ['api-key','NVIDIA NIM','https://build.nvidia.com/'],
  deepseek: ['api-key','DeepSeek','https://platform.deepseek.com/api_keys'],
  google: ['api-key','Google Gemini','https://aistudio.google.com/app/apikey'],
  openai: ['api-key','OpenAI API','https://platform.openai.com/api-keys'],
  omniroute: ['local','OmniRoute','https://omniroute.online/'],
  local: ['local','Local OpenAI-compatible',null],
};

/**
 * Log-policy switches the operator model may never set, even with a human
 * pressing Confirm.
 *
 * The system prompt already tells the model not to propose raw retention, but
 * instruction is not enforcement. A confirmation dialog summarised as "adjust
 * log policy" must not be able to quietly start writing prompts, responses or
 * bearer tokens to disk — the human has to reach for those switches on the
 * Settings tab themselves, where the warnings are.
 */
export const HUMAN_ONLY_LOG_FLAGS = ['rawPrompts', 'rawResponses', 'rawToolBodies', 'credentials'];

export function stripHumanOnlyLogFlags(args = {}) {
  const out = { ...args };
  for (const flag of HUMAN_ONLY_LOG_FLAGS) delete out[flag];
  return out;
}

const family = id => String(id).replace(/\d+$/,'');
const readEnvMap = file => {
  const out=new Map(); try { for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(m&&m[2])out.set(m[1],m[2].replace(/^['"]|['"]$/g,''));} } catch{} return out;
};
const approvedCredential = providerId => {
  const def=providerDef(providerId); const local=readEnvMap(path.join(ROOT,'.env'));
  for(const name of def.keyEnv||[]) if(process.env[name]?.trim()) return {value:process.env[name].trim(),source:'environment'};
  for(const name of def.keyEnv||[]) if(local.get(name)?.trim()) return {value:local.get(name).trim(),source:'freechain-env-file'};
  const dir=process.env.FREECHAIN_CREDENTIALS_DIR?.trim();
  if(dir){for(const n of [`${providerId}-api-key.txt`,`${family(providerId)}-api-key.txt`]){try{const v=fs.readFileSync(path.join(dir,n),'utf8').trim();if(v)return{value:v,source:'approved-credential-directory'};}catch{}}}
  return null;
};

function writeEnv(name,value){
  const file=path.join(ROOT,'.env'); const lines=fs.existsSync(file)?fs.readFileSync(file,'utf8').split(/\r?\n/):[]; let found=false;
  const next=lines.map(line=>line.startsWith(`${name}=`)?(found=true,`${name}=${value}`):line); if(!found)next.push(`${name}=${value}`);
  const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,next.filter(Boolean).join('\n')+'\n',{mode:0o600});fs.renameSync(tmp,file);process.env[name]=String(value);
}

function providerContext(){
  return FAMILIES.map(id=>{const def=providerDef(id);const found=def.keyOptional||Boolean(approvedCredential(id));const h=HELP[id]||['unknown',def.label,null];return{provider:id,label:def.label,authType:h[0],found,sources:found?(def.keyOptional?['no-key-required']:['approved-source']):[],url:h[2]};});
}

// Failover-specific health, so the chat can RCA a "chain exhausted" incident
// from sanitized journal data alone. A terminal failure is a request that
// walked the whole chain and still got nothing (chain_failed / HTTP 502). A
// fatal 4xx at the head link is the shape behind the 2026-08-18 incident: a
// provider wrapped a server-side error in a 400 and the chain stopped. With
// advanceOnWrappedServerErrors on that pattern is caught upstream and advances;
// off, it is terminal, so we flag the switch explicitly.
export function failoverDoctor(chain,recent){
  const s=chain.settings||{};const advancing=s.advanceOnWrappedServerErrors!==false;
  const terminal=recent.filter(r=>r.error?.code==='chain_failed'||Number(r.status)===502);
  const fatal4xx=terminal.filter(r=>(r.attempts||[]).some(a=>a.outcome==='fatal'&&(a.providerStatus===400||a.providerStatus===422)));
  const rate=recent.length?terminal.length/recent.length:0;
  let status='ok',message,recommendation;
  if(!advancing){status='warn';message='Wrapped-error failover is OFF: a provider that returns a 5xx inside a 400/422 body will end the whole chain instead of advancing.';recommendation='Re-enable "advance on wrapped upstream errors" on the Chain page unless you are deliberately debugging an over-matching provider.';}
  else if(terminal.length){status=rate>0.2?'warn':'ok';message=`${terminal.length}/${recent.length} recent retained requests exhausted the chain (502)${fatal4xx.length?`; ${fatal4xx.length} ended on a fatal 4xx at a head link`:''}.`;recommendation=fatal4xx.length?'A fatal 4xx is treated as a genuine client error and stops the chain. If it is really a wrapped upstream failure, confirm the head provider and reorder the chain so a flakier provider is not tried first.':'Open Logs to find the dominant failing provider, then raise its cooldown, add an account slot, or reorder the chain.';}
  else{message=`No terminal chain exhaustion in the last ${recent.length} retained requests.`;recommendation='Failover is advancing across providers as configured.';}
  return{id:'failover',status,message,recommendation,settings:{requestTimeoutMs:s.requestTimeoutMs,cooldownMs:s.cooldownMs,maxAttempts:s.maxAttempts,advanceOnWrappedServerErrors:advancing}};
}

function doctor(chain,journal){
  const links=chainStatus(chain);const recent=journal.query({limit:100}).items;const failed=recent.filter(r=>Number(r.status)>=500).length;const checks=[];
  checks.push({id:'chain',status:links.some(l=>l.hasKey)?'ok':'error',message:`${links.filter(l=>l.hasKey).length}/${links.length} chain links have usable credentials.`,recommendation:'Configure at least one provider and live-test it before relying on auto routing.'});
  checks.push({id:'failures',status:recent.length&&failed/recent.length>.3?'warn':'ok',message:`${failed}/${recent.length} recent retained requests are server-side failures.`,recommendation:'Use Logs/Security to identify the dominant provider or error class.'});
  checks.push(failoverDoctor(chain,recent));
  checks.push({id:'bind',status:(process.env.FREECHAIN_HOST||'127.0.0.1').match(/^(127\.0\.0\.1|localhost|::1)$/)?'ok':'warn',message:`Configured bind host: ${process.env.FREECHAIN_HOST||'127.0.0.1'}.`,recommendation:'Keep the dashboard/operator on loopback unless a trusted reverse proxy and firewall are intentional.'});
  return{generatedAt:new Date().toISOString(),checks};
}

function normalizeLink(chain,args){
  const provider=String(args.provider||'').trim();const model=String(args.model||'').trim();if(!provider||!model)throw Object.assign(new Error('provider and model are required.'),{statusCode:400});
  const def=providerDef(provider);return{provider,label:def.label,model,baseUrl:String(args.baseUrl||def.baseUrl||'').replace(/\/+$/,''),headers:def.headers||{},keyOptional:Boolean(def.keyOptional),free:args.free!==false,note:args.note?String(args.note).slice(0,300):null,index:chain.links.length};
}
function reindex(chain){chain.links.forEach((l,i)=>{l.index=i;});}

export function createFreeChainOperator({chain,journal,cooldowns,configFile,selfComplete}){
  let runtime;
  const allowed=['set_ui','set_port','move_chain_link','add_chain_link','remove_chain_link','update_chain_link','set_failover_settings','set_log_policy','import_detected_credential','minor_code_replace','clear_logs'];
  const getContext=async()=>{
    const logs=journal.query({limit:100});const providers=providerContext();return{
      appName:'FreeChain',specialization:'General OpenAI-compatible LLM failover across API-key and local providers.',
      chain:chain.links.map(l=>({index:l.index,provider:l.provider,model:l.model,free:l.free,note:l.note})),
      providerHelp:providers,doctor:doctor(chain,journal),security:analyzeSanitizedRecords(logs.items),recentLogs:logs.items.slice(0,30),
      settings:runtime.readSettings(),cooling:cooldowns.snapshot(),
      // The live failover knobs, so the chat can both diagnose and (via
      // set_failover_settings) tune timeout/cooldown/candidate cap and the
      // wrapped-upstream-error switch behind the 2026-08-18 incident.
      failover:{requestTimeoutMs:chain.settings.requestTimeoutMs,cooldownMs:chain.settings.cooldownMs,maxAttempts:chain.settings.maxAttempts,advanceOnWrappedServerErrors:chain.settings.advanceOnWrappedServerErrors!==false},
      mutationBoundary:'All model-proposed mutations require a separate confirmation request. Minor code repair is exact-replacement only with tests and rollback.'
    };
  };
  const executeAction=async action=>{
    const a=action.args||{};
    if(action.tool==='set_ui')return runtime.saveSettings({ui:a});
    if(action.tool==='set_log_policy')return runtime.saveSettings({logs:stripHumanOnlyLogFlags(a)});
    if(action.tool==='set_port'){const p=Number(a.port);if(!Number.isInteger(p)||p<1024||p>65535)throw Object.assign(new Error('Port must be 1024-65535.'),{statusCode:400});writeEnv('FREECHAIN_PORT',p);return{ok:true,port:p,restartRequired:true};}
    if(action.tool==='move_chain_link'){const from=Number(a.from),to=Number(a.to);if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=chain.links.length||to>=chain.links.length)throw Object.assign(new Error('Invalid chain indexes.'),{statusCode:400});const [m]=chain.links.splice(from,1);chain.links.splice(to,0,m);reindex(chain);saveChainConfig(chain,configFile);return{ok:true};}
    if(action.tool==='set_failover_settings'){const s=updateChainSettings(chain,a,configFile);if(cooldowns&&typeof s.cooldownMs==='number')cooldowns.cooldownMs=s.cooldownMs;return{ok:true,settings:{requestTimeoutMs:s.requestTimeoutMs,cooldownMs:s.cooldownMs,maxAttempts:s.maxAttempts,advanceOnWrappedServerErrors:s.advanceOnWrappedServerErrors!==false}};}
    if(action.tool==='add_chain_link'){chain.links.push(normalizeLink(chain,a));reindex(chain);saveChainConfig(chain,configFile);return{ok:true,count:chain.links.length};}
    if(action.tool==='remove_chain_link'){const i=Number(a.index);if(chain.links.length<=1)throw Object.assign(new Error('The final chain link cannot be removed.'),{statusCode:409});if(!Number.isInteger(i)||i<0||i>=chain.links.length)throw Object.assign(new Error('Invalid chain index.'),{statusCode:400});chain.links.splice(i,1);reindex(chain);saveChainConfig(chain,configFile);return{ok:true,count:chain.links.length};}
    if(action.tool==='update_chain_link'){const i=Number(a.index);if(!Number.isInteger(i)||i<0||i>=chain.links.length)throw Object.assign(new Error('Invalid chain index.'),{statusCode:400});const current=chain.links[i];const next=normalizeLink({links:Array(i)}, {...current,...a});next.index=i;chain.links[i]=next;reindex(chain);saveChainConfig(chain,configFile);return{ok:true};}
    if(action.tool==='import_detected_credential'){const slot=String(a.provider||'').trim();providerDef(slot);const found=approvedCredential(slot)||approvedCredential(family(slot));if(!found)throw Object.assign(new Error('No approved credential source was detected for that provider.'),{statusCode:409});saveSlotKeys(slot,[found.value]);return{ok:true,provider:slot,source:found.source};}
    if(action.tool==='clear_logs'){if(typeof journal.clear!=='function')throw Object.assign(new Error('Journal clear support is unavailable in this build.'),{statusCode:409});return journal.clear();}
    if(action.tool==='minor_code_replace')return applyMinorRepair({root:ROOT,file:a.file,search:a.search,replace:a.replace,allowFiles:['src/webui/app.css','src/webui/app.js','src/webui/index.html','src/webui/operator.js','src/operator-freechain.js']});
    throw Object.assign(new Error('Unsupported confirmed action.'),{statusCode:400});
  };
  runtime=new ChainOperatorRuntime({root:ROOT,prefix:'FREECHAIN',appName:'FreeChain',specialization:'general LLM failover',allowedTools:allowed,getContext,executeAction,selfComplete,systemPrompt:operatorSystemPrompt('FreeChain','General OpenAI-compatible LLM failover. Provider keys belong here; managed subscription/OAuth routing belongs in SubChain.',allowed)+`\nFREECHAIN TOOL ARGUMENT CONTRACT (follow literally):\n- set_ui: {theme: dark|light|system, fontFamily: system|sans|serif|mono, fontScale: 0.8..1.4, density: compact|comfortable|spacious}. Propose only fields the user asked to change.\n- set_port: {port: integer 1024..65535}. Explain that restart is required.\n- move_chain_link: {from: current zero-based index, to: desired zero-based index}. Never guess indexes; read current chain context.\n- add_chain_link: {provider: known provider id, model: exact model id, optional baseUrl, optional free, optional note}. Prefer provider defaults; do not invent private URLs.\n- remove_chain_link: {index: zero-based index}. Never remove the final link.\n- update_chain_link: {index, and one or more of provider, model, baseUrl, free, note}. Preserve unspecified values.\n- set_failover_settings: {requestTimeoutMs?: 1000..600000, cooldownMs?: 0..3600000, maxAttempts?: integer 1..1000 or null for every candidate, advanceOnWrappedServerErrors?: boolean}. Tunes provider failover; applies live, no restart. Propose only the fields the user asked to change. Explain that a lower timeout fails slow providers faster, a longer cooldown rests a rate-limited account, and that turning advanceOnWrappedServerErrors off makes ANY 400/422 end the chain (the 2026-08-18 incident). Diagnose from context.doctor.failover and context.failover first.\n- set_log_policy: {promptSummary: boolean, maxSummaryChars: 80..600, maxContextItems: 1..6}. Never propose raw prompt or response retention.\n- import_detected_credential: {provider: exact provider/slot id}. Use only when context says an approved credential source exists. The secret is reread server-side after confirmation; never ask the user to reveal it.\n- clear_logs: {}. Destructive; explain retained operational history will be deleted.\n- minor_code_replace: {file, search, replace}. LAST RESORT only. File must be in the repair allowlist; exact search must match once; keep changes small and UI/non-security focused.\nPROCEDURE: (1) inspect doctor/security/recentLogs/current chain, (2) explain diagnosis, (3) prefer zero-change advice, (4) if change is needed emit the smallest action, (5) say confirmation is required, (6) after a confirmed result re-check state before proposing a second mutation. FreeChain has one ordered chain; modify links rather than pretending it has SubChain-style multiple chain objects.`});
  const saveProviderKey = (provider, key) => { const id=String(provider||'').trim(); const value=String(key||'').trim(); providerDef(id); if(!value||/\r|\n/.test(value)) throw Object.assign(new Error('A provider key is required.'),{statusCode:400}); saveSlotKeys(id,[value]); return {ok:true,provider:id}; };
  return {runtime,getContext,security:()=>analyzeSanitizedRecords(journal.query({limit:500}).items),doctor:()=>doctor(chain,journal),logs:q=>journal.query(q),saveProviderKey};
}
