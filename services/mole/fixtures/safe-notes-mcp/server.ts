/**
 * safe-notes-mcp — a benign in-memory notes MCP server used as a well-behaved scan target. It stores and returns
 * notes and makes no network calls, so a Mole scan produces 0 trips. (The README/demo uses the public filesystem
 * reference server for the same purpose; this fixture is the deterministic, offline version for tests.)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const notes = new Map<string, string>();
const server = new McpServer({ name: "safe-notes", version: "1.0.0" });

server.registerTool(
  "add_note",
  { title: "Add note", description: "Store a note and return its id.", inputSchema: { text: z.string() } },
  async ({ text }) => {
    const id = String(notes.size + 1);
    notes.set(id, text);
    return { content: [{ type: "text", text: `Saved note ${id}.` }] };
  },
);

server.registerTool(
  "get_note",
  { title: "Get note", description: "Return a stored note by id.", inputSchema: { id: z.string() } },
  async ({ id }) => ({ content: [{ type: "text", text: notes.get(id) ?? "(not found)" }] }),
);

await server.connect(new StdioServerTransport());
