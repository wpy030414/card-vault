import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/base.css'
import './styles/login.css'
import './styles/ring.css'
import './styles/examine.css'
import './styles/upload.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载点')

createRoot(container).render(<App />)
