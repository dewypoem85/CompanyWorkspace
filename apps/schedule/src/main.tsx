import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import './theme.css';
import './detail.css';
import './timeline.css';
import './overview.css';
import './todos.css';

declare global {
  interface Window { CompanySearch?: { matches(value: string, query: string): boolean }; CompanyWorkspace?: { sessionExpired?: (url: string) => void }; }
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
