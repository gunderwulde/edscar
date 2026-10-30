/** Composición de los paneles en los slots de <App>: izquierda, derecha, inferior y barra de avisos. */
import { useEffect, useState } from "react";
import { useEditorStore } from "../store";
import type { SolverClient } from "../worker/client";
import { AssignPanel } from "./AssignPanel";
import { CasesPanel } from "./CasesPanel";
import { DataTable } from "./DataTable";
import { useT } from "./i18n";
import { MaterialsPanel } from "./MaterialsPanel";
import { ProjectTree, type LeftTab } from "./ProjectTree";
import { PropertiesPanel } from "./PropertiesPanel";
import { ResultsPanel } from "./ResultsPanel";
import { DEFAULT_EXAMPLE_ID, isEmptyProject, loadExample, parseExampleParam } from "./startup";
import { CollapsiblePanel, Section, Tabs } from "./ui";
import { useChecks, ValidationPanel } from "./ValidationPanel";
import { useFit } from "./fitContext";

export function LeftPanel() {
  const t = useT();
  const [tab, setTab] = useState<LeftTab>("model");
  return (
    <CollapsiblePanel title={t("left.title")} side="left">
      <Tabs
        ariaLabel={t("left.title")}
        active={tab}
        onChange={(id) => { setTab(id as LeftTab); }}
        tabs={[{ id: "model", label: t("left.model") }, { id: "cases", label: t("left.cases") }, { id: "materials", label: t("left.materials") }]}
      >
        {tab === "model" && <ProjectTree onNavigate={setTab} />}
        {tab === "cases" && <CasesPanel />}
        {tab === "materials" && <MaterialsPanel />}
      </Tabs>
    </CollapsiblePanel>
  );
}

export function RightPanel() {
  const t = useT();
  return (
    <CollapsiblePanel title={t("right.title")} side="right">
      <PropertiesPanel />
      <Section title={t("assign.title")}>
        <AssignPanel />
      </Section>
    </CollapsiblePanel>
  );
}

type BottomTab = "table" | "results" | "checks";

export function BottomPanel({ solver }: { solver?: SolverClient | undefined }) {
  const t = useT();
  const [tab, setTab] = useState<BottomTab>("table");
  const checks = useChecks();
  const problems = checks.filter((c) => c.severity !== "info").length;
  return (
    <CollapsiblePanel title={t("bottom.title")} side="bottom">
      <Tabs
        ariaLabel={t("bottom.title")}
        active={tab}
        onChange={(id) => { setTab(id as BottomTab); }}
        tabs={[
          { id: "table", label: t("bottom.table") },
          { id: "results", label: t("bottom.results") },
          { id: "checks", label: t("bottom.checks"), badge: problems },
        ]}
      >
        {tab === "table" && <DataTable />}
        {tab === "results" && <ResultsPanel solver={solver} />}
        {tab === "checks" && <ValidationPanel />}
      </Tabs>
    </CollapsiblePanel>
  );
}

/** Aviso permanente: herramienta de apoyo y datos normativos no verificados. */
export function NoticeBar() {
  const t = useT();
  const checks = useChecks();
  const problems = checks.filter((c) => c.severity === "error").length;
  return (
    <div className="pn-notice" role="note">
      <span>{t("notice.disclaimer")}</span>
      <span className="pn-tag pn-tag-warn" title={t("notice.unverifiedHint")}>{t("notice.unverified")}</span>
      {problems > 0 && <span className="pn-tag pn-tag-bad" role="status">{t("notice.problems", { n: problems })}</span>}
    </div>
  );
}

const started = new WeakSet();

/**
 * Arranque: con `?example=<id>` carga SIEMPRE ese ejemplo (aunque haya borrador, que no se toca hasta que el usuario
 * edite); sin él, si no había borrador (proyecto vacío) carga el pórtico de 2 plantas. Encuadra al terminar; el
 * cálculo del caso por defecto (primer caso, CG) lo lanza el controlador al cambiar el proyecto.
 */
export function Startup({ search, defaultExample = true }: { search: string; defaultExample?: boolean }) {
  const store = useEditorStore();
  const fit = useFit();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.has(store)) return;
    started.add(store);
    const requested = parseExampleParam(search);
    const id = requested ?? (defaultExample && isEmptyProject(store) ? DEFAULT_EXAMPLE_ID : null);
    if (id === null) return;
    void loadExample(store, id).then((r) => {
      if (r.ok) fit();
      else setError(t("file.exampleFailed", { reason: r.message }));
    });
  }, [store, search, defaultExample, fit, t]);
  return error ? <span role="alert" className="pn-msg pn-msg-error">{error}</span> : null;
}
