import { Route, Routes } from 'react-router-dom';
import AppShell from './layouts/AppShell';
import SystemCheck from './pages/SystemCheck';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<SystemCheck />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
