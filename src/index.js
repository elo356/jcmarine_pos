import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { VirtualScannerProvider } from './contexts/VirtualScannerContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AuthProvider>
    <VirtualScannerProvider>
      <App />
    </VirtualScannerProvider>
  </AuthProvider>
);
