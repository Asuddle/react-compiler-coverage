import { useState } from 'react';

// 1) Compiler emits no event for this one — enumerated but 'silent'.
export function ProductCard({ items, filter }) {
  const visible = items.filter((i) => i.tag === filter);
  const onClick = (id) => console.log(id);
  return visible.map((i) => <div key={i.id} onClick={() => onClick(i.id)}>{i.name}</div>);
}

// 2) Explicit opt-out — compiler SHOULD skip (CompileSkip)
export function LegacyWidget({ value }) {
  'use no memo';
  const doubled = value * 2;
  return <span>{doubled}</span>;
}

// 3) Rule-of-hooks violation — compiler SHOULD error (CompileError)
export function BrokenComponent({ enabled }) {
  if (enabled) {
    const [count] = useState(0);
    return <p>{count}</p>;
  }
  return <p>disabled</p>;
}

// 4) Clean component the compiler optimizes (CompileSuccess)
export function Header({ title }) {
  const upper = title.toUpperCase();
  return <h1>{upper}</h1>;
}
