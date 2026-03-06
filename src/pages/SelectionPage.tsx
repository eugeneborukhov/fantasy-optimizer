import { Link, Navigate, useParams } from 'react-router-dom'

const sportLabels: Record<string, string> = {
  nba: 'NBA',
  mlb: 'MLB',
  pga: 'PGA',
}

const typeLabels: Record<string, string> = {
  'full-roster': 'Full Roster',
  'single-game': 'Single Game',
}

export default function SelectionPage() {
  const { sport, type } = useParams()

  if (!sport || !type) {
    return <Navigate to="/" replace />
  }

  const sportSlug = sport.toLowerCase()
  const typeSlug = type.toLowerCase()

  const sportLabel = sportLabels[sportSlug]
  const typeLabel = typeLabels[typeSlug]

  if (!sportLabel || !typeLabel) {
    return (
      <div>
        <h1>Not Found</h1>
        <p>
          Unknown route: <code>/{sport}/{type}</code>
        </p>
        <p>
          <Link to="/">Back to Home</Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1>
        {sportLabel} / {typeLabel}
      </h1>
      <p>
        <Link to="/">Back to Home</Link>
      </p>
    </div>
  )
}
