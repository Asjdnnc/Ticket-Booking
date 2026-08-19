import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext();
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem("ticket_token");
    const savedUser = localStorage.getItem("ticket_user");

    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch (e) {
        localStorage.removeItem("ticket_token");
        localStorage.removeItem("ticket_user");
      }
    }
    setAuthLoading(false);
  }, []);

  const login = async ({ email, password }) => {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Login failed");
    }

    setUser(data.user);
    setToken(data.token);
    localStorage.setItem("ticket_user", JSON.stringify(data.user));
    localStorage.setItem("ticket_token", data.token);
    setIsAuthModalOpen(false);
    return data.user;
  };

  const register = async ({ name, email, password }) => {
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Registration failed");
    }

    setUser(data.user);
    setToken(data.token);
    localStorage.setItem("ticket_user", JSON.stringify(data.user));
    localStorage.setItem("ticket_token", data.token);
    setIsAuthModalOpen(false);
    return data.user;
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("ticket_user");
    localStorage.removeItem("ticket_token");
  };

  const openAuthModal = () => setIsAuthModalOpen(true);
  const closeAuthModal = () => setIsAuthModalOpen(false);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        register,
        logout,
        authLoading,
        isAuthModalOpen,
        openAuthModal,
        closeAuthModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
