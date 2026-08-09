import type { ApiClient } from '../api-client.js';
import { formatUser } from '../formatters.js';

export function buildGetUserTool(client: ApiClient) {
  return {
    name: 'get_user',
    config: {
      title: 'Get current user',
      description:
        'Returns the wallet address and name of the user this API key belongs to. ' +
        'Useful as a connectivity check or to confirm which account you are operating on.',
    },
    handler: async () => {
      const user = await client.get<{
        id: string;
        address: string;
        name?: string | null;
        createdAt?: string;
      }>('/api/v1/user/me');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatUser(user), null, 2) }],
      };
    },
  };
}
