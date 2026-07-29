"use client";

import { useRouter } from "next/navigation";

/**
 * Quantidade por página. É menu, não chips: em linha com os números das
 * páginas, os chips eram lidos como se fossem páginas.
 */
export default function PerPageSelect({
  options,
  value,
  hrefFor,
}: {
  options: readonly number[];
  value: number;
  /** URL já montada pelo servidor para cada opção, preservando os filtros. */
  hrefFor: Record<number, string>;
}) {
  const router = useRouter();

  return (
    <label className="pager-per">
      <span className="pager-label">Por página</span>
      <select
        value={value}
        onChange={(e) => router.push(hrefFor[Number(e.target.value)])}
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
