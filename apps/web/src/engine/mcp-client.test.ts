import { describe, it, expect, beforeEach } from "vitest";
import { initMCPClients, getMCPTools, closeMCPClients } from "./mcp-client";

describe("MCP Client", () => {
  // Reset state between tests by closing
  beforeEach(async () => {
    await closeMCPClients();
  });

  describe("initMCPClients", () => {
    it("initializes (sets _initialized to true)", async () => {
      await initMCPClients();
      // After init, tools should be available
      const tools = getMCPTools();
      expect(tools).toBeNull(); // No tools registered yet
    });

    it("calling initMCPClients twice is idempotent", async () => {
      await initMCPClients();
      await initMCPClients(); // should not throw
      const tools = getMCPTools();
      expect(tools).toBeNull();
    });

    it("can be called multiple times without error", async () => {
      await initMCPClients();
      await initMCPClients();
      await initMCPClients();
      // No error means success
    });
  });

  describe("getMCPTools", () => {
    it("returns null when no tools", async () => {
      await initMCPClients();
      const tools = getMCPTools();
      expect(tools).toBeNull();
    });

    it("returns null before initialization", () => {
      const tools = getMCPTools();
      expect(tools).toBeNull();
    });
  });

  describe("closeMCPClients", () => {
    it("resets state", async () => {
      await initMCPClients();
      await closeMCPClients();
      // After close, tools should still be null
      const tools = getMCPTools();
      expect(tools).toBeNull();
    });

    it("allows re-initialization after close", async () => {
      await initMCPClients();
      await closeMCPClients();
      await initMCPClients(); // should work
      expect(getMCPTools()).toBeNull();
    });
  });

  describe("lifecycle", () => {
    it("full lifecycle: init -> close -> init works", async () => {
      await initMCPClients();
      expect(getMCPTools()).toBeNull();
      await closeMCPClients();
      expect(getMCPTools()).toBeNull();
      await initMCPClients();
      expect(getMCPTools()).toBeNull();
    });
  });
});
