import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { createQueryClient } from './lib/query';
import { AppRouterProvider, createAppRouter } from './router';
import { syncColorScheme } from './ui/theme';

// Follow the OS light/dark preference: tokens.css switches the semantic colours on .dark.
syncColorScheme();

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('index.html has no #root element');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
