import React from 'react'
import ReactDOM from 'react-dom/client'
import { ChakraProvider } from '@chakra-ui/react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { system } from '@elaraai/east-ui-components'
// Side-effect imports — run BEFORE any EastFunction compile so all platform
// implementations (toast_emit, dialog_open, drawer_open, state_bind,
// clipboard_copy, download_blob, download_csv, share_link) are in the
// registry by the time the first <EastFunction> mounts.
import '@elaraai/east-ui-components'
// Side-effect: registers EastChakraDecisionBrief against Decision.Brief.Component.
import '@elaraai/east-ui-patterns-components'
import App from './App'
import IndexRoute from './routes/Index'
import ObserveRoute from './routes/Observe'
import PredictRoute from './routes/Predict'
import DiagnoseRoute from './routes/Diagnose'
import DecideRoute from './routes/Decide'
import CompareRoute from './routes/Compare'
import CalibrateRoute from './routes/Calibrate'
import ConfigureRoute from './routes/Configure'
import FrameTrustRoute from './routes/FrameTrust'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <IndexRoute /> },
      { path: 'observe',     element: <ObserveRoute /> },
      { path: 'predict',     element: <PredictRoute /> },
      { path: 'diagnose',    element: <DiagnoseRoute /> },
      { path: 'decide',      element: <DecideRoute /> },
      { path: 'compare',     element: <CompareRoute /> },
      { path: 'calibrate',   element: <CalibrateRoute /> },
      { path: 'configure',   element: <ConfigureRoute /> },
      { path: 'frame-trust', element: <FrameTrustRoute /> },
    ],
  },
])

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ChakraProvider value={system}>
      <RouterProvider router={router} />
    </ChakraProvider>
  </React.StrictMode>,
)
