import type { Db } from "../db/types";
import type { Config } from "../config";
import { dealWhere, type Filters } from "./filters";

export const NOT_INFORMED = "Não informado";
export const NO_FORM = "Sem formulário";

/** Form-answer distributions per question, split by form so languages/currencies never mix (FR-020..023). */
export async function getProfile(db: Db, cfg: Config, f: Filters) {
  const w = dealWhere(f, "d", { period: true, cross: true });
  const questions = [];
  for (const q of cfg.profileFields) {
    const path = `$."${q.key.replaceAll('"', "")}"`;
    const source = q.entity === "contact" ? "ct.fields_json" : "d.fields_json";
    const { results } = await db
      .prepare(
        `SELECT COALESCE(d.form_name, ?) AS form,
                COALESCE(NULLIF(TRIM(CAST(json_extract(${source}, ?) AS TEXT)), ''), ?) AS value,
                COUNT(*) AS count
         FROM deals d LEFT JOIN contacts ct ON ct.id = d.contact_id
         WHERE ${w.sql}
         GROUP BY 1, 2 ORDER BY 1, count DESC`,
      )
      .bind(NO_FORM, path, NOT_INFORMED, ...w.params)
      .all<{ form: string; value: string; count: number }>();
    const byForm = new Map<string, { value: string; count: number }[]>();
    for (const r of results) {
      if (!byForm.has(r.form)) byForm.set(r.form, []);
      byForm.get(r.form)!.push({ value: r.value, count: r.count });
    }
    const by_form = [...byForm.entries()]
      .map(([form, answers]) => ({ form, total: answers.reduce((s, a) => s + a.count, 0), answers }))
      .sort((a, b) => b.total - a.total);
    questions.push({ key: q.key, label: q.label, by_form });
  }
  return { questions };
}
