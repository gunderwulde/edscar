#!/usr/bin/env node
// Comprueba THIRD_PARTY.md contra las dependencias reales. Sin dependencias externas.
//  1. Toda dependencia directa (cualquier package.json del workspace, excepto @edscar/*)
//     debe figurar en la tabla "Dependencias directas" de THIRD_PARTY.md.
//  2. La licencia de todo paquete instalado en node_modules (directo o transitivo)
//     debe estar permitida: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC.
//     BlueOak-1.0.0 se admite SOLO en paquetes de desarrollo (ADR-004): es error si el paquete
//     está en el cierre de runtime (ver 5).
//  3. La licencia declarada en THIRD_PARTY.md para las directas debe coincidir con la instalada.
//  4. Excepción: un paquete transitivo con licencia fuera de la lista se acepta solo si figura
//     (nombre + licencia exactos) en la tabla "Excepciones de licencia" de THIRD_PARTY.md, que
//     exige un ADR aprobado por el propietario. Una excepción que ya no se usa es error.
//  5. Cierre de runtime: se parte de "dependencies", "optionalDependencies" y "peerDependencies"
//     de la raíz, packages/* y apps/* (excepto @edscar/*, cuyos manifiestos ya se recorren) y se
//     siguen de forma transitiva por el árbol de pnpm (node_modules/.pnpm), con la versión exacta
//     resuelta. "devDependencies" nunca entran en el cierre. Limitaciones: los opcionales no
//     instalados se ignoran; una dependencia de runtime obligatoria que no se resuelve en disco
//     es error; el cierre depende de la instalación local (binarios opcionales por plataforma).
// Si node_modules no existe, solo se hace la comprobación 1 (y se avisa).
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = new Set(["MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC"]);
const ALLOWED_DEV_ONLY = new Set(["BlueOak-1.0.0"]); // ADR-004
const ALLOWED_DEV = new Set([...ALLOWED, ...ALLOWED_DEV_ONLY]);
const RUNTIME_KEYS = ["dependencies", "optionalDependencies", "peerDependencies"];
const errors = [];

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// Licencia SPDX simple: "A", "(A OR B)", "A AND B". OR: basta una permitida; AND: todas.
function licenseAllowed(expr, allowed) {
  if (typeof expr !== "string" || !expr.trim()) return false;
  const e = expr.trim().replace(/^\(|\)$/g, "");
  if (/\sAND\s/.test(e)) return e.split(/\sAND\s/).every((x) => licenseAllowed(x, allowed));
  if (/\sOR\s/.test(e)) return e.split(/\sOR\s/).some((x) => licenseAllowed(x, allowed));
  return allowed.has(e.trim());
}

// --- package.json del workspace ---
function workspaceManifests() {
  const out = [join(root, "package.json")];
  for (const group of ["apps", "packages"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name, "package.json");
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}

const direct = new Set();
for (const m of workspaceManifests()) {
  const j = readJson(m);
  for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const dep of Object.keys(j[k] ?? {})) if (!dep.startsWith("@edscar/")) direct.add(dep);
  }
}

// --- THIRD_PARTY.md: tabla de directas ---
const md = readFileSync(join(root, "THIRD_PARTY.md"), "utf8");
const section = md.split(/^## /m).find((s) => s.startsWith("Dependencias directas"));
if (!section) errors.push('THIRD_PARTY.md: falta la sección "## Dependencias directas".');
const listed = new Map(); // nombre -> licencia declarada
for (const line of (section ?? "").split("\n")) {
  const cells = line.split("|").map((c) => c.trim());
  const m = /^`([^`]+)`$/.exec(cells[1] ?? "");
  if (m) listed.set(m[1], (cells[3] ?? "").replace(/`/g, ""));
}

// --- THIRD_PARTY.md: excepciones de licencia aprobadas (nombre -> licencia) ---
const exSection = md.split(/^## /m).find((s) => s.startsWith("Excepciones de licencia"));
const exceptions = new Map();
for (const line of (exSection ?? "").split("\n")) {
  const cells = line.split("|").map((c) => c.trim());
  const m = /^`([^`]+)`$/.exec(cells[1] ?? "");
  if (m) exceptions.set(m[1], (cells[2] ?? "").replace(/`/g, ""));
}
const usedExceptions = new Set();

for (const dep of direct) {
  if (!listed.has(dep)) errors.push(`Dependencia directa no listada en THIRD_PARTY.md: ${dep}`);
}
for (const name of listed.keys()) {
  if (!direct.has(name)) errors.push(`THIRD_PARTY.md lista "${name}" pero ningún package.json la declara.`);
}

