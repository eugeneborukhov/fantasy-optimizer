import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import SelectionPage from './pages/SelectionPage'
import MlbFullRoster from './pages/mlb/MlbFullRoster'
import MlbSingleGame from './pages/mlb/MlbSingleGame'
import NbaFullRoster from './pages/nba/NbaFullRoster'
import NbaSingleGame from './pages/nba/NbaSingleGame'
import PgaFullRoster from './pages/pga/PgaFullRoster'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/mlb/full-roster" element={<MlbFullRoster />} />
      <Route path="/mlb/single-game" element={<MlbSingleGame />} />
      <Route path="/nba/full-roster" element={<NbaFullRoster />} />
      <Route path="/nba/single-game" element={<NbaSingleGame />} />
      <Route path="/pga/full-roster" element={<PgaFullRoster />} />
      <Route path="/:sport/:type" element={<SelectionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
