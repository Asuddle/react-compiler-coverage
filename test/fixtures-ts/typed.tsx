import { useState } from 'react';

interface Props { title: string; }

// TS component with type syntax — must be parsed, not silently dropped
export function TypedHeader({ title }: Props) {
  const upper: string = title.toUpperCase();
  return <h1>{upper}</h1>;
}
