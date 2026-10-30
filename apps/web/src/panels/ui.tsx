/**
 * Componentes de interfaz propios (sin librerías de terceros): campos numéricos con unidades y validación, secciones
 * plegables, pestañas, menú y diálogo accesibles. Estilos en panels.css con tokens --app-* / --ec-*.
 */
import {
  useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode,
} from "react";
import { useT } from "./i18n";
import { usePrefs } from "./prefs";
import { formatPlain, fromDisplay, parseNumber, toDisplay, unitLabel, type Quantity } from "./units";

// --- campo numérico ----------------------------------------------------------------------------------------

export interface NumberFieldProps {
  label: string;
  quantity: Quantity;
  /** Valor en SI; null = vacío. */
  value: number | null;
  /** Permite dejarlo vacío (llama a onCommit(null)). */
  optional?: boolean;
  /** Recibe el valor en SI. Devuelve el texto del error si el modelo lo rechaza (se muestra junto al campo) o null. */
  onCommit: (value: number | null) => string | null;
  disabled?: boolean | undefined;
  /** Sin etiqueta visible (tablas): el nombre accesible sigue siendo `label`. */
  compact?: boolean | undefined;
  /** Atributos para la navegación de la tabla. */
  cell?: { row: number; col: number } | undefined;
  /** Error externo (p. ej. de validación global) mostrado junto al campo. */
  error?: string | null | undefined;
}

export function NumberField({ label, quantity, value, optional = false, onCommit, disabled, compact, cell, error: external }: NumberFieldProps) {
  const t = useT();
  const { units } = usePrefs();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const shown = value === null ? "" : formatPlain(toDisplay(quantity, value, units));
  const text = draft ?? shown;
  const unit = unitLabel(quantity, units);
  const msg = error ?? external ?? null;

  const commit = (): void => {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (!optional) {
        setError(t("field.required"));
        return;
      }
      if (value === null) {
        setDraft(null);
        return;
      }
      const e = onCommit(null);
      if (e) setError(e);
      else {
        setDraft(null);
        setError(null);
      }
      return;
    }
    const n = parseNumber(trimmed);
    if (n === null) {
      setError(t("field.invalid"));
      return;
    }
    const si = fromDisplay(quantity, n, units);
    if (value !== null && Math.abs(si - value) <= 1e-12 * Math.max(1, Math.abs(value))) {
      setDraft(null);
      setError(null);
      return;
    }
    const e = onCommit(si);
    if (e) setError(e);
    else {
      setDraft(null);
      setError(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape" && (draft !== null || error !== null)) {
      e.stopPropagation();
      setDraft(null);
      setError(null);
    }
  };

  return (
    <div className={`pn-field${compact ? " pn-compact" : ""}${msg ? " pn-invalid" : ""}`}>
      {!compact && <span className="pn-label" aria-hidden="true">{label}</span>}
      <span className="pn-input-wrap">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          aria-label={unit === "" ? label : `${label} (${unit})`}
          aria-invalid={msg ? true : undefined}
          aria-describedby={msg ? errId : undefined}
          data-row={cell?.row}
          data-col={cell?.col}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {unit !== "" && <span className="pn-unit" aria-hidden="true">{unit}</span>}
      </span>
      {msg && <span id={errId} role="alert" className="pn-error">{msg}</span>}
    </div>
  );
}

// --- texto ---------------------------------------------------------------------------------------------------

export function TextField({ label, value, onCommit, compact, disabled }: {
  label: string; value: string; onCommit: (v: string) => string | null; compact?: boolean | undefined; disabled?: boolean | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const commit = (): void => {
    if (draft === null || draft === value) {
      setDraft(null);
      return;
    }
    const e = onCommit(draft);
    setError(e);
    if (!e) setDraft(null);
  };
  return (
    <div className={`pn-field${compact ? " pn-compact" : ""}${error ? " pn-invalid" : ""}`}>
      {!compact && <span className="pn-label" aria-hidden="true">{label}</span>}
      <span className="pn-input-wrap">
        <input
          type="text"
          value={draft ?? value}
          disabled={disabled}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape" && draft !== null) {
              e.stopPropagation();
              setDraft(null);
              setError(null);
            }
          }}
        />
      </span>
      {error && <span id={errId} role="alert" className="pn-error">{error}</span>}
    </div>
  );
}

// --- selector y casilla --------------------------------------------------------------------------------------

export interface Option { value: string; label: string }

