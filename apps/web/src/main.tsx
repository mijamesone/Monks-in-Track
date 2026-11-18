import '@fontsource-variable/outfit';
import '@fontsource-variable/red-hat-display';
import '@fontsource/playfair-display/500-italic.css';
import './styles/app.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CompanyProvider } from './lib/company.tsx';
import { router } from './router.tsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (count, err) => (err as { code?: string }).code !== 'locked' && count < 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <CompanyProvider>
        <RouterProvider router={router} />
      </CompanyProvider>
    </QueryClientProvider>
  </StrictMode>,
);
