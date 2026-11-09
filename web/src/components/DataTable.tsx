import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

export interface Column<T> {
  key: string;
  label: string;
  num?: boolean;
  sortValue?: (row: T) => number | string;
  render: (row: T) => ComponentChildren;
}

/** Sortable table; rows are clickable when `onRow` is given. */
export function DataTable<T>(props: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  initialSort?: { key: string; dir: "asc" | "desc" };
  sortable?: boolean;
  /** Cap the height and scroll inside the card (long lists). */
  scroll?: boolean;
}) {
  const [sort, setSort] = useState(props.initialSort ?? null);
  let rows = props.rows;
  const col = sort && props.columns.find((c) => c.key === sort.key);
  if (props.sortable !== false && col?.sortValue) {
    const sv = col.sortValue;
    rows = [...rows].sort((a, b) => {
      const x = sv(a);
      const y = sv(b);
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR");
      return sort!.dir === "asc" ? r : -r;
    });
  }
  const toggle = (c: Column<T>) => {
    if (!c.sortValue || props.sortable === false) return;
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.num ? "desc" : "asc" }));
  };
  return (
    <div class={`table-wrap ${props.scroll ? "scroll" : ""}`}>
      <table>
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th class={`${c.num ? "num" : ""} ${c.sortValue && props.sortable !== false ? "sortable" : ""}`} onClick={() => toggle(c)}>
                {c.label}
                {sort?.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={props.rowKey(r)} class={props.onRow ? "clickable" : ""} onClick={() => props.onRow?.(r)}>
              {props.columns.map((c) => (
                <td class={c.num ? "num" : ""}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