export function SelectField({ label, value, options, onChange, compact, disabled }: {
  label: string; value: string; options: readonly Option[]; onChange: (v: string) => void; compact?: boolean | undefined; disabled?: boolean | undefined;
}) {
  return (
    <div className={`pn-field${compact ? " pn-compact" : ""}`}>
      {!compact && <span className="pn-label" aria-hidden="true">{label}</span>}
      <select
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function CheckField({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean | undefined;
}) {
  return (
    <label className="pn-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <span>{label}</span>
    </label>
  );
}

/** Mensaje de error de un comando rechazado, junto al grupo de campos. */
export function ErrorLine({ message }: { message: string | null }) {
  return message ? <p role="alert" className="pn-error pn-error-line">{message}</p> : null;
}

// --- sección plegable ----------------------------------------------------------------------------------------

export function Section({ title, defaultOpen = true, children, actions, count }: {
  title: string; defaultOpen?: boolean; children: ReactNode; actions?: ReactNode; count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="pn-section">
      <h3 className="pn-section-title">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => { setOpen(!open); }}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {title}
          {count !== undefined && <span className="pn-count">{count}</span>}
        </button>
        {actions}
      </h3>
      <div id={bodyId} hidden={!open} className="pn-section-body">{open && children}</div>
    </section>
  );
}

// --- pestañas ------------------------------------------------------------------------------------------------

export interface TabDef { id: string; label: string; badge?: number | undefined }

export function Tabs({ tabs, active, onChange, ariaLabel, children }: {
  tabs: readonly TabDef[]; active: string; onChange: (id: string) => void; ariaLabel: string; children: ReactNode;
}) {
  const base = useId();
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = tabs.findIndex((x) => x.id === active);
    let n = i;
    if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = tabs.length - 1;
    else return;
    e.preventDefault();
    const next = tabs[n];
    if (next) {
      onChange(next.id);
      document.getElementById(`${base}-tab-${next.id}`)?.focus();
    }
  };
  return (
    <div className="pn-tabs">
      <div role="tablist" aria-label={ariaLabel} className="pn-tablist" onKeyDown={onKey}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${base}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            aria-controls={`${base}-panel`}
            tabIndex={tab.id === active ? 0 : -1}
            onClick={() => { onChange(tab.id); }}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && <span className="pn-badge">{tab.badge}</span>}
          </button>
        ))}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active}`} className="pn-tabpanel">{children}</div>
    </div>
  );
}

// --- panel lateral plegable ---------------------------------------------------------------------------------

export function CollapsiblePanel({ title, side, children }: { title: string; side: "left" | "right" | "bottom"; children: ReactNode }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const id = useId();
  const arrow = side === "left" ? (collapsed ? "»" : "«") : side === "right" ? (collapsed ? "«" : "»") : collapsed ? "▴" : "▾";
  return (
    <div className="pn-panel" data-collapsed={collapsed} data-side={side}>
      <div className="pn-panel-head">
        {!collapsed && <h2 className="pn-panel-title">{title}</h2>}
        <button
          type="button"
          className="pn-iconbtn"
          aria-expanded={!collapsed}
          aria-controls={id}
          title={collapsed ? t("panel.expand", { name: title }) : t("panel.collapse", { name: title })}
          aria-label={collapsed ? t("panel.expand", { name: title }) : t("panel.collapse", { name: title })}
          onClick={() => { setCollapsed(!collapsed); }}
        >
          {arrow}
        </button>
      </div>
      <div id={id} className="pn-panel-body" hidden={collapsed}>{children}</div>
    </div>
  );
}

// --- menú desplegable ----------------------------------------------------------------------------------------

export interface MenuItem { id: string; label: string; onSelect: () => void; disabled?: boolean | undefined; hint?: string }

export function MenuButton({ label, items }: { label: string; items: readonly MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  const focusItem = (delta: number): void => {
    const els = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);
    if (els.length === 0) return;
    const i = els.findIndex((el) => el === document.activeElement);
    els[(i + delta + els.length) % els.length]?.focus();
  };
  return (
    <div
      className="pn-menu"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          root.current?.querySelector<HTMLButtonElement>("button")?.focus();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          if (!open) setOpen(true);
          else focusItem(1);
        } else if (e.key === "ArrowUp" && open) {
          e.preventDefault();
          focusItem(-1);
        }
      }}
    >
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={listId} onClick={() => { setOpen(!open); }}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul id={listId} role="menu" className="pn-menu-list">
          {items.map((it) => (
            <li key={it.id} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                <span>{it.label}</span>
                {it.hint && <kbd>{it.hint}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- diálogo -------------------------------------------------------------------------------------------------

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>("button, [href], input, select")?.focus();
    return () => {
      prev?.focus();
    };
  }, []);
  return (
    <div className="pn-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        className="pn-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (e.key === "Tab") {
            const f = Array.from(ref.current?.querySelectorAll<HTMLElement>("button, input, select, a[href]") ?? []);
            const first = f[0];
            const last = f[f.length - 1];
            if (first && last && e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (first && last && !e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="pn-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="pn-iconbtn" aria-label={t("common.close")} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
