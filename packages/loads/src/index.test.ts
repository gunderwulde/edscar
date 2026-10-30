import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@edscar/loads", () => {
  it("expone su nombre de paquete", () => {
    expect(PACKAGE_NAME).toBe("@edscar/loads");
  });
});
