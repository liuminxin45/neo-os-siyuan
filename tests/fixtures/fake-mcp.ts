export const fakeMcpTools = [
  {
    name: "lookup_wiki",
    description: "Lookup a fake wiki entry.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
];

export const fakeMcpCall = (name: string, args: Record<string, unknown>): Record<string, unknown> => ({
  tool: name,
  args,
  result: "fake tool result",
});
