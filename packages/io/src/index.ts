/** @edscar/io — import/export (JSON .edscar.json, CSV, SAF, s2k, OpenSees). M0: solo contrato. */
import type { Project } from "@edscar/model";

export const PACKAGE_NAME = "@edscar/io";

export interface ExportResult { filename: string; mime: string; content: string }
export type ImportResult =
  | { ok: true; project: Project; warnings: string[] }
  | { ok: false; errors: string[] };

export interface Exporter { readonly format: string; export(project: Project): ExportResult }
export interface Importer { readonly format: string; import(content: string): ImportResult }
