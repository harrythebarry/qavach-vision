import { createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { Shell } from './components/Shell';
import { Overview } from './pages/Overview';
import { VideoWall, WallScreen } from './pages/wall/VideoWall';
import { Alerts } from './pages/alerts/Alerts';
import { Cameras } from './pages/cameras/Cameras';
import { CameraEditor } from './pages/cameras/CameraEditor';
import { Rules } from './pages/rules/Rules';
import { RuleEditor } from './pages/rules/RuleEditor';
import { Notifications } from './pages/Notifications';
import { Phone } from './pages/phone/Phone';
import { useEngine } from './state/engine';

// Hash routes so the built prototype also works opened straight from disk.
function Root() {
  useEngine();
  return <Outlet />;
}

const router = createHashRouter([
  {
    element: <Root />,
    children: [
      {
        element: <Shell />,
        children: [
          { path: '/', element: <Overview /> },
          { path: '/wall', element: <VideoWall /> },
          { path: '/wall/:wallId', element: <VideoWall /> },
          { path: '/alerts', element: <Alerts /> },
          { path: '/alerts/:alertId', element: <Alerts /> },
          { path: '/cameras', element: <Cameras /> },
          { path: '/cameras/new', element: <CameraEditor /> },
          { path: '/cameras/:cameraId', element: <CameraEditor /> },
          { path: '/rules', element: <Rules /> },
          { path: '/rules/new', element: <RuleEditor /> },
          { path: '/rules/:ruleId', element: <RuleEditor /> },
          { path: '/notifications', element: <Notifications /> },
        ],
      },
      { path: '/screen/:wallId', element: <WallScreen /> },
      { path: '/m', element: <Phone /> },
      { path: '/m/:alertId', element: <Phone /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
