/** Leyenda de patrones de carga: color, mostrar/ocultar y patrón activo. */
import { useEditorSelector, useEditorStore } from "../store";
import { patternColor } from "./format";

export function Legend() {
  const store = useEditorStore();
  const patterns = useEditorSelector((s) => s.project.patterns);
  const hidden = useEditorSelector((s) => s.hiddenPatterns);
  const active = useEditorSelector((s) => s.activePattern);
  if (patterns.length === 0) return null;
  return (
    <aside className="ec-legend" aria-label="Leyenda de patrones de carga">
      <h2>Patrones</h2>
      <ul>
        {patterns.map((p, k) => {
          const visible = !hidden.includes(p.id);
          return (
            <li key={p.id} data-pattern-row={p.id} className={active === p.id ? "active" : undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(e) => {
                    store.setPatternVisible(p.id, e.target.checked);
                  }}
                  aria-label={`Mostrar patrón ${p.name}`}
                />
                <span className="swatch" style={{ background: patternColor(k) }} aria-hidden="true" />
              </label>
              <button
                type="button"
                className="name"
                aria-pressed={active === p.id}
                title={`Patrón activo: ${p.name} (${p.kind})`}
                onClick={() => {
                  store.setActivePattern(p.id);
                }}
              >
                {p.id} · {p.name}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
