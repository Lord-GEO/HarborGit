import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './themes.css';
import './features.css';
import './history-actions.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
