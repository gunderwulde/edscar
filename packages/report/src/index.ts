/** @edscar/report — memoria de cálculo (HTML/PDF). M0: solo contrato. */
import type { Project } from "@edscar/model";
import type { SolveResult } from "@edscar/solver";

export const PACKAGE_NAME = "@edscar/report";

export interface ReportInput { project: Project; results: Record<string, SolveResult> }
export interface ReportGenerator { generate(input: ReportInput): { mime: string; content: string } }
