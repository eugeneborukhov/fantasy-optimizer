import { Link } from 'react-router-dom'
import './Home.css'

const sports = [
  { label: 'NBA', slug: 'nba' },
  { label: 'MLB', slug: 'mlb' },
  { label: 'PGA', slug: 'pga' },
] as const

const types = [
  { label: 'Full Roster', slug: 'full-roster' },
  { label: 'Single Game', slug: 'single-game' },
] as const

export default function Home() {
  return (
    <div className="home">
      <header className="homeHeader">
        <h1>fantasy-optimizer</h1>
      </header>

      <main className="homeMain">
        <table className="menuTable">
          <thead>
            <tr>
              <th scope="col">Sport</th>
              {types.map((t) => (
                <th scope="col" key={t.slug}>
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sports.map((s) => (
              <tr key={s.slug}>
                <th scope="row">{s.label}</th>
                {types.map((t) => (
                  <td key={`${s.slug}:${t.slug}`}>
                    <Link to={`/${s.slug}/${t.slug}`}>Open</Link>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  )
}
