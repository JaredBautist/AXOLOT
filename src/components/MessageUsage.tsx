import React from 'react';
import { Text } from '../ink.js';

type Props = {
  message: {
    type: string;
    message: {
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number | null;
        cache_creation_input_tokens?: number | null;
      };
    };
  };
};

export function MessageUsage(t0: Props): React.ReactNode {
  const { message } = t0;

  if (message.type !== "assistant" || !message.message.usage) {
    return null;
  }

  const { input_tokens, output_tokens, cache_read_input_tokens } = message.message.usage;

  let text = `in:${input_tokens}  out:${output_tokens}`;
  if (cache_read_input_tokens) {
    text += `  cache:${cache_read_input_tokens}`;
  }

  return <Text dimColor={true}>{text}</Text>;
}
