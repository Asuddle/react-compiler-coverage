import * as babel from '@babel/core';
import assert from 'node:assert/strict';
import { triageComponent } from '../dist/triage.js';

const samples = {
  optimized: {
    code: `export function C({a,b}){ const t=a.reduce((s,n)=>s+n,0)*b; return <section><span>{t}</span></section>; }`,
    expect: 'optimized',
  },
  wontBenefit: {
    code: `export function C({items,filter}){ const v=items.filter(i=>i.tag===filter); const on=id=>console.log(id); return v.map(i=><div key={i.id} onClick={()=>on(i.id)}>{i.name}</div>); }`,
    expect: 'wont-benefit',
  },
  fixableHooks: {
    code: `export function C({on}){ if(on){ const [x]=useState(0); return <p>{x}</p>; } return <p/>; }`,
    expect: 'fixable-bail',
    cat: 'Hooks',
  },
  fixableRefs: {
    code: `export function C({x}){ const r=useRef(0); r.current=x; return <div>{r.current}</div>; }`,
    expect: 'fixable-bail',
    cat: 'Refs',
  },
  fixableImmut: {
    code: `export function C({o}){ delete o.k; return <div>{Object.keys(o).length}</div>; }`,
    expect: 'fixable-bail',
    cat: 'Immutability',
  },
};

const collect = (code, name) => {
  const events = [];
  babel.transformSync(code, {
    filename: `${name}.jsx`,
    presets: [['@babel/preset-react', { runtime: 'automatic' }]],
    plugins: [['babel-plugin-react-compiler', { logger: { logEvent: (_f, e) => events.push(e) } }]],
  });
  return events;
};

let pass = 0;
console.log('SAMPLE'.padEnd(14), 'STATUS'.padEnd(14), 'CATEGORY');
console.log('-'.repeat(50));
for (const [name, { code, expect, cat }] of Object.entries(samples)) {
  const events = collect(code, name);
  const nLines = code.split('\n').length;
  const info = triageComponent({ startLine: 1, endLine: nLines }, events);
  console.log(name.padEnd(14), info.triageStatus.padEnd(14), info.category ?? '');
  assert.equal(info.triageStatus, expect, `${name}: status`);
  if (cat) assert.equal(info.category, cat, `${name}: category`);
  assert.equal(info.unknownCategory, undefined, `${name}: no unknown-category false alarm`);
  pass++;
}

const fake = [
  { kind: 'CompileError', fnLoc: { start: { line: 1 } }, detail: { category: 'MadeUpXYZ', reason: 'test' } },
];
const g = triageComponent({ startLine: 1, endLine: 1 }, fake);
assert.equal(g.triageStatus, 'fixable-bail');
assert.equal(g.unknownCategory, true, 'guard should trip on unknown category');
console.log('guard          fixable-bail   MadeUpXYZ  (unknownCategory=true ✓)');
pass++;

const todo = [{ kind: 'CompileError', fnLoc: { start: { line: 1 } }, detail: { category: 'Todo', reason: 'x' } }];
assert.equal(triageComponent({ startLine: 1, endLine: 1 }, todo).triageStatus, 'unsupported', 'Todo routes to unsupported');
console.log('limitation     unsupported    Todo  (routed off fixable-bail ✓)');
pass++;

console.log('\nALL', pass, 'CHECKS PASS');
