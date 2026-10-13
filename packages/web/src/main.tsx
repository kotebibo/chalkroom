import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/kalam/400.css';
import '@fontsource/kalam/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import { useStore, connect } from './store';
import { TopBar, ConnectionBanner, Toasts } from './components/Chrome';
import { Classroom } from './screens/Classroom';
import { Review } from './screens/Review';
import { Progress } from './screens/Progress';
import { Resources } from './screens/Resources';
import { Settings } from './screens/Settings';
import { Home } from './screens/Home';

function App() {
  const view = useStore((s) => s.view);
  useEffect(() => { connect(); }, []);
  return (
    <div className="app">
      <TopBar />
      <div><ConnectionBanner /></div>
      <main style={{ minHeight: 0, overflow: 'hidden' }}>
        {view === 'classroom' && <Classroom />}
        {view === 'review' && <Review />}
        {view === 'progress' && <Progress />}
        {view === 'resources' && <Resources />}
        {view === 'settings' && <Settings />}
        {view === 'home' && <Home />}
      </main>
      <Toasts />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
