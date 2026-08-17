import { Header } from '../components/Header';
import { ProductCard } from '../components/ProductCard';

export default function Page() {
  return (
    <main>
      <Header title="Harness" />
      <ProductCard items={[{ id: 1, name: 'A', tag: 'x' }]} filter="x" />
    </main>
  );
}
