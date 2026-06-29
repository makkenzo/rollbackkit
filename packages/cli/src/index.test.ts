import { describe, expect, it } from "vitest";

import { rollbackkitCliVersion } from "./program";

describe("@rollbackkit/cli", () => {
    it("exports package version placeholder", () => {
        expect(rollbackkitCliVersion).toBe("0.0.0");
    });
});
