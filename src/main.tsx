import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// No StrictMode: the game owns a WebGL context and must be created exactly once.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