// --- licencias instaladas ---
function installedPackages() {
  const store = join(root, "node_modules", ".pnpm");
  const found = new Map(); // name@version -> license
  if (!existsSync(store)) return null;
  for (const entry of readdirSync(store)) {
    const nm = join(store, entry, "node_modules");
    if (!existsSync(nm) || !statSync(nm).isDirectory()) continue;
    for (const n of readdirSync(nm)) {
      const names = n.startsWith("@") ? readdirSync(join(nm, n)).map((x) => `${n}/${x}`) : [n];
      for (const q of names) {
        const pj = join(nm, q, "package.json");
        if (!existsSync(pj)) continue;
        const j = readJson(pj);
        if (j.name !== q || q.startsWith("@edscar/")) continue; // omite enlaces a otros paquetes
        found.set(`${j.name}@${j.version}`, j.license ?? (j.licenses ? j.licenses.map((l) => l.type).join(" OR ") : undefined));
      }
    }
  }
  return found;
}

// --- cierre de runtime (conjunto de name@version) ---
// En pnpm, un paquete real vive en .pnpm/<id>/node_modules/<nombre> y sus dependencias son
// enlaces hermanos en ese mismo node_modules.
function nodeModulesOf(pkgDir, name) {
  return name.startsWith("@") ? dirname(dirname(pkgDir)) : dirname(pkgDir);
}
function isOptional(manifest, key, dep) {
  return key === "optionalDependencies" || (key === "peerDependencies" && manifest.peerDependenciesMeta?.[dep]?.optional === true);
}
function runtimeClosure() {
  const ids = new Set();
  const visited = new Set();
  const stack = []; // [node_modules donde resolver, nombre, opcional, origen]
  for (const m of workspaceManifests()) {
    const j = readJson(m);
    const nm = join(dirname(m), "node_modules");
    for (const k of RUNTIME_KEYS) {
      for (const dep of Object.keys(j[k] ?? {})) {
        if (!dep.startsWith("@edscar/")) stack.push([nm, dep, isOptional(j, k, dep), m]);
      }
    }
  }
  while (stack.length) {
    const [nm, dep, optional, from] = stack.pop();
    const link = join(nm, dep);
    if (!existsSync(join(link, "package.json"))) {
      if (!optional) errors.push(`Dependencia de runtime no resoluble en disco: ${dep} (desde ${from})`);
      continue;
    }
    const dir = realpathSync(link);
    if (visited.has(dir)) continue;
    visited.add(dir);
    const j = readJson(join(dir, "package.json"));
    const id = `${j.name}@${j.version}`;
    ids.add(id);
    const siblings = nodeModulesOf(dir, j.name);
    for (const k of RUNTIME_KEYS) {
      for (const d of Object.keys(j[k] ?? {})) stack.push([siblings, d, isOptional(j, k, d), id]);
    }
  }
  return ids;
}

const installed = installedPackages();
let runtimeCount = 0;
if (!installed) {
  console.warn("AVISO: node_modules no encontrado; se omite la comprobación de licencias instaladas.");
} else {
  const runtime = runtimeClosure();
  runtimeCount = runtime.size;
  for (const [id, lic] of installed) {
    const name = id.slice(0, id.lastIndexOf("@"));
    const isRuntime = runtime.has(id);
    const ok = licenseAllowed(lic, isRuntime ? ALLOWED : ALLOWED_DEV);
    if (!ok && exceptions.get(name) === lic) {
      usedExceptions.add(name);
      continue;
    }
    if (!ok) {
      if (isRuntime && licenseAllowed(lic, ALLOWED_DEV)) {
        errors.push(`Licencia ${JSON.stringify(lic)} solo admitida en desarrollo, pero ${id} es dependencia de runtime (ADR-004).`);
      } else {
        errors.push(`Licencia no permitida o desconocida: ${id} -> ${JSON.stringify(lic)}`);
      }
    }
    if (listed.has(name) && listed.get(name) !== lic) {
      errors.push(`Licencia de ${name} en THIRD_PARTY.md (${listed.get(name)}) difiere de la instalada (${lic}).`);
    }
  }
}

if (installed) {
  for (const name of exceptions.keys()) {
    if (!usedExceptions.has(name)) errors.push(`Excepción de licencia sin uso en THIRD_PARTY.md: ${name}`);
  }
}

if (errors.length) {
  console.error("check-third-party: FALLO");
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(
  `check-third-party: OK (${direct.size} directas` +
    (installed ? `, ${installed.size} paquetes instalados con licencia permitida, ${runtimeCount} en el cierre de runtime` : "") +
    ")",
);
