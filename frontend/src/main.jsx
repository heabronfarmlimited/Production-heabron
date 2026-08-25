import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1F2A24',
              color: '#FFFFFF',
              borderRadius: '12px',
              fontSize: '14px',
              padding: '12px 16px',
              boxShadow: '0 10px 40px -10px rgba(0,0,0,0.3)',
            },
            success: { iconTheme: { primary: '#2C6B47', secondary: '#FFFFFF' } },
            error: { iconTheme: { primary: '#DC2626', secondary: '#FFFFFF' } },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
