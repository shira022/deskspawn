import { describe, it, expect, beforeEach } from "vitest";
import { StepManager } from "./step-limits";

describe("StepManager", () => {
  let manager: StepManager;

  beforeEach(() => {
    manager = new StepManager();
  });

  describe("constructor", () => {
    it("sets default values", () => {
      expect(manager.stepCount).toBe(0);
      expect(manager.currentLimit).toBe(20);
      expect(manager.baseLimit).toBe(20);
      expect(manager.absoluteMax).toBe(120);
      expect(manager.maxContinuations).toBe(2);
      expect(manager.continuationCount).toBe(0);
      expect(manager.stoppedReason).toBe("normal_completion");
    });

    it("accepts custom values", () => {
      const m = new StepManager(10, 50, 5);
      expect(m.baseLimit).toBe(10);
      expect(m.absoluteMax).toBe(50);
      expect(m.maxContinuations).toBe(5);
      expect(m.currentLimit).toBe(10);
    });
  });

  describe("shouldStop", () => {
    it("returns false when under limit", () => {
      const steps = new Array(5);
      expect(manager.shouldStop({ steps })).toBe(false);
      expect(manager.stoppedReason).toBe("normal_completion");
    });

    it("returns true when step count reaches currentLimit", () => {
      const steps = new Array(20);
      expect(manager.shouldStop({ steps })).toBe(true);
      expect(manager.stoppedReason).toBe("max_steps");
    });

    it("returns true when absolute max reached (across continuation rounds)", () => {
      const m = new StepManager(10, 15, 2);
      // Simulate completing first round
      m.totalStepsBeforeCurrentRound = 5;
      m.stepCount = 0;
      const steps = new Array(11); // 5 + 11 = 16 >= 15
      expect(m.shouldStop({ steps })).toBe(true);
      expect(m.stoppedReason).toBe("max_steps");
    });

    it("returns true when loop detected (loopScore >= LOOP_THRESHOLD)", () => {
      // Manually set loopScore to trigger
      const m = new StepManager(100, 200);
      // We'll trigger loop detection by recording consecutive identical tool calls
      // Loop score increments after LOOP_THRESHOLD (3) consecutive same non-diagnostic tools
      // We need 3 consecutive same calls, then loopScore should be 1.
      // But LOOP_THRESHOLD=3 and loopScore needs to be >=3 to trigger shouldStop.
      // So we need 3 * 3 = 9 consecutive same calls for loopScore to become 3.
      // Actually: consecutiveToolCount starts at 0, when key===lastToolKey it increments.
      // After 3 consecutive (consecutiveToolCount >= 3) -> loopScore++
      // So we need loopScore >= 3 which means 3 * 3 = 9 consecutive calls.

      // First call establishes lastToolKey
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // count=1, consecutiveToolCount=0 (first, no match)

      // Need to be careful: after first call, lastToolKey is set. Second call with same key will match.
      for (let i = 0; i < 8; i++) {
        m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      }
      // After 9 total calls: first call sets key, 2nd-9th are 8 consecutive matching calls
      // consecutiveToolCount: 1st (0, becomes lastToolKey), 2nd (1), 3rd (2, loopScore=0 still), 
      // 4th (>=3, loopScore++), 5th (>=3, loopScore++),
      // Actually let me trace:
      // After 1: key=apply_artifact::..., lastToolKey='', no match, so lastToolKey=key, consecutiveToolCount=1
      // After 2: key matches lastToolKey, consecutiveToolCount=2 (still < 3)
      // After 3: key matches, consecutiveToolCount=3 (>=3, loopScore++ => loopScore=1)
      // After 4: key matches, consecutiveToolCount=4 (>=3, loopScore++ => loopScore=2)
      // After 5: key matches, consecutiveToolCount=5 (>=3, loopScore++ => loopScore=3)
      // So we need 5 total at a minimum. Let me test with 5.
      const m2 = new StepManager(100, 200);
      m2.recordStep([{ toolName: "apply_artifact", args: { id: "2" } }]);
      m2.recordStep([{ toolName: "apply_artifact", args: { id: "2" } }]);
      m2.recordStep([{ toolName: "apply_artifact", args: { id: "2" } }]);
      m2.recordStep([{ toolName: "apply_artifact", args: { id: "2" } }]);
      m2.recordStep([{ toolName: "apply_artifact", args: { id: "2" } }]);
      // After 5 identical calls, loopScore should be 3 (triggered on 3rd, 4th, 5th)

      const steps = new Array(0);
      expect(m2.shouldStop({ steps })).toBe(true);
      expect(m2.stoppedReason).toBe("loop_detected");
    });

    it("checks loopScore before step count limit", () => {
      const m = new StepManager(100, 200);
      // Set loopScore directly via consecutive same calls
      m.recordStep([{ toolName: "apply_artifact", args: { id: "3" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "3" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "3" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "3" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "3" } }]);

      expect(m.shouldStop({ steps: new Array(0) })).toBe(true);
      expect(m.stoppedReason).toBe("loop_detected");
    });
  });

  describe("recordStep", () => {
    it("increments stepCount", () => {
      manager.recordStep([{ toolName: "read_file", args: { path: "test.ts" } }]);
      expect(manager.stepCount).toBe(1);
      manager.recordStep([]);
      expect(manager.stepCount).toBe(2);
    });

    it("tracks tool calls and loop detection for consecutive same non-diagnostic tools", () => {
      // Diagnostic tools should reset consecutiveToolCount to 0
      manager.recordStep([{ toolName: "read_file", args: { path: "a.ts" } }]);
      expect(manager["consecutiveToolCount"]).toBe(0); // read_file is diagnostic
      // Now use non-diagnostic tool
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      expect(manager["consecutiveToolCount"]).toBe(1);
      // Same tool with same args
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      expect(manager["consecutiveToolCount"]).toBe(2);
      // Third same -> triggers loopScore increment
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      expect(manager["consecutiveToolCount"]).toBe(3);
      expect(manager["loopScore"]).toBe(1);
    });

    it("tracks fileWriteCount on apply_artifact", () => {
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      expect(manager["fileWriteCount"]).toBe(1);
      expect(manager["totalFileActions"]).toBe(1);
    });

    it("resets consecutiveGetErrors on apply_artifact", () => {
      // First cause some get errors
      manager.recordStep([{ toolName: "get_errors", args: {} }]);
      manager.recordStep([{ toolName: "get_errors", args: {} }]);
      expect(manager["consecutiveGetErrors"]).toBe(2);
      // Now apply_artifact should reset
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "x" } }]);
      expect(manager["consecutiveGetErrors"]).toBe(0);
    });

    it("tracks consecutiveGetErrors on get_errors tool", () => {
      manager.recordStep([{ toolName: "get_errors", args: {} }]);
      expect(manager["consecutiveGetErrors"]).toBe(1);
      manager.recordStep([{ toolName: "get_errors", args: {} }]);
      expect(manager["consecutiveGetErrors"]).toBe(2);
    });

    it("does not increment consecutiveGetErrors for non-get_errors tools", () => {
      manager.recordStep([{ toolName: "read_file", args: { path: "x.ts" } }]);
      expect(manager["consecutiveGetErrors"]).toBe(0);
    });

    it("handles empty tool calls array", () => {
      manager.recordStep([]);
      expect(manager.stepCount).toBe(1);
      expect(manager["fileWriteCount"]).toBe(0);
      expect(manager["consecutiveGetErrors"]).toBe(0);
    });

    it("non-consecutive tools don't trigger loop detection", () => {
      // Different tool names should not increment consecutiveToolCount
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "a" } }]);
      manager.recordStep([{ toolName: "read_file", args: { path: "b.ts" } }]); // diagnostic -> resets
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "c" } }]);
      expect(manager["loopScore"]).toBe(0);
    });

    it("detects loop based on tool+args key, not just tool name", () => {
      // Same tool but different args should not be counted as consecutive
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "2" } }]);
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "3" } }]);
      expect(manager["loopScore"]).toBe(0);
    });

    it("updates currentLimit based on fileWriteCount", () => {
      expect(manager.currentLimit).toBe(20);
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      // fileWriteCount=1, extension = min(1*10, 40) = 10
      // currentLimit = min(20+10, 120) = 30
      expect(manager.currentLimit).toBe(30);
    });

    it("freezes limit extension when loopScore >= 2", () => {
      const m = new StepManager(20, 120);
      // Record many apply_artifact to get fileWriteCount up
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // fileWriteCount=1, limit=30
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // consecutive match
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // consecutive match -> loopScore=1
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // loopScore=2
      // Now loopScore=2, updateLimit should not extend further
      const limitBeforeFreeze = m.currentLimit;
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // fileWriteCount=5, but loopScore>=2 so no change
      expect(m.currentLimit).toBe(limitBeforeFreeze);
    });
  });

  describe("getProgress", () => {
    it("returns correct progress info", () => {
      const m = new StepManager(20, 50);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      const progress = m.getProgress();
      expect(progress.step).toBe(1);
      expect(progress.maxSteps).toBeLessThanOrEqual(50);
      expect(progress.continuationRound).toBe(0);
      expect(progress.maxContinuations).toBe(2);
    });

    it("includes continuation round info", () => {
      const m = new StepManager(20, 50);
      m.totalStepsBeforeCurrentRound = 15;
      m.recordStep([{ toolName: "read_file", args: { path: "x.ts" } }]);
      const progress = m.getProgress();
      expect(progress.step).toBe(16); // 15 + 1
    });
  });

  describe("getFinalState", () => {
    it("returns correct final state for normal completion", () => {
      const state = manager.getFinalState();
      expect(state.step).toBe(0);
      expect(state.hitLimit).toBe(false);
      expect(state.stoppedReason).toBe("normal_completion");
      expect(state.continuationRound).toBe(0);
      expect(state.maxContinuations).toBe(2);
    });

    it("returns correct final state when max_steps hit", () => {
      const m = new StepManager(5, 20);
      m.shouldStop({ steps: new Array(5) });
      const state = m.getFinalState();
      expect(state.hitLimit).toBe(true);
      expect(state.stoppedReason).toBe("max_steps");
    });

    it("returns correct final state when loop detected", () => {
      const m = new StepManager(100, 200);
      // Induce loop score >= 3
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.shouldStop({ steps: new Array(0) });
      const state = m.getFinalState();
      expect(state.hitLimit).toBe(true);
      expect(state.stoppedReason).toBe("loop_detected");
    });
  });

  describe("canAutoContinue", () => {
    it("returns false when normal completion", () => {
      expect(manager.canAutoContinue()).toBe(false);
    });

    it("returns true when hit limit and wrote files", () => {
      const m = new StepManager(5, 20);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      // After recording, currentLimit increases to 15 (5 + min(1*10,40))
      // So we need 15 steps to trigger shouldStop
      m.shouldStop({ steps: new Array(15) });
      expect(m.canAutoContinue()).toBe(true);
    });

    it("returns false when max continuations reached", () => {
      const m = new StepManager(5, 20, 2);
      m.continuationCount = 2; // already max
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.shouldStop({ steps: new Array(5) });
      expect(m.canAutoContinue()).toBe(false);
    });

    it("returns false when fileWriteCount is 0", () => {
      const m = new StepManager(5, 20);
      m.shouldStop({ steps: new Array(5) });
      expect(m.canAutoContinue()).toBe(false);
    });

    it("returns false when stoppedReason is normal_completion even with files written", () => {
      const m = new StepManager(5, 20);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      // Don't trigger shouldStop, so stoppedReason stays normal_completion
      expect(m.canAutoContinue()).toBe(false);
    });
  });

  describe("prepareForContinuation", () => {
    it("resets state correctly", () => {
      const m = new StepManager(20, 120, 2);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.shouldStop({ steps: new Array(0) });

      expect(m.stoppedReason).toBe("loop_detected");
      m.prepareForContinuation();

      expect(m.continuationCount).toBe(1);
      expect(m.stepCount).toBe(0);
      expect(m.totalStepsBeforeCurrentRound).toBe(5);
      expect(m.stoppedReason).toBe("normal_completion");
      expect(m["toolHistory"].size).toBe(0);
      expect(m["lastToolKey"]).toBe("");
      expect(m["consecutiveToolCount"]).toBe(0);
      expect(m["loopScore"]).toBe(0);
      expect(m["consecutiveGetErrors"]).toBe(0);
      expect(m["totalFileActions"]).toBe(0);
    });

    it("increases currentLimit with continuation bonus", () => {
      const m = new StepManager(20, 120);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      // currentLimit=30 after extension
      expect(m.currentLimit).toBe(30);
      m.prepareForContinuation();
      // baseLimit(20) + extension(10) + continuationCount(1)*CONTINUATION_BONUS(10) = 40
      expect(m.currentLimit).toBe(40);
    });

    it("caps currentLimit at absoluteMax", () => {
      const m = new StepManager(20, 35);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }, { toolName: "apply_artifact", args: { id: "2" } }]);
      // fileWriteCount=2, extension=min(2*10,40)=20, currentLimit=min(20+20,35)=35
      expect(m.currentLimit).toBe(35);
      m.prepareForContinuation();
      // baseLimit(20)+extension(20)+continuationCount(1)*10=50, capped at 35
      expect(m.currentLimit).toBe(35);
    });
  });

  describe("getSuggestion", () => {
    it("returns null when no suggestion needed", () => {
      expect(manager.getSuggestion()).toBeNull();
    });

    it("suggests writing code when too many get_errors without actions", () => {
      const m = new StepManager(20, 120);
      // consecutiveGetErrors >= 3 and totalFileActions === 0
      m.recordStep([{ toolName: "get_errors", args: {} }]);
      m.recordStep([{ toolName: "get_errors", args: {} }]);
      m.recordStep([{ toolName: "get_errors", args: {} }]);
      expect(m["consecutiveGetErrors"]).toBe(3);
      expect(m["totalFileActions"]).toBe(0);
      const suggestion = m.getSuggestion();
      expect(suggestion).toContain("You only read files without making any changes");
    });

    it("returns null when get_errors >= 3 but totalFileActions > 0", () => {
      const m = new StepManager(20, 120);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // totalFileActions = 1
      m.recordStep([{ toolName: "get_errors", args: {} }]);
      m.recordStep([{ toolName: "get_errors", args: {} }]);
      m.recordStep([{ toolName: "get_errors", args: {} }]);
      expect(m.getSuggestion()).toBeNull();
    });

    it("suggests different approach when loop detected without writes", () => {
      const m = new StepManager(100, 200);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.shouldStop({ steps: new Array(0) });
      // loopScore=3, fileWriteCount=5... wait, we wrote 5 files.
      // For this test we need loop without writes, so we need to simulate a loop with a non-writing tool
      // Let me use a different approach - inject via the internal mechanism
      // Actually, apply_artifact DOES increment fileWriteCount. So we need a non-fileWrite tool.
      // Let's use a custom tool name that doesn't exist in the special-case list.
      const m2 = new StepManager(100, 200);
      m2.recordStep([{ toolName: "unknown_tool", args: { query: "test" } }]);
      m2.recordStep([{ toolName: "unknown_tool", args: { query: "test" } }]);
      m2.recordStep([{ toolName: "unknown_tool", args: { query: "test" } }]);
      m2.recordStep([{ toolName: "unknown_tool", args: { query: "test" } }]);
      m2.recordStep([{ toolName: "unknown_tool", args: { query: "test" } }]);
      m2.shouldStop({ steps: new Array(0) });
      expect(m2["fileWriteCount"]).toBe(0);
      expect(m2.stoppedReason).toBe("loop_detected");
      const suggestion = m2.getSuggestion();
      expect(suggestion).toContain("repeating the same tool calls");
    });

    it("suggests CRUD template when loop detected with >=3 writes", () => {
      const m = new StepManager(100, 200);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.shouldStop({ steps: new Array(0) });
      expect(m["fileWriteCount"]).toBe(5);
      expect(m.stoppedReason).toBe("loop_detected");
      const suggestion = m.getSuggestion();
      expect(suggestion).toContain("template action");
      expect(suggestion).toContain("CRUD");
    });

    it("suggests 'continue' when max_steps with >=3 writes", () => {
      const m = new StepManager(5, 120);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "2" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "3" } }]);
      // After 3 writes, currentLimit = 5 + min(3*10,40) = 35
      // Need 35 steps to trigger shouldStop
      m.shouldStop({ steps: new Array(35) });
      expect(m["fileWriteCount"]).toBe(3);
      expect(m.stoppedReason).toBe("max_steps");
      const suggestion = m.getSuggestion();
      expect(suggestion).toContain("continue");
    });

    it("returns null for loop_detected with fileWriteCount between 1 and 2", () => {
      const m = new StepManager(100, 200);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // fileWriteCount=1
      // Now loop-inducing calls
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]);
      m.shouldStop({ steps: new Array(0) });
      // fileWriteCount=5... hmm that's >=3.
      // Let me check the code again. fileWriteCount increments on apply_artifact.
      // With 5 calls all apply_artifact, fileWriteCount=5.
      // Actually this edge case (fileWriteCount 1-2) is hard to reach naturally with the loop detection because
      // you need loopScore >=3 which takes at least 5 identical calls. But if all are apply_artifact, fileWriteCount >= 3.
      // This edge case basically only occurs if the loopScore comes from a different mechanism.
      // The condition "loop_detected && fileWriteCount === 0" is checked first, then "loop_detected && fileWriteCount >= 3",
      // so 1-2 fileWriteCount with loop would return null.
      // Let's just directly test the logic: set fileWriteCount to 1 and stoppedReason to loop_detected.
      // That tests the edge case even though it's hard to reach naturally.
      const m2 = new StepManager(100, 200);
      m2["fileWriteCount"] = 1;
      m2["loopScore"] = 3;
      m2.stoppedReason = "loop_detected";
      expect(m2.getSuggestion()).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles empty tool calls gracefully", () => {
      manager.recordStep([]);
      expect(manager.stepCount).toBe(1);
      expect(manager["consecutiveToolCount"]).toBe(0);
      expect(manager["fileWriteCount"]).toBe(0);
    });

    it("non-consecutive diagnostic tools reset consecutiveToolCount", () => {
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // non-diagnostic, consecutiveToolCount=1
      manager.recordStep([{ toolName: "read_file", args: { path: "a.ts" } }]); // diagnostic, resets to 0
      expect(manager["consecutiveToolCount"]).toBe(0);
    });

    it("detects loop correctly with mixed diagnostic and non-diagnostic tools", () => {
      // Diagnostic between identical non-diagnostic calls should break the streak
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // non-diagnostic, consecutiveToolCount=1
      manager.recordStep([{ toolName: "get_errors", args: {} }]); // diagnostic, resets
      manager.recordStep([{ toolName: "apply_artifact", args: { id: "1" } }]); // non-diagnostic, consecutiveToolCount=1 (starts over)
      expect(manager["loopScore"]).toBe(0);
      expect(manager["consecutiveToolCount"]).toBe(1);
    });

    it("multiple tool calls per step are all recorded", () => {
      manager.recordStep([
        { toolName: "apply_artifact", args: { id: "1" } },
        { toolName: "read_file", args: { path: "a.ts" } },
      ]);
      expect(manager["fileWriteCount"]).toBe(1);
      expect(manager["totalFileActions"]).toBe(1);
      expect(manager.stepCount).toBe(1);
    });
  });
});
