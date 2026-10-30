import { createContext, useContext } from "react";

/** Función que encuadra el modelo en el lienzo; la provee <App>. Sin proveedor no hace nada. */
export const FitContext = createContext<() => void>(() => undefined);
export const useFit = (): (() => void) => useContext(FitContext);
