export const env = {
  VITE_API_URL: import.meta.env.VITE_API_URL as string | undefined,
  VITE_DEFAULT_MODEL: import.meta.env.VITE_DEFAULT_MODEL as string | undefined,
  VITE_DEFAULT_TEMPERATURE: parseFloat(import.meta.env.VITE_DEFAULT_TEMPERATURE as string) || 0.7,
  VITE_DEFAULT_MAX_TOKENS: parseInt(import.meta.env.VITE_DEFAULT_MAX_TOKENS as string, 10) || 1024,
  VITE_DEFAULT_SYSTEM_PROMPT:
    (import.meta.env.VITE_DEFAULT_SYSTEM_PROMPT as string) ||
    'You are a helpful AI assistant. Be concise and helpful in your responses.',
  VITE_DEFAULT_MODE: (import.meta.env.VITE_DEFAULT_MODE as string) || 'free',
  VITE_CONFIG_VERSION: parseInt(import.meta.env.VITE_CONFIG_VERSION as string, 10) || 1,
  DEV: import.meta.env.DEV,
} as const;
