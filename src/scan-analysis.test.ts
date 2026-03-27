import { describe, expect, test } from "bun:test";

import { buildScanAssessment, canAutoClean } from "./scan-analysis";

describe("buildScanAssessment", () => {
  test("marks safe readable targets as clean_now", () => {
    const assessment = buildScanAssessment({
      availabilityStatus: "available",
      safeToDelete: "safe",
      skippedItems: 0,
      size: 1024,
      files: 4,
    });

    expect(assessment.recommendation).toBe("clean_now");
    expect(assessment.riskLevel).toBe("low");
    expect(assessment.evidence.preflightPassed).toBe(true);
    expect(canAutoClean(assessment.recommendation)).toBe(true);
  });

  test("blocks safe targets that could not be fully inspected", () => {
    const assessment = buildScanAssessment({
      availabilityStatus: "available",
      safeToDelete: "safe",
      skippedItems: 3,
      size: 2048,
      files: 10,
    });

    expect(assessment.recommendation).toBe("review_first");
    expect(assessment.riskLevel).toBe("medium");
    expect(assessment.evidence.preflightPassed).toBe(false);
    expect(canAutoClean(assessment.recommendation)).toBe(false);
  });

  test("marks unsafe targets as manual_only", () => {
    const assessment = buildScanAssessment({
      availabilityStatus: "available",
      safeToDelete: "unsafe",
      skippedItems: 0,
      size: 10,
      files: 1,
    });

    expect(assessment.recommendation).toBe("manual_only");
    expect(assessment.riskLevel).toBe("high");
  });

  test("marks inaccessible targets as unavailable", () => {
    const assessment = buildScanAssessment({
      availabilityStatus: "inaccessible",
      safeToDelete: "safe",
      skippedItems: 0,
      size: 0,
      files: 0,
    });

    expect(assessment.recommendation).toBe("unavailable");
    expect(assessment.riskLevel).toBe("high");
    expect(assessment.evidence.readable).toBe(false);
  });
});
