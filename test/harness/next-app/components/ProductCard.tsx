'use client';

type Item = { id: number; name: string; tag: string };

export function ProductCard({ items, filter }: { items: Item[]; filter: string }) {
  const visible = items.filter((i) => i.tag === filter);
  return (
    <div>
      {visible.map((i) => (
        <div key={i.id}>{i.name}</div>
      ))}
    </div>
  );
}
