import { describe, expect, it } from "vitest";
import { evaluateFormula, normalizeNumericVariable, validateFormula } from "./formula-engine";

describe("canonical fixed-point formula engine", () => {
  it("evaluates decimal arithmetic without binary floating-point drift", () => {
    const result = evaluateFormula("0.1 + 0.2");
    expect(result.valid).toBe(true);
    expect(result.valueExact).toBe("0.3");
  });

  it("evaluates persisted variables together with bare runtime context", () => {
    const result = evaluateFormula(
      "breakfast_count * var('meal.rate.breakfast') + lunch_count * var('meal.rate.lunch')",
      {
        variables: {
          "meal.rate.breakfast": "40",
          "meal.rate.lunch": "60",
        },
        context: {
          breakfast_count: "3",
          lunch_count: "2",
        },
      },
    );
    expect(result.valid).toBe(true);
    expect(result.valueExact).toBe("240");
    expect(result.variableSlugs).toEqual(["meal.rate.breakfast", "meal.rate.lunch"]);
    expect(result.contextKeys).toEqual(["breakfast_count", "lunch_count"]);
  });

  it("accepts the canonical seeded meal-charge formula", () => {
    const validation = validateFormula(
      "breakfast_count * var('meal.rate.breakfast') + lunch_count * var('meal.rate.lunch') + dinner_count * var('meal.rate.dinner')",
    );
    expect(validation).toEqual({
      valid: true,
      variableSlugs: ["meal.rate.breakfast", "meal.rate.lunch", "meal.rate.dinner"],
      contextKeys: ["breakfast_count", "lunch_count", "dinner_count"],
    });
  });

  it("blocks unresolved dependencies in strict authoritative evaluation", () => {
    const result = evaluateFormula("count * var('missing.rate')", {
      context: { count: "2" },
      strictMissing: true,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Variable "missing.rate" is missing');
  });

  it("reports unresolved builder dependencies without inventing values", () => {
    const result = evaluateFormula("count * var('missing.rate')", {
      strictMissing: false,
    });
    expect(result.valid).toBe(true);
    expect(result.valueExact).toBe("0");
    expect(result.missingVariables).toEqual(["missing.rate"]);
    expect(result.missingContext).toEqual(["count"]);
    expect(result.resolvedValues["missing.rate"]).toBe("0");
  });

  it("supports deterministic rounding and division", () => {
    expect(evaluateFormula("ROUND(10 / 3, 2)").valueExact).toBe("3.33");
    expect(evaluateFormula("1 / 8").valueExact).toBe("0.125");
  });

  it("rejects division by zero and malformed syntax", () => {
    const divide = evaluateFormula("10 / 0");
    expect(divide.valid).toBe(false);
    expect(divide.error).toContain("Division by zero");
    expect(validateFormula("1 + )").valid).toBe(false);
  });

  it("normalizes authoritative numeric variable precision", () => {
    expect(normalizeNumericVariable("0012.3400", 6)).toBe("12.34");
    expect(normalizeNumericVariable("12.345", 2)).toBeNull();
    expect(normalizeNumericVariable("-2.500000", 6)).toBe("-2.5");
  });
});
