/** Ayuda de atajos y aviso de uso. */
import { useT, type MessageKey } from "./i18n";
import { Dialog } from "./ui";

const SHORTCUTS: { keys: string; action: MessageKey }[] = [
  { keys: "Ctrl+S", action: "help.save" },
  { keys: "Ctrl+O", action: "help.open" },
  { keys: "Ctrl+Z / Ctrl+Y", action: "help.undoRedo" },
  { keys: "V · N · B · S", action: "help.tools" },
  { keys: "F", action: "help.fit" },
  { keys: "Supr / Del", action: "help.delete" },
  { keys: "Ctrl+A", action: "help.selectAll" },
  { keys: "Mayús/Ctrl + clic", action: "help.multiSelect" },
  { keys: "Rueda · Espacio+arrastrar", action: "help.zoomPan" },
  { keys: "Esc", action: "help.escape" },
  { keys: "Alt+1 … Alt+4", action: "help.regions" },
  { keys: "? / F1", action: "help.thisHelp" },
  { keys: "Enter · ↑ ↓", action: "help.table" },
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog title={t("help.title")} onClose={onClose}>
      <table className="pn-table">
        <thead><tr><th scope="col">{t("help.keys")}</th><th scope="col">{t("help.action")}</th></tr></thead>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}><th scope="row"><kbd>{s.keys}</kbd></th><td>{t(s.action)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="pn-hint">{t("help.quickstart")}</p>
      <p className="pn-hint">{t("notice.disclaimer")}</p>
    </Dialog>
  );
}
