import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import SelectionPage from './pages/SelectionPage'
import NbaFullRoster from './pages/nba/NbaFullRoster'
import NbaSingleGame from './pages/nba/NbaSingleGame'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/nba/full-roster" element={<NbaFullRoster />} />
      <Route path="/nba/single-game" element={<NbaSingleGame />} />
      <Route path="/:sport/:type" element={<SelectionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
