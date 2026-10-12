import { QueryClient } from '@tanstack/react-query';

/** The app's single QueryClient; shared defaults for every query and mutation go here. */
export function createQueryClient(): QueryClient {
  return new QueryClient();
}
