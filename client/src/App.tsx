
import { BrowserRouter,Routes, Route  } from 'react-router-dom';
import './App.css';
import Room  from './Components/Room';

function App() {
  

  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Room/>} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
