/**
 * Exact token count via the Anthropic count_tokens endpoint. The SDK is
 * imported lazily so it never loads unless --exact is actually used.
 */
export async function countTokensExact(
  text: string,
  model: string = 'claude-sonnet-4-6',
): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY required for --exact counts; estimated counts work without it',
    );
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const result = await client.messages.countTokens({
    model,
    messages: [{ role: 'user', content: text }],
  });
  return result.input_tokens;
}
