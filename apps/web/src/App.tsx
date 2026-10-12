import { POLYGON_MAX_VERTICES } from '@cgis/shared';

export default function App() {
  return (
    <main className="graticule grid h-full place-items-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <svg aria-hidden="true" viewBox="0 0 32 32" className="fill-signal size-10">
          <path d="M6 9 19 4l8 11-6 13L7 22Z" />
        </svg>
        <h1 className="font-display text-5xl tracking-tight text-balance sm:text-6xl">
          Collaborative GIS
        </h1>
        <p className="text-ink-muted font-mono text-sm">
          Polygons may have up to {POLYGON_MAX_VERTICES} vertices.
        </p>
      </div>
    </main>
  );
}
