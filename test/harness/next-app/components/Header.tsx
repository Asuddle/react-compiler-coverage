export function Header({ title }: { title: string }) {
  const upper = title.toUpperCase();
  return <h1>{upper}</h1>;
}
