export const fakeLlmChunks = async function* (message: string): AsyncGenerator<string> {
  yield "收到：";
  yield message;
};
