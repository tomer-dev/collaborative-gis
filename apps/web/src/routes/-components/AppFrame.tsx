import type { ReactNode } from 'react';

type AppFrameProps = {
  /** Right side of the top bar; the `_authed` layout puts the user chip here. */
  headerEnd?: ReactNode;
  children: ReactNode;
};

/** Top bar with the app name, then a full-height main. Each layout route picks its header content. */
export function AppFrame({ headerEnd, children }: AppFrameProps) {
  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-2">
        <h1 className="text-lg font-semibold">Collaborative GIS</h1>
        {headerEnd}
      </header>
      <main className="relative min-h-0 flex-1">{children}</main>
    </>
  );
}
