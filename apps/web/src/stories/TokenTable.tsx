import type { ReactNode } from 'react';

export interface TokenRow {
  name: string;
  cells: ReactNode[];
}

/** Plain token table for the Foundations pages. */
export function TokenTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: TokenRow[];
}) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="pb-2 text-left text-lg font-medium text-fg">{caption}</caption>
      <thead>
        <tr className="border-b border-line-strong">
          {columns.map((column) => (
            <th key={column} scope="col" className="py-2 pr-4 font-medium text-fg-muted">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name} className="border-b border-line align-middle">
            {row.cells.map((cell, index) => (
              <td key={index} className="py-2 pr-4 text-fg">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-sm bg-bg-sunken px-1 font-mono text-xs text-fg">{children}</code>;
}

/** Story canvas for a Foundations page. */
export function Page({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex max-w-4xl flex-col gap-8 p-6 text-fg">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-fg-muted">{intro}</p>
      </header>
      {children}
    </main>
  );
}
