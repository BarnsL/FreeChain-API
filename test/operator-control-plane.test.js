// Installed as test/operator-control-plane.test.js by the patcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChainOperatorRuntime, operatorSystemPrompt } from '../src/operator-runtime.js';
import { stripHumanOnlyLogFlags, HUMAN_ONLY_LOG_FLAGS } from '../src/operator-freechain.js';

test('operator model proposals are inert until a separate confirmation', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'freechain-operator-')); let applied=0;
  try {
    const runtime=new ChainOperatorRuntime({root,prefix:'FREECHAIN_TEST',appName:'FreeChainTest',specialization:'test',allowedTools:['set_ui'],getContext:async()=>({providerHelp:[]}),executeAction:async()=>{applied++;return{ok:true};},selfComplete:async()=>JSON.stringify({message:'proposal',actions:[{tool:'set_ui',args:{theme:'light'},reason:'test',description:'Light theme'}],links:[]}),systemPrompt:operatorSystemPrompt('FreeChainTest','test',['set_ui'])});
    const reply=await runtime.chat('light'); assert.equal(applied,0); assert.equal(reply.pending.length,1);
    await runtime.confirm(reply.pending[0].id); assert.equal(applied,1);
    await assert.rejects(()=>runtime.confirm(reply.pending[0].id));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('the operator model cannot enable raw retention, even through a confirmed action', () => {
  // The model proposes a plausible-looking log-policy change that also flips
  // every content-capture switch. Confirming it must apply the harmless parts
  // and silently drop the rest.
  const proposed = {
    promptSummary: true,
    maxSummaryChars: 400,
    rawPrompts: true,
    rawResponses: true,
    rawToolBodies: true,
    credentials: true,
  };
  const applied = stripHumanOnlyLogFlags(proposed);

  assert.deepEqual(applied, { promptSummary: true, maxSummaryChars: 400 });
  for (const flag of HUMAN_ONLY_LOG_FLAGS) {
    assert.equal(flag in applied, false, `${flag} must never survive a model proposal`);
  }
  // The guard must not invent keys for a proposal that set none of them.
  assert.deepEqual(stripHumanOnlyLogFlags({ promptSummary: false }), { promptSummary: false });
  assert.deepEqual(stripHumanOnlyLogFlags(), {});
});
