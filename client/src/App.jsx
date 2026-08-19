import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider, Outlet } from 'react-router-dom';
import Home from './pages/home/Home';
import Movies from './pages/movies/Movies';
import Booking from './pages/booking/Booking';
import Payment from './pages/payment/Payment';
import Profile from './pages/profile/Profile';
import Navbar from './components/Navbar/Navbar';
import AuthModal from './components/AuthModal/AuthModal';
import { AuthProvider } from './context/AuthContext';
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import './App.scss';

const RootLayout = () => {
  return (
    <>
      <Navbar />
      <main>
        <Outlet />
      </main>
      <AuthModal />
    </>
  );
};

function App() {
  const router = createBrowserRouter(
    createRoutesFromElements(
      <Route path="/" element={<RootLayout />}>
        <Route index element={<Home />} />
        <Route path="movies" element={<Movies />} />
        <Route path="booking" element={<Booking />} />
        <Route path="payment" element={<Payment />} />
        <Route path="profile" element={<Profile />} />
      </Route>
    )
  );

  return (
    <AuthProvider>
      <RouterProvider router={router} />
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="dark"
      />
    </AuthProvider>
  );
}

export default App;