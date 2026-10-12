import { POLYGON_MAX_VERTICES } from '@cgis/shared';

export default function App() {
  return (
    <main>
      <h1>Collaborative GIS</h1>
      <p>Polygons may have up to {POLYGON_MAX_VERTICES} vertices.</p>
    </main>
  );
}
