import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AuthGate } from './components/auth/AuthGate';
import './index.css';

// The app only mounts for a signed-in user. key={user.id} discards every in-memory record when a
// different user signs in on the same tab.
createRoot(document.getElementById('root')!).render(
  <AuthGate>{(user, onSignOut) => <App key={user.id} currentUser={user} onSignOut={onSignOut} />}</AuthGate>
);
