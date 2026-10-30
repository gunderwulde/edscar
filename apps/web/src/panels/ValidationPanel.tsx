/** Validación en vivo: avisos del modelo con mensajes claros y acceso directo a los elementos implicados. */
import { useMemo } from "react";
import { useEditorSelector, useEditorStore } from "../store";
import { useT, type MessageKey } from "./i18n";
import { liveChecks, type Check } from "./validation";

export function useChecks(): Check[] {
  const project = useEditorSelector((s) => s.project);
  return useMemo(() => liveChecks(project), [project]);
}

const SEVERITY_KEY: Record<Check["severity"], MessageKey> = { error: "check.sev.error", warning: "check.sev.warning", info: "check.sev.info" };

export function ValidationPanel() {
  const t = useT();
  const store = useEditorStore();
  const checks = useChecks();
  const lastErrors = useEditorSelector((s) => s.lastErrors);
  return (
    <div className="pn-validation">
      {lastErrors && (
        <div role="alert" className="pn-error pn-error-line">
          <b>{t("check.rejected")}</b>
          <ul>
            {lastErrors.map((e, k) => <li key={k}>{e.path ? `${e.path}: ` : ""}{e.message}</li>)}
          </ul>
          <button type="button" onClick={() => { store.clearErrors(); }}>{t("common.dismiss")}</button>
        </div>
      )}
      {checks.length === 0 ? (
        <p className="pn-ok" role="status">{t("check.allGood")}</p>
      ) : (
        <ul className="pn-checks" aria-label={t("check.title")}>
          {checks.map((c) => (
            <li key={c.id} className={`pn-check-item pn-sev-${c.severity}`}>
              <span className="pn-tag">{t(SEVERITY_KEY[c.severity])}</span> {t(`check.${c.code}` as MessageKey, c.params)}
              {c.select && (
                <button type="button" className="pn-link" onClick={() => { store.select({ nodes: c.select?.nodes ?? [], members: c.select?.members ?? [] }); }}>
                  {t("check.select")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
