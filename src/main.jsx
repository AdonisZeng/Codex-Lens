import { createRoot } from 'react-dom/client';
import { App } from './components/App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import './global.css';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <ErrorBoundary
    onError={(error, errorInfo) => {
      console.error('[Global Error]', error, errorInfo);
    }}
  >
    <App />
  </ErrorBoundary>
);
